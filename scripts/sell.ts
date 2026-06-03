/**
 * Manual sell script — immediately sell a specific open position.
 * Usage: npx ts-node scripts/sell.ts <mint_address>
 *
 * Example:
 *   npx ts-node scripts/sell.ts So11111111111111111111111111111111111111112
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getConfig } from '../src/config';
import { getWalletKeypair } from '../src/utils/keypair';
import { loadPositions } from '../src/portfolio/Persistence';
import { PortfolioManager } from '../src/portfolio/PortfolioManager';
import { SellExecutor } from '../src/executor/SellExecutor';
import { fetchBondingCurveState } from '../src/pumpfun/AccountDecoder';
import { getSolForTokens } from '../src/pumpfun/BondingCurve';

async function main() {
  const mintArg = process.argv[2];
  if (!mintArg) {
    console.error('Usage: npx ts-node scripts/sell.ts <mint_address>');
    process.exit(1);
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintArg);
  } catch {
    console.error(`Invalid mint address: ${mintArg}`);
    process.exit(1);
  }

  const config = getConfig();
  const wallet = getWalletKeypair(config.privateKey);
  const connection = new Connection(config.rpcUrl, 'confirmed');

  // Find the position
  const positions = loadPositions();
  const position = positions.find((p) => p.mint === mint.toBase58());

  if (!position) {
    console.error(`No saved position found for mint: ${mint.toBase58()}`);
    console.log('Available positions:');
    for (const p of positions.filter((x) => x.status === 'open')) {
      console.log(`  ${p.symbol}: ${p.mint}`);
    }
    process.exit(1);
  }

  if (position.status !== 'open') {
    console.error(`Position status is "${position.status}" — can only sell open positions`);
    process.exit(1);
  }

  // Fetch current value
  try {
    const { state } = await fetchBondingCurveState(connection, mint);
    const currentValue = getSolForTokens(state, position.tokenAmountHeld);
    const pnlSol = (Number(currentValue) - Number(position.solSpentLamports)) / 1e9;
    const pnlMultiplier = Number(currentValue) / Number(position.solSpentLamports);

    console.log(`\nSelling ${position.symbol} (${position.name})`);
    console.log(`  Mint:         ${position.mint}`);
    console.log(`  Tokens:       ${(Number(position.tokenAmountHeld) / 1e6).toLocaleString()}`);
    console.log(`  Cost basis:   ${(Number(position.solSpentLamports) / 1e9).toFixed(6)} SOL`);
    console.log(`  Current value: ${(Number(currentValue) / 1e9).toFixed(6)} SOL`);
    console.log(`  PnL:           ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(6)} SOL (${pnlMultiplier.toFixed(2)}x)`);

    if (!config.dryRun) {
      console.log('\nSelling...');
    }
  } catch (err) {
    console.error(`Failed to fetch current price: ${err}`);
    console.log('Proceeding with sell anyway (using 0 minSolOutput)...');
  }

  // Restore position to portfolio manager and execute sell
  const portfolio = new PortfolioManager();
  // The constructor will load saved positions, so our position should be there

  const sellExecutor = new SellExecutor(connection, wallet, config, portfolio);

  await sellExecutor.execute({
    mint,
    trigger: 'manual',
    tokenAmount: position.tokenAmountHeld,
    reason: 'Manual sell via CLI',
  });

  console.log('Done.');
}

main().catch(console.error);
