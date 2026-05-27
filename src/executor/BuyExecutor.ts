import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from '../config/types';
import { NewTokenEvent } from '../monitor/types';
import { TokenFilter } from '../filter/TokenFilter';
import { PortfolioManager } from '../portfolio/PortfolioManager';
import { BundleClient } from '../jito/BundleClient';
import { getOptimalTip, getRandomTipAccount } from '../jito/TipManager';
import { fetchBondingCurveState } from '../pumpfun/AccountDecoder';
import {
  getTokensForSol,
  applyBuySlippage,
  getCurrentPricePerToken,
} from '../pumpfun/BondingCurve';
import { buildBuyInstruction } from '../pumpfun/InstructionBuilder';
import {
  buildTransaction,
  buildTipTransaction,
  getCachedBlockhash,
  sendRawTransaction,
} from '../transaction/TransactionBuilder';
import { getAtaWithCreateInstruction, markAtaExists } from '../transaction/AtaManager';
import { getPriorityFee } from '../transaction/PriorityFeeManager';
import logger from '../utils/logger';

export class BuyExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private filter: TokenFilter;
  private portfolio: PortfolioManager;
  private bundleClient: BundleClient;

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: Config,
    filter: TokenFilter,
    portfolio: PortfolioManager
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.filter = filter;
    this.portfolio = portfolio;
    this.bundleClient = new BundleClient(config.jitoBlockEngine);
  }

  async execute(event: NewTokenEvent): Promise<void> {
    const start = Date.now();

    // ── 1. Synchronous filter check ───────────────────────────────────────
    const syncResult = this.filter.checkSync(event);
    if (!syncResult.passed) {
      logger.debug(`⛔ Filtered out ${event.symbol}: ${syncResult.reason}`);
      return;
    }

    // ── 2. Check position limit ────────────────────────────────────────────
    if (this.portfolio.getOpenPositionCount() >= this.config.maxPositions) {
      logger.debug(`⛔ Max positions reached (${this.config.maxPositions}), skipping ${event.symbol}`);
      return;
    }

    // ── 3. Skip if we already have a position in this token ────────────────
    if (this.portfolio.getPosition(event.mint)) {
      logger.debug(`⛔ Already have position in ${event.symbol}`);
      return;
    }

    logger.info(`⚡ Attempting to snipe ${event.symbol} (${event.mint.toBase58().slice(0, 8)}...)`);

    // ── 4. Fetch bonding curve state ──────────────────────────────────────
    let bondingCurveState: Awaited<ReturnType<typeof fetchBondingCurveState>>['state'];
    let bondingCurvePda: PublicKey;

    try {
      const result = await fetchBondingCurveState(this.connection, event.mint);
      bondingCurveState = result.state;
      bondingCurvePda = result.pda;
    } catch (err) {
      logger.warn(`Failed to fetch bonding curve for ${event.symbol}: ${err}`);
      return;
    }

    // ── 5. Bonding curve filter ────────────────────────────────────────────
    const curveResult = this.filter.checkBondingCurve(bondingCurveState);
    if (!curveResult.passed) {
      logger.debug(`⛔ Curve filter: ${event.symbol}: ${curveResult.reason}`);
      return;
    }

    // ── 6. Calculate buy amounts ──────────────────────────────────────────
    const tokenAmount = getTokensForSol(bondingCurveState, this.config.buyAmountLamports);
    if (tokenAmount === 0n) {
      logger.warn(`${event.symbol}: calculated 0 tokens for buy amount — skipping`);
      return;
    }

    const maxSolCost = applyBuySlippage(this.config.buyAmountLamports, this.config.slippageBps);
    const entryPrice = getCurrentPricePerToken(bondingCurveState);

    logger.debug(
      `${event.symbol}: buying ${Number(tokenAmount) / 1e6} tokens for max ${Number(maxSolCost) / 1e9} SOL`
    );

    // ── 7. Optional async metadata filter ─────────────────────────────────
    if (this.config.requireSocialLinks) {
      const metaResult = await this.filter.checkMetadata(event);
      if (!metaResult.passed) {
        logger.debug(`⛔ Metadata filter: ${event.symbol}: ${metaResult.reason}`);
        return;
      }
    }

    // ── 8. Build transaction ───────────────────────────────────────────────
    const { ata: userAta, createInstruction } = await getAtaWithCreateInstruction(
      this.connection,
      event.mint,
      this.wallet.publicKey,
      this.wallet.publicKey,
      true // force create for new tokens (idempotent)
    );

    const buyIx = buildBuyInstruction({
      mint: event.mint,
      buyer: this.wallet.publicKey,
      tokenAmount,
      maxSolCost,
    });

    const instructions = createInstruction ? [createInstruction, buyIx] : [buyIx];

    const [priorityFee, blockhash, tipAmount] = await Promise.all([
      getPriorityFee(this.connection, this.config.priorityFeeMultiplier),
      getCachedBlockhash(this.connection),
      getOptimalTip(this.config.jitoTipPercentile),
    ]);

    const buyTx = await buildTransaction({
      connection: this.connection,
      payer: this.wallet,
      instructions,
      computeUnitPrice: priorityFee,
      blockhash,
    });

    // ── 9. DRY RUN check ──────────────────────────────────────────────────
    if (this.config.dryRun) {
      const elapsed = Date.now() - start;
      logger.info(
        `🧪 DRY RUN: Would buy ${event.symbol} | ` +
        `Tokens: ${Number(tokenAmount) / 1e6} | ` +
        `Max SOL: ${Number(maxSolCost) / 1e9} | ` +
        `Tip: ${Number(tipAmount) / 1e9} SOL | ` +
        `Elapsed: ${elapsed}ms`
      );
      return;
    }

    // ── 10. Submit via Jito bundle ────────────────────────────────────────
    const tipAccount = getRandomTipAccount();
    const tipTx = await buildTipTransaction(
      this.connection,
      this.wallet,
      tipAccount,
      tipAmount
    );

    let signature: string;

    try {
      // Bundle: [tip tx, buy tx]
      const bundleResult = await this.bundleClient.sendBundle([tipTx, buyTx]);
      signature = bundleResult.bundleId; // Use bundle ID as reference

      // Also send buy tx directly via RPC for redundancy
      try {
        signature = await sendRawTransaction(this.connection, buyTx);
      } catch { /* bundle is primary */ }
    } catch (bundleErr) {
      logger.warn(`Jito bundle failed: ${bundleErr}. Falling back to direct RPC.`);
      try {
        signature = await sendRawTransaction(this.connection, buyTx);
      } catch (rpcErr) {
        logger.error(`Direct RPC also failed for ${event.symbol}: ${rpcErr}`);
        return;
      }
    }

    // ── 11. Record position ───────────────────────────────────────────────
    markAtaExists(userAta);

    this.portfolio.openPosition({
      mint: event.mint,
      name: event.name,
      symbol: event.symbol,
      bondingCurvePda,
      solSpentLamports: this.config.buyAmountLamports,
      tokenAmountHeld: tokenAmount,
      entryPrice,
      buySignature: signature,
    });

    const elapsed = Date.now() - start;
    logger.info(
      `✅ Buy submitted: ${event.symbol} | ` +
      `Tokens: ${Number(tokenAmount) / 1e6} | ` +
      `Elapsed: ${elapsed}ms | ` +
      `Sig: ${signature.slice(0, 12)}...`
    );
  }
}
