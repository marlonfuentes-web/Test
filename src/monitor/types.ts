import { PublicKey } from '@solana/web3.js';

export interface NewTokenEvent {
  /** The new token's mint address */
  mint: PublicKey;
  /** The bonding curve PDA for this token */
  bondingCurvePda: PublicKey;
  /** Creator's wallet address */
  creator: PublicKey;
  /** Token name from metadata */
  name: string;
  /** Token symbol (ticker) */
  symbol: string;
  /** URI pointing to off-chain metadata JSON */
  metadataUri: string;
  /** Transaction signature that created the token */
  signature: string;
  /** Slot when the token was created */
  slot: number;
  /** Timestamp when we detected this event (ms) */
  detectedAt: number;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}
