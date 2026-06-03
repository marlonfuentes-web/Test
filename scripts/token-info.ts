/**
 * Token info script — inspect any pump.fun token's bonding curve state and metadata.
 * Usage: npx ts-node scripts/token-info.ts <mint_address>
 *
 * Example:
 *   npx ts-node scripts/token-info.ts 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getConfig } from '../src/config';
import { fetchBondingCurveState } from '../src/pumpfun/AccountDecoder';
import {
  getCurrentPricePerToken,
  getMarketCap,
  getTokensForSol,
  getSolForTokens,
  formatSol,
  formatTokens,
} from '../src/pumpfun/BondingCurve';
import { fetchTokenInfo } from '../src/utils/metadata';

async function main() {
  const mintArg = process.argv[2];
  if (!mintArg) {
    console.error('Usage: npx ts-node scripts/token-info.ts <mint_address>');
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
  const connection = new Connection(config.rpcUrl, 'confirmed');

  console.log(`\nFetching info for: ${mint.toBase58()}`);
  console.log('══════════════════════════════════════════════════════\n');

  // Bonding curve state
  let state;
  let bondingCurvePda;
  try {
    const result = await fetchBondingCurveState(connection, mint);
    state = result.state;
    bondingCurvePda = result.pda;
  } catch (err) {
    console.error(`Token not found on pump.fun or bonding curve missing: ${err}`);
    process.exit(1);
  }

  const pricePerToken = getCurrentPricePerToken(state);
  const marketCap = getMarketCap(state);
  const tokensFor1Sol = getTokensForSol(state, BigInt(1e9));
  const solFor1MTokens = getSolForTokens(state, BigInt(1_000_000 * 1e6));

  console.log('Bonding Curve:');
  console.log(`  PDA:                    ${bondingCurvePda.toBase58()}`);
  console.log(`  Status:                 ${state.complete ? '✅ Graduated to Raydium' : '🔄 Active on pump.fun'}`);
  console.log(`  Virtual SOL reserves:   ${formatSol(state.virtualSolReserves)}`);
  console.log(`  Virtual token reserves: ${formatTokens(state.virtualTokenReserves)} tokens`);
  console.log(`  Real SOL in curve:      ${formatSol(state.realSolReserves)}`);
  console.log(`  Real tokens in curve:   ${formatTokens(state.realTokenReserves)} tokens`);
  console.log(`  Token total supply:     ${formatTokens(state.tokenTotalSupply)} tokens`);
  console.log('');
  console.log('Price & Market Cap:');
  console.log(`  Price per token:        ${(Number(pricePerToken) / 1e9).toFixed(12)} SOL`);
  console.log(`  Price per token (USD):  ~$${(Number(pricePerToken) / 1e9 * 150).toFixed(10)}`);
  console.log(`  Market cap:             ${formatSol(marketCap)}`);
  console.log('');
  console.log('Trade Simulation:');
  console.log(`  Buy 1 SOL → ${formatTokens(tokensFor1Sol)} tokens`);
  console.log(`  Sell 1M tokens → ${formatSol(solFor1MTokens)}`);
  console.log('');

  // Graduation progress (pump.fun graduates at ~85 SOL)
  const GRADUATION_SOL = BigInt(85e9);
  const progressPct = Number(state.realSolReserves) / Number(GRADUATION_SOL) * 100;
  const bar = '█'.repeat(Math.floor(progressPct / 5)) + '░'.repeat(20 - Math.floor(progressPct / 5));
  console.log(`  Graduation progress: [${bar}] ${progressPct.toFixed(1)}%`);
  console.log('');

  // Metadata
  console.log('Metadata:');
  const tokenInfo = await fetchTokenInfo(connection, mint);
  if (tokenInfo) {
    console.log(`  Name:        ${tokenInfo.name}`);
    console.log(`  Symbol:      ${tokenInfo.symbol}`);
    console.log(`  URI:         ${tokenInfo.uri}`);
    if (tokenInfo.offChain) {
      const m = tokenInfo.offChain;
      console.log(`  Description: ${m.description?.slice(0, 100) ?? 'n/a'}`);
      console.log(`  Twitter:     ${m.twitter ?? 'n/a'}`);
      console.log(`  Telegram:    ${m.telegram ?? 'n/a'}`);
      console.log(`  Website:     ${m.website ?? 'n/a'}`);
    }
  } else {
    console.log('  (Metadata not found)');
  }

  console.log('\n══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
