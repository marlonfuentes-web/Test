import { Connection, PublicKey } from '@solana/web3.js';
import { PortfolioManager } from './PortfolioManager';
import { fetchMultipleBondingCurveStates } from '../pumpfun/AccountDecoder';
import logger from '../utils/logger';

const POLL_INTERVAL_MS = 2000;

/**
 * Polls bonding curve accounts for all open positions every 2 seconds.
 * Uses a single batched RPC call (getMultipleAccountsInfo) to minimize latency.
 */
export class PricePoller {
  private connection: Connection;
  private portfolio: PortfolioManager;
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(connection: Connection, portfolio: PortfolioManager) {
    this.connection = connection;
    this.portfolio = portfolio;
  }

  start(): void {
    logger.debug('Price poller started');
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.debug('Price poller stopped');
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return; // prevent overlapping polls
    this.isPolling = true;

    try {
      const openPositions = this.portfolio.getOpenPositions();
      if (openPositions.length === 0) return;

      const mints = openPositions.map((p) => new PublicKey(p.mint));
      const states = await fetchMultipleBondingCurveStates(this.connection, mints);

      for (const [mintStr, { state }] of states) {
        const mint = new PublicKey(mintStr);
        this.portfolio.updatePrice(mint, state);
      }
    } catch (err) {
      logger.debug(`Price poll error: ${err}`);
    } finally {
      this.isPolling = false;
    }
  }

  /** Force an immediate price update (e.g., right after a buy). */
  async pollNow(): Promise<void> {
    await this.poll();
  }
}
