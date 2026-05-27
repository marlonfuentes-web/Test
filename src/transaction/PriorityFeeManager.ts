import { Connection } from '@solana/web3.js';
import {
  MIN_PRIORITY_FEE_MICRO_LAMPORTS,
  MAX_PRIORITY_FEE_MICRO_LAMPORTS,
  PUMP_FUN_PROGRAM_ID,
} from '../constants';
import logger from '../utils/logger';

interface PriorityFeeCache {
  microLamports: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 3000; // refresh every 3 seconds
let feeCache: PriorityFeeCache | null = null;

/**
 * Get the recommended compute unit price (micro-lamports per CU)
 * based on recent network fees, scaled by a multiplier.
 */
export async function getPriorityFee(
  connection: Connection,
  multiplier = 1.5
): Promise<number> {
  const now = Date.now();

  if (feeCache && now - feeCache.cachedAt < CACHE_TTL_MS) {
    return feeCache.microLamports;
  }

  try {
    const fees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: [PUMP_FUN_PROGRAM_ID],
    });

    if (fees.length === 0) {
      logger.warn('No recent prioritization fees found, using minimum');
      return MIN_PRIORITY_FEE_MICRO_LAMPORTS;
    }

    // Sort and take 75th percentile
    const sortedFees = fees
      .map((f) => f.prioritizationFee)
      .sort((a, b) => a - b);

    const p75Index = Math.floor(sortedFees.length * 0.75);
    const p75Fee = sortedFees[p75Index] ?? sortedFees[sortedFees.length - 1] ?? 0;

    const scaled = Math.floor(p75Fee * multiplier);
    const clamped = Math.max(
      MIN_PRIORITY_FEE_MICRO_LAMPORTS,
      Math.min(MAX_PRIORITY_FEE_MICRO_LAMPORTS, scaled)
    );

    logger.debug(`Priority fee: ${clamped} µlamports/CU (p75=${p75Fee}, ×${multiplier})`);

    feeCache = { microLamports: clamped, cachedAt: now };
    return clamped;
  } catch (err) {
    logger.warn(`Failed to fetch priority fees: ${err}. Using minimum.`);
    return MIN_PRIORITY_FEE_MICRO_LAMPORTS;
  }
}

/** Clear the priority fee cache (e.g., on network congestion detection). */
export function clearPriorityFeeCache(): void {
  feeCache = null;
}
