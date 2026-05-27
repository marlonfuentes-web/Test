import { PublicKey } from '@solana/web3.js';
import { PortfolioManager } from '../portfolio/PortfolioManager';
import { Position } from '../portfolio/types';
import { Config } from '../config/types';
import logger from '../utils/logger';

export type SellTrigger = 'takeProfit' | 'stopLoss' | 'trailingStop' | 'timeLimit' | 'manual';

export interface SellSignal {
  mint: PublicKey;
  trigger: SellTrigger;
  tokenAmount: bigint;
  reason: string;
}

export type SellCallback = (signal: SellSignal) => Promise<void>;

/**
 * Auto-sell strategy that monitors positions and triggers sells based on:
 * - Take profit (configurable multiplier, e.g., 3x)
 * - Stop loss (configurable floor, e.g., 0.5x)
 * - Trailing stop (sell when price drops X% from peak)
 * - Time limit (force sell after N milliseconds)
 */
export class AutoSellStrategy {
  private portfolio: PortfolioManager;
  private config: Config;
  private onSell: SellCallback;
  private timeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    portfolio: PortfolioManager,
    config: Config,
    onSell: SellCallback
  ) {
    this.portfolio = portfolio;
    this.config = config;
    this.onSell = onSell;

    // Listen to position updates from the portfolio
    this.portfolio.on('positionOpened', (pos) => this.onPositionOpened(pos));
    this.portfolio.on('positionUpdated', (pos) => this.checkSellConditions(pos));
    this.portfolio.on('positionClosed', (pos) => this.clearTimeout(pos.mint));
  }

  private onPositionOpened(position: Position): void {
    // Set time-based exit timer
    if (this.config.maxHoldDurationMs > 0) {
      const timer = setTimeout(async () => {
        const pos = this.portfolio.getPosition(new PublicKey(position.mint));
        if (!pos || pos.status !== 'open') return;

        const tokenAmount = this.getTokenAmountToSell(pos);
        if (tokenAmount === 0n) return;

        logger.info(`⏰ Time limit reached for ${pos.symbol} — triggering sell`);
        await this.triggerSell(position.mint, 'timeLimit', tokenAmount, 'Max hold duration reached');
      }, this.config.maxHoldDurationMs);

      this.timeouts.set(position.mint, timer);
    }
  }

  private async checkSellConditions(position: Position): Promise<void> {
    if (position.status !== 'open') return;
    if (!position.pnlMultiplier) return;

    const pnl = position.pnlMultiplier;

    // Take profit
    if (pnl >= this.config.takeProfitMultiplier) {
      const tokenAmount = this.getTokenAmountToSell(position);
      if (tokenAmount === 0n) return;

      logger.info(`🎯 Take profit: ${position.symbol} at ${pnl.toFixed(2)}x`);
      await this.triggerSell(
        position.mint,
        'takeProfit',
        tokenAmount,
        `Take profit at ${pnl.toFixed(2)}x (target: ${this.config.takeProfitMultiplier}x)`
      );
      return;
    }

    // Stop loss
    if (pnl <= this.config.stopLossMultiplier) {
      const tokenAmount = this.getTokenAmountToSell(position);
      if (tokenAmount === 0n) return;

      logger.info(`🛑 Stop loss: ${position.symbol} at ${pnl.toFixed(2)}x`);
      await this.triggerSell(
        position.mint,
        'stopLoss',
        tokenAmount,
        `Stop loss at ${pnl.toFixed(2)}x (floor: ${this.config.stopLossMultiplier}x)`
      );
      return;
    }

    // Trailing stop
    if (this.config.trailingStopPct > 0 && position.currentPrice && position.peakPrice) {
      const dropFromPeak = 1 - Number(position.currentPrice) / Number(position.peakPrice);
      const threshold = this.config.trailingStopPct / 100;

      if (dropFromPeak >= threshold) {
        const tokenAmount = this.getTokenAmountToSell(position);
        if (tokenAmount === 0n) return;

        logger.info(
          `📉 Trailing stop: ${position.symbol} dropped ${(dropFromPeak * 100).toFixed(1)}% from peak`
        );
        await this.triggerSell(
          position.mint,
          'trailingStop',
          tokenAmount,
          `Trailing stop: ${(dropFromPeak * 100).toFixed(1)}% drop from peak`
        );
      }
    }
  }

  private async triggerSell(
    mint: string,
    trigger: SellTrigger,
    tokenAmount: bigint,
    reason: string
  ): Promise<void> {
    const mintPubkey = new PublicKey(mint);

    // Atomically mark as selling to prevent race conditions
    const canSell = this.portfolio.markSelling(mintPubkey);
    if (!canSell) return; // Already being sold

    this.clearTimeout(mint);

    try {
      await this.onSell({ mint: mintPubkey, trigger, tokenAmount, reason });
    } catch (err) {
      logger.error(`Sell execution failed for ${mint}: ${err}`);
      this.portfolio.revertSelling(mintPubkey);
    }
  }

  private getTokenAmountToSell(position: Position): bigint {
    if (this.config.sellPortionBps >= 10_000) {
      return position.tokenAmountHeld;
    }
    return (position.tokenAmountHeld * BigInt(this.config.sellPortionBps)) / 10_000n;
  }

  private clearTimeout(mint: string): void {
    const timer = this.timeouts.get(mint);
    if (timer) {
      clearTimeout(timer);
      this.timeouts.delete(mint);
    }
  }

  /** Manually trigger a sell for a position. */
  async manualSell(mintStr: string): Promise<void> {
    const position = this.portfolio.getPosition(new PublicKey(mintStr));
    if (!position || position.status !== 'open') {
      logger.warn(`No open position for mint: ${mintStr}`);
      return;
    }
    const tokenAmount = this.getTokenAmountToSell(position);
    await this.triggerSell(mintStr, 'manual', tokenAmount, 'Manual sell');
  }
}
