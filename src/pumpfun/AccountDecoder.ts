import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { BondingCurveState } from './BondingCurve';
import { PUMP_FUN_PROGRAM_ID, BONDING_CURVE_SEED } from '../constants';

/**
 * Decode the pump.fun bonding curve account data using manual buffer parsing.
 * Layout (after 8-byte Anchor discriminator):
 *   virtualTokenReserves: u64 (8 bytes)
 *   virtualSolReserves:   u64 (8 bytes)
 *   realTokenReserves:    u64 (8 bytes)
 *   realSolReserves:      u64 (8 bytes)
 *   tokenTotalSupply:     u64 (8 bytes)
 *   complete:             bool (1 byte)
 * Total: 49 bytes (8 discriminator + 40 u64s + 1 bool)
 */
export function decodeBondingCurveState(data: Buffer): BondingCurveState {
  if (data.length < 49) {
    throw new Error(`Bonding curve account data too short: ${data.length} bytes`);
  }

  // Skip 8-byte Anchor discriminator
  let offset = 8;

  const readU64 = (): bigint => {
    const val = data.readBigUInt64LE(offset);
    offset += 8;
    return val;
  };

  const virtualTokenReserves = readU64();
  const virtualSolReserves = readU64();
  const realTokenReserves = readU64();
  const realSolReserves = readU64();
  const tokenTotalSupply = readU64();
  const complete = data[offset] !== 0;

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
  };
}

/**
 * Derive the bonding curve PDA for a given mint.
 */
export function getBondingCurvePda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
    PUMP_FUN_PROGRAM_ID
  );
  return pda;
}

/**
 * Fetch and decode the bonding curve state for a given mint.
 */
export async function fetchBondingCurveState(
  connection: Connection,
  mint: PublicKey
): Promise<{ state: BondingCurveState; pda: PublicKey }> {
  const pda = getBondingCurvePda(mint);
  const accountInfo = await connection.getAccountInfo(pda, 'processed');

  if (!accountInfo) {
    throw new Error(`Bonding curve account not found for mint: ${mint.toBase58()}`);
  }

  const state = decodeBondingCurveState(Buffer.from(accountInfo.data));
  return { state, pda };
}

/**
 * Fetch bonding curve states for multiple mints in a single batch RPC call.
 */
export async function fetchMultipleBondingCurveStates(
  connection: Connection,
  mints: PublicKey[]
): Promise<Map<string, { state: BondingCurveState; pda: PublicKey }>> {
  const pdas = mints.map(getBondingCurvePda);
  const accountInfos = await connection.getMultipleAccountsInfo(pdas, 'processed');

  const result = new Map<string, { state: BondingCurveState; pda: PublicKey }>();

  for (let i = 0; i < mints.length; i++) {
    const accountInfo = accountInfos[i];
    const mint = mints[i];
    const pda = pdas[i];

    if (accountInfo && accountInfo.data.length >= 49) {
      try {
        const state = decodeBondingCurveState(Buffer.from(accountInfo.data));
        result.set(mint.toBase58(), { state, pda });
      } catch {
        // Skip malformed accounts
      }
    }
  }

  return result;
}
