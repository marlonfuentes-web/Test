/**
 * Status script — show wallet balance, open positions, and trade history.
 * Usage: npx ts-node scripts/status.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getConfig } from '../src/config';
import { getWalletKeypair } from '../src/utils/keypair';
import { loadPositions } from '../src/portfolio/Persistence';
import { fetchMultipleBondingCurveStates } from '../src/pumpfun/AccountDecoder';
import { getSolForTokens, getPnlMultiplier } from '../src/pumpfun/BondingCurve';

async function main() {
  const config = getConfig();
  const wallet = getWalletKeypair(config.privateKey);
  const connection = new Connection(config.rpcUrl, 'confirmed');

  console.log('\n══════════════════════════════════════════════════');
  console.log('  pump.fun Sniper — Status');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);

  // Wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`  Balance: ${(balance / 1e9).toFixed(6)} SOL`);

  const positions = loadPositions();
  const open = positions.filter((p) => p.status === 'open');
  const sold = positions.filter((p) => p.status === 'sold');

  console.log(`\n  Open positions: ${open.length}`);
  console.log(`  Closed positions: ${sold.length}`);

  if (open.length > 0) {
    console.log('\n── Open Positions ──────────────────────────────────');

    // Fetch current prices for all open positions
    const mints = open.map((p) => new PublicKey(p.mint));
    const states = await fetchMultipleBondingCurveStates(connection, mints);

    for (const pos of open) {
      const stateData = states.get(pos.mint);
      let currentValueStr = 'n/a';
      let pnlStr = 'n/a';

      if (stateData) {
        const currentValue = getSolForTokens(stateData.state, pos.tokenAmountHeld);
        const pnl = getPnlMultiplier(stateData.state, pos.tokenAmountHeld, pos.solSpentLamports);
        const pnlSol = (Number(currentValue) - Number(pos.solSpentLamports)) / 1e9;
        const sign = pnlSol >= 0 ? '+' : '';
        currentValueStr = `${(Number(currentValue) / 1e9).toFixed(6)} SOL`;
        pnlStr = `${sign}${pnlSol.toFixed(6)} SOL (${pnl.toFixed(2)}x)`;
      }

      const holdMs = Date.now() - pos.openedAt;
      const holdStr = holdMs > 60_000
        ? `${(holdMs / 60000).toFixed(1)}m`
        : `${(holdMs / 1000).toFixed(0)}s`;

      console.log(`\n  ${pos.symbol} (${pos.name})`);
      console.log(`    Mint:     ${pos.mint}`);
      console.log(`    Tokens:   ${(Number(pos.tokenAmountHeld) / 1e6).toLocaleString()}`);
      console.log(`    Spent:    ${(Number(pos.solSpentLamports) / 1e9).toFixed(6)} SOL`);
      console.log(`    Value:    ${currentValueStr}`);
      console.log(`    PnL:      ${pnlStr}`);
      console.log(`    Hold:     ${holdStr}`);
      console.log(`    Buy tx:   ${pos.buySignature}`);
    }
  }

  if (sold.length > 0) {
    console.log('\n── Recent Closed Positions ─────────────────────────');
    const recent = sold.slice(-10); // show last 10

    let totalPnl = 0n;
    for (const pos of sold) {
      totalPnl += pos.realizedPnlLamports ?? 0n;
    }

    for (const pos of recent) {
      const pnlSol = Number(pos.realizedPnlLamports ?? 0n) / 1e9;
      const sign = pnlSol >= 0 ? '+' : '';
      const holdMs = (pos.closedAt ?? 0) - pos.openedAt;
      const holdStr = `${(holdMs / 1000).toFixed(0)}s`;
      console.log(
        `  ${pos.symbol.padEnd(10)} ${sign}${pnlSol.toFixed(6)} SOL  ` +
        `(${pos.pnlMultiplier?.toFixed(2) ?? '?'}x)  hold: ${holdStr}`
      );
    }

    console.log(`\n  Total realized PnL: ${(Number(totalPnl) / 1e9).toFixed(6)} SOL`);
  }

  console.log('\n══════════════════════════════════════════════════\n');
}

main().catch(console.error);
