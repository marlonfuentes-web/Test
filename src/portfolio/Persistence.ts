import fs from 'fs';
import path from 'path';
import { Position } from './types';
import logger from '../utils/logger';

const POSITIONS_FILE = path.join(process.cwd(), 'data', 'positions.json');

/**
 * Save all positions to disk so they survive process restarts.
 * Positions are serialized with BigInt values converted to strings.
 */
export function savePositions(positions: Position[]): void {
  try {
    const dir = path.dirname(POSITIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const serialized = positions.map(serializePosition);
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`Failed to save positions: ${err}`);
  }
}

/**
 * Load positions from disk on startup.
 */
export function loadPositions(): Position[] {
  try {
    if (!fs.existsSync(POSITIONS_FILE)) return [];
    const raw = fs.readFileSync(POSITIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as ReturnType<typeof serializePosition>[];
    return parsed.map(deserializePosition);
  } catch (err) {
    logger.warn(`Failed to load positions: ${err}`);
    return [];
  }
}

/**
 * Append a trade record to a simple CSV log for analysis.
 */
export function logTradeRecord(position: Position): void {
  try {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const csvFile = path.join(dir, 'trades.csv');
    const header = 'date,symbol,mint,side,solAmount,tokens,pnlSol,pnlMultiplier,holdSeconds,signature\n';

    if (!fs.existsSync(csvFile)) {
      fs.writeFileSync(csvFile, header, 'utf8');
    }

    const holdSec = position.closedAt
      ? ((position.closedAt - position.openedAt) / 1000).toFixed(1)
      : '';

    const row = [
      new Date(position.openedAt).toISOString(),
      position.symbol,
      position.mint,
      position.status === 'sold' ? 'sell' : 'open',
      (Number(position.solSpentLamports) / 1e9).toFixed(6),
      (Number(position.tokenAmountHeld) / 1e6).toFixed(2),
      position.realizedPnlLamports !== undefined
        ? (Number(position.realizedPnlLamports) / 1e9).toFixed(6)
        : '',
      position.pnlMultiplier?.toFixed(4) ?? '',
      holdSec,
      position.sellSignature ?? position.buySignature,
    ].join(',');

    fs.appendFileSync(csvFile, row + '\n', 'utf8');
  } catch (err) {
    logger.warn(`Failed to log trade record: ${err}`);
  }
}

// ─── Serialization helpers (BigInt ↔ string) ─────────────────────────────────

type SerializedPosition = Omit<
  Position,
  | 'solSpentLamports'
  | 'tokenAmountHeld'
  | 'entryPrice'
  | 'currentPrice'
  | 'peakPrice'
  | 'unrealizedPnlLamports'
  | 'realizedPnlLamports'
> & {
  solSpentLamports: string;
  tokenAmountHeld: string;
  entryPrice: string;
  currentPrice?: string;
  peakPrice?: string;
  unrealizedPnlLamports?: string;
  realizedPnlLamports?: string;
};

function serializePosition(pos: Position): SerializedPosition {
  return {
    ...pos,
    solSpentLamports: pos.solSpentLamports.toString(),
    tokenAmountHeld: pos.tokenAmountHeld.toString(),
    entryPrice: pos.entryPrice.toString(),
    currentPrice: pos.currentPrice?.toString(),
    peakPrice: pos.peakPrice?.toString(),
    unrealizedPnlLamports: pos.unrealizedPnlLamports?.toString(),
    realizedPnlLamports: pos.realizedPnlLamports?.toString(),
  };
}

function deserializePosition(raw: SerializedPosition): Position {
  return {
    ...raw,
    solSpentLamports: BigInt(raw.solSpentLamports),
    tokenAmountHeld: BigInt(raw.tokenAmountHeld),
    entryPrice: BigInt(raw.entryPrice),
    currentPrice: raw.currentPrice !== undefined ? BigInt(raw.currentPrice) : undefined,
    peakPrice: raw.peakPrice !== undefined ? BigInt(raw.peakPrice) : undefined,
    unrealizedPnlLamports:
      raw.unrealizedPnlLamports !== undefined ? BigInt(raw.unrealizedPnlLamports) : undefined,
    realizedPnlLamports:
      raw.realizedPnlLamports !== undefined ? BigInt(raw.realizedPnlLamports) : undefined,
  };
}
