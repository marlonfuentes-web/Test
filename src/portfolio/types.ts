import { PublicKey } from '@solana/web3.js';

export type PositionStatus = 'pending' | 'open' | 'selling' | 'sold' | 'failed';

export interface Position {
  /** Unique ID for this position */
  id: string;
  /** Token mint address */
  mint: string;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Bonding curve PDA */
  bondingCurvePda: string;
  /** SOL spent on the buy (lamports) */
  solSpentLamports: bigint;
  /** Number of tokens held (base units, 6 decimals) */
  tokenAmountHeld: bigint;
  /** Token price at entry (lamports per token base unit × 1e9 for precision) */
  entryPrice: bigint;
  /** Buy transaction signature */
  buySignature: string;
  /** Timestamp of buy */
  openedAt: number;
  /** Current position status */
  status: PositionStatus;
  /** Current token price (updated by PricePoller) */
  currentPrice?: bigint;
  /** Peak price seen (for trailing stop) */
  peakPrice?: bigint;
  /** Current unrealized PnL in lamports */
  unrealizedPnlLamports?: bigint;
  /** Current PnL multiplier (e.g., 1.5 = 50% gain) */
  pnlMultiplier?: number;
  /** Sell transaction signature */
  sellSignature?: string;
  /** Timestamp of sell */
  closedAt?: number;
  /** Actual realized PnL in lamports */
  realizedPnlLamports?: bigint;
}
