import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import { Position, PositionStatus } from './types';
import { BondingCurveState, getSolForTokens, getPnlMultiplier } from '../pumpfun/BondingCurve';
import { savePositions, loadPositions, logTradeRecord } from './Persistence';
import logger from '../utils/logger';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export declare interface PortfolioManager {
  on(event: 'positionOpened', listener: (position: Position) => void): this;
  on(event: 'positionUpdated', listener: (position: Position) => void): this;
  on(event: 'positionClosed', listener: (position: Position) => void): this;
}

export class PortfolioManager extends EventEmitter {
  private positions = new Map<string, Position>(); // keyed by mint string

  constructor() {
    super();
    // Restore positions saved from previous session
    const saved = loadPositions();
    // Only restore open positions (sold ones are historical)
    const openSaved = saved.filter((p) => p.status === 'open' || p.status === 'selling');
    for (const pos of openSaved) {
      // Mark restored 'selling' positions back to 'open' since executor state is gone
      pos.status = 'open';
      this.positions.set(pos.mint, pos);
    }
    if (openSaved.length > 0) {
      logger.info(`📂 Restored ${openSaved.length} open position(s) from previous session`);
    }
  }

  /** Open a new position after a successful buy. */
  openPosition(params: {
    mint: PublicKey;
    name: string;
    symbol: string;
    bondingCurvePda: PublicKey;
    solSpentLamports: bigint;
    tokenAmountHeld: bigint;
    entryPrice: bigint;
    buySignature: string;
  }): Position {
    const position: Position = {
      id: generateId(),
      mint: params.mint.toBase58(),
      name: params.name,
      symbol: params.symbol,
      bondingCurvePda: params.bondingCurvePda.toBase58(),
      solSpentLamports: params.solSpentLamports,
      tokenAmountHeld: params.tokenAmountHeld,
      entryPrice: params.entryPrice,
      buySignature: params.buySignature,
      openedAt: Date.now(),
      status: 'open',
      peakPrice: params.entryPrice,
    };

    this.positions.set(params.mint.toBase58(), position);
    savePositions(this.getAllPositions());

    logger.info(
      `📂 Position opened: ${params.symbol} | ` +
      `Tokens: ${Number(params.tokenAmountHeld) / 1e6} | ` +
      `SOL spent: ${Number(params.solSpentLamports) / 1e9} | ` +
      `Tx: ${params.buySignature.slice(0, 8)}...`
    );

    this.emit('positionOpened', position);
    return position;
  }

  /** Update position with current bonding curve price. */
  updatePrice(mint: PublicKey, state: BondingCurveState): void {
    const position = this.positions.get(mint.toBase58());
    if (!position || position.status !== 'open') return;

    const currentValue = getSolForTokens(state, position.tokenAmountHeld);
    const pnlMultiplier = position.solSpentLamports > 0n
      ? Number(currentValue) / Number(position.solSpentLamports)
      : 0;

    const currentPrice = position.tokenAmountHeld > 0n
      ? (currentValue * BigInt(1e9)) / position.tokenAmountHeld
      : 0n;

    const peakPrice = position.peakPrice && currentPrice > position.peakPrice
      ? currentPrice
      : (position.peakPrice ?? currentPrice);

    position.currentPrice = currentPrice;
    position.peakPrice = peakPrice;
    position.unrealizedPnlLamports = currentValue - position.solSpentLamports;
    position.pnlMultiplier = pnlMultiplier;

    this.emit('positionUpdated', position);
  }

  /** Mark a position as being sold (prevent double-sells). */
  markSelling(mint: PublicKey): boolean {
    const position = this.positions.get(mint.toBase58());
    if (!position || position.status !== 'open') return false;
    position.status = 'selling';
    return true;
  }

  /** Close a position after a successful sell. */
  closePosition(mint: PublicKey, sellSignature: string, solReceived: bigint): void {
    const position = this.positions.get(mint.toBase58());
    if (!position) return;

    position.status = 'sold';
    position.sellSignature = sellSignature;
    position.closedAt = Date.now();
    position.realizedPnlLamports = solReceived - position.solSpentLamports;

    const pnlSol = Number(position.realizedPnlLamports) / 1e9;
    const pnlSign = pnlSol >= 0 ? '+' : '';
    const holdTime = ((position.closedAt - position.openedAt) / 1000).toFixed(1);

    logger.info(
      `💰 Position closed: ${position.symbol} | ` +
      `PnL: ${pnlSign}${pnlSol.toFixed(6)} SOL | ` +
      `Multiplier: ${position.pnlMultiplier?.toFixed(2)}x | ` +
      `Hold: ${holdTime}s | ` +
      `Tx: ${sellSignature.slice(0, 8)}...`
    );

    savePositions(this.getAllPositions());
    logTradeRecord(position);

    this.emit('positionClosed', position);
  }

  /** Mark a position as failed (buy or sell failed). */
  markFailed(mint: PublicKey): void {
    const position = this.positions.get(mint.toBase58());
    if (position) {
      position.status = 'failed';
    }
  }

  /** Revert a position from 'selling' back to 'open' if sell fails. */
  revertSelling(mint: PublicKey): void {
    const position = this.positions.get(mint.toBase58());
    if (position && position.status === 'selling') {
      position.status = 'open';
    }
  }

  getPosition(mint: PublicKey): Position | undefined {
    return this.positions.get(mint.toBase58());
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.status === 'open' || p.status === 'selling'
    );
  }

  getOpenPositionCount(): number {
    return this.getOpenPositions().length;
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  printSummary(): void {
    const all = this.getAllPositions();
    const closed = all.filter((p) => p.status === 'sold');
    const open = all.filter((p) => p.status === 'open');

    const totalPnl = closed.reduce(
      (sum, p) => sum + (p.realizedPnlLamports ?? 0n),
      0n
    );

    logger.info('═══════════════════════════════════════════');
    logger.info(`📊 Portfolio Summary`);
    logger.info(`   Open positions: ${open.length}`);
    logger.info(`   Closed positions: ${closed.length}`);
    logger.info(`   Total realized PnL: ${Number(totalPnl) / 1e9} SOL`);

    for (const pos of open) {
      const pnl = pos.pnlMultiplier ?? 0;
      const pnlStr = pnl >= 1 ? `+${((pnl - 1) * 100).toFixed(1)}%` : `-${((1 - pnl) * 100).toFixed(1)}%`;
      logger.info(`   🔓 ${pos.symbol}: ${pnlStr} (${pnl.toFixed(2)}x)`);
    }

    logger.info('═══════════════════════════════════════════');
  }
}
