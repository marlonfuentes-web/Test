import axios from 'axios';
import { Config } from '../config/types';
import { NewTokenEvent, TokenMetadata } from '../monitor/types';
import { FilterResult } from './types';
import { BondingCurveState } from '../pumpfun/BondingCurve';
import logger from '../utils/logger';

/**
 * Token filter — runs synchronous checks first, then async checks if needed.
 * Returns immediately on first failure to minimize latency.
 */
export class TokenFilter {
  private config: Config;
  private metadataCache = new Map<string, TokenMetadata>();

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Synchronous filter checks — run before any async operations.
   * These are instant (<1ms) and eliminate obviously bad tokens.
   */
  checkSync(event: NewTokenEvent): FilterResult {
    const { name, symbol, creator } = event;

    // Check blocked creators
    if (this.config.blockedCreators.has(creator.toBase58())) {
      return { passed: false, reason: `Blocked creator: ${creator.toBase58()}` };
    }

    // Check blocked name patterns
    for (const pattern of this.config.blockedNamePatterns) {
      if (pattern.test(name) || pattern.test(symbol)) {
        return { passed: false, reason: `Blocked by pattern: ${pattern.source}` };
      }
    }

    // Filter out tokens with suspicious names
    const suspiciousPatterns = [/test/i, /fake/i, /scam/i, /rug/i];
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(name) || pattern.test(symbol)) {
        return { passed: false, reason: `Suspicious name: ${name} (${symbol})` };
      }
    }

    return { passed: true };
  }

  /**
   * Check bonding curve state (liquidity, completion).
   */
  checkBondingCurve(state: BondingCurveState): FilterResult {
    // Skip if already migrated to Raydium
    if (state.complete) {
      return { passed: false, reason: 'Token already graduated to Raydium' };
    }

    // Check SOL liquidity range
    const solInCurve = state.realSolReserves;

    if (solInCurve < this.config.minInitialLiquidityLamports) {
      return {
        passed: false,
        reason: `SOL too low: ${Number(solInCurve) / 1e9} SOL (min: ${Number(this.config.minInitialLiquidityLamports) / 1e9})`,
      };
    }

    if (solInCurve > this.config.maxInitialLiquidityLamports) {
      return {
        passed: false,
        reason: `SOL too high (near graduation): ${Number(solInCurve) / 1e9} SOL`,
      };
    }

    return { passed: true };
  }

  /**
   * Async filter: check metadata for social links.
   * Only runs if REQUIRE_SOCIAL_LINKS=true.
   */
  async checkMetadata(event: NewTokenEvent): Promise<FilterResult> {
    if (!this.config.requireSocialLinks) return { passed: true };
    if (!event.metadataUri) {
      return { passed: false, reason: 'No metadata URI' };
    }

    try {
      const metadata = await this.fetchMetadata(event.metadataUri);
      const hasSocial = !!(metadata.twitter || metadata.telegram || metadata.website);

      if (!hasSocial) {
        return { passed: false, reason: 'No social links in metadata' };
      }

      return { passed: true };
    } catch (err) {
      logger.debug(`Failed to fetch metadata for ${event.symbol}: ${err}`);
      // Don't block on metadata fetch failure — let it through
      return { passed: true };
    }
  }

  private async fetchMetadata(uri: string): Promise<TokenMetadata> {
    const cached = this.metadataCache.get(uri);
    if (cached) return cached;

    const response = await axios.get<TokenMetadata>(uri, { timeout: 2000 });
    const metadata = response.data;
    this.metadataCache.set(uri, metadata);
    return metadata;
  }
}
