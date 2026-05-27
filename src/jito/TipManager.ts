import axios from 'axios';
import { JITO_TIP_ACCOUNTS, JITO_TIP_API_URL } from '../constants';
import { PublicKey } from '@solana/web3.js';
import logger from '../utils/logger';

interface JitoTipFloorResponse {
  time: string;
  landed_tips_25th_percentile: number;
  landed_tips_50th_percentile: number;
  landed_tips_75th_percentile: number;
  landed_tips_95th_percentile: number;
  landed_tips_99th_percentile: number;
  ema_landed_tips_50th_percentile: number;
}

interface TipCache {
  tipLamports: bigint;
  cachedAt: number;
}

const CACHE_TTL_MS = 5000; // 5 seconds
const FALLBACK_TIP_SOL = 0.001; // 0.001 SOL fallback
const MIN_TIP_LAMPORTS = BigInt(1_000); // 0.000001 SOL minimum

let tipCache: TipCache | null = null;

type TipPercentile = 25 | 50 | 75 | 95;

/**
 * Fetch the current optimal Jito tip amount from the tip floor API.
 * Caches for 5 seconds to avoid hammering the endpoint.
 */
export async function getOptimalTip(percentile: TipPercentile = 75): Promise<bigint> {
  const now = Date.now();

  if (tipCache && now - tipCache.cachedAt < CACHE_TTL_MS) {
    return tipCache.tipLamports;
  }

  try {
    const response = await axios.get<JitoTipFloorResponse[]>(JITO_TIP_API_URL, {
      timeout: 2000,
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Empty response from tip floor API');
    }

    const data = response.data[0];
    let tipSol: number;

    switch (percentile) {
      case 25:  tipSol = data.landed_tips_25th_percentile; break;
      case 50:  tipSol = data.landed_tips_50th_percentile; break;
      case 75:  tipSol = data.landed_tips_75th_percentile; break;
      case 95:  tipSol = data.landed_tips_95th_percentile; break;
      default:  tipSol = data.landed_tips_75th_percentile;
    }

    // Convert SOL to lamports
    const tipLamports = BigInt(Math.floor(tipSol * 1e9));
    const finalTip = tipLamports > MIN_TIP_LAMPORTS ? tipLamports : MIN_TIP_LAMPORTS;

    logger.debug(`Jito tip (p${percentile}): ${Number(finalTip) / 1e9} SOL`);

    tipCache = { tipLamports: finalTip, cachedAt: now };
    return finalTip;
  } catch (err) {
    logger.warn(`Failed to fetch Jito tip floor: ${err}. Using fallback.`);
    const fallback = BigInt(Math.floor(FALLBACK_TIP_SOL * 1e9));
    tipCache = { tipLamports: fallback, cachedAt: now };
    return fallback;
  }
}

/**
 * Pick a random Jito tip account for this bundle.
 * Distributing across tip accounts helps avoid bundle collisions.
 */
export function getRandomTipAccount(): PublicKey {
  const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return JITO_TIP_ACCOUNTS[index];
}
