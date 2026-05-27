import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from '../config/types';
import { PortfolioManager } from '../portfolio/PortfolioManager';
import { BundleClient } from '../jito/BundleClient';
import { getOptimalTip, getRandomTipAccount } from '../jito/TipManager';
import { fetchBondingCurveState } from '../pumpfun/AccountDecoder';
import {
  getSolForTokens,
  applySellSlippage,
} from '../pumpfun/BondingCurve';
import { buildSellInstruction } from '../pumpfun/InstructionBuilder';
import {
  buildTransaction,
  buildTipTransaction,
  getCachedBlockhash,
  sendRawTransaction,
} from '../transaction/TransactionBuilder';
import { getPriorityFee } from '../transaction/PriorityFeeManager';
import { SellSignal } from '../strategy/AutoSellStrategy';
import logger from '../utils/logger';

export class SellExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private portfolio: PortfolioManager;
  private bundleClient: BundleClient;

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: Config,
    portfolio: PortfolioManager
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.portfolio = portfolio;
    this.bundleClient = new BundleClient(config.jitoBlockEngine);
  }

  async execute(signal: SellSignal): Promise<void> {
    const { mint, trigger, tokenAmount, reason } = signal;
    const position = this.portfolio.getPosition(mint);

    if (!position) {
      logger.warn(`No position found for sell: ${mint.toBase58()}`);
      return;
    }

    logger.info(
      `📤 Selling ${position.symbol} | Trigger: ${trigger} | ` +
      `Tokens: ${Number(tokenAmount) / 1e6} | Reason: ${reason}`
    );

    // ── 1. Fetch current bonding curve state ──────────────────────────────
    let solOutput: bigint;
    try {
      const { state } = await fetchBondingCurveState(this.connection, mint);
      solOutput = getSolForTokens(state, tokenAmount);
    } catch (err) {
      logger.error(`Failed to fetch curve for sell ${position.symbol}: ${err}`);
      this.portfolio.revertSelling(mint);
      return;
    }

    if (solOutput === 0n) {
      logger.warn(`${position.symbol}: 0 SOL output for sell — token may be worthless`);
      // Still try to sell to recover any residual value
    }

    const minSolOutput = applySellSlippage(solOutput, this.config.slippageBps);

    // ── 2. Build sell instruction ─────────────────────────────────────────
    const sellIx = buildSellInstruction({
      mint,
      seller: this.wallet.publicKey,
      tokenAmount,
      minSolOutput,
    });

    // ── 3. Build transaction ──────────────────────────────────────────────
    const [priorityFee, blockhash, tipAmount] = await Promise.all([
      getPriorityFee(this.connection, this.config.priorityFeeMultiplier),
      getCachedBlockhash(this.connection),
      getOptimalTip(this.config.jitoTipPercentile),
    ]);

    const sellTx = await buildTransaction({
      connection: this.connection,
      payer: this.wallet,
      instructions: [sellIx],
      computeUnitPrice: priorityFee,
      blockhash,
    });

    // ── 4. DRY RUN check ──────────────────────────────────────────────────
    if (this.config.dryRun) {
      logger.info(
        `🧪 DRY RUN: Would sell ${position.symbol} | ` +
        `Min SOL out: ${Number(minSolOutput) / 1e9} | ` +
        `Trigger: ${trigger}`
      );
      this.portfolio.revertSelling(mint);
      return;
    }

    // ── 5. Submit via Jito bundle + direct RPC ────────────────────────────
    const tipAccount = getRandomTipAccount();
    const tipTx = await buildTipTransaction(
      this.connection,
      this.wallet,
      tipAccount,
      tipAmount
    );

    let signature: string;

    try {
      await this.bundleClient.sendBundle([tipTx, sellTx]);
      // Also send directly for redundancy
      signature = await sendRawTransaction(this.connection, sellTx);
    } catch (bundleErr) {
      logger.warn(`Jito sell bundle failed: ${bundleErr}. Falling back to direct RPC.`);
      try {
        signature = await sendRawTransaction(this.connection, sellTx);
      } catch (rpcErr) {
        logger.error(`Sell RPC also failed for ${position.symbol}: ${rpcErr}`);
        this.portfolio.revertSelling(mint);
        return;
      }
    }

    // ── 6. Record closed position ─────────────────────────────────────────
    this.portfolio.closePosition(mint, signature, solOutput);
  }
}
