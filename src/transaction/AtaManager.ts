import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { LRUCache } from 'lru-cache';
import logger from '../utils/logger';

// Cache whether an ATA exists to avoid repeated RPC calls
const ataExistenceCache = new LRUCache<string, boolean>({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
});

/**
 * Get the associated token account address for a wallet + mint pair.
 */
export function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner);
}

/**
 * Check if an ATA exists (with caching).
 * For new token launches, the ATA almost certainly doesn't exist yet.
 */
export async function ataExists(
  connection: Connection,
  ata: PublicKey
): Promise<boolean> {
  const cacheKey = ata.toBase58();
  const cached = ataExistenceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const info = await connection.getAccountInfo(ata, 'confirmed');
  const exists = info !== null;
  if (exists) {
    ataExistenceCache.set(cacheKey, true);
  }
  return exists;
}

/**
 * Mark an ATA as existing in the cache (call after successful buy).
 */
export function markAtaExists(ata: PublicKey): void {
  ataExistenceCache.set(ata.toBase58(), true);
}

/**
 * Build the idempotent createATA instruction.
 * This instruction is safe to include even if the ATA already exists —
 * it will simply be a no-op if it does.
 */
export function buildCreateAtaInstruction(
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): TransactionInstruction {
  const ata = getAta(mint, owner);
  return createAssociatedTokenAccountIdempotentInstruction(
    payer, // payer
    ata,   // associatedToken
    owner, // owner
    mint   // mint
  );
}

/**
 * Get or create ATA instruction for inclusion in a transaction.
 * Returns the ATA address and optionally a createATA instruction.
 *
 * Strategy: Always include the idempotent createATA instruction for new snipes
 * since we know the ATA won't exist for a brand-new token.
 */
export async function getAtaWithCreateInstruction(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  forceCreate = false
): Promise<{ ata: PublicKey; createInstruction: TransactionInstruction | null }> {
  const ata = getAta(mint, owner);

  // For brand-new tokens, always add the idempotent create instruction
  // It costs ~0.002 SOL if creating, nothing if already exists
  if (forceCreate) {
    const createInstruction = buildCreateAtaInstruction(mint, owner, payer);
    return { ata, createInstruction };
  }

  const exists = await ataExists(connection, ata);
  if (exists) {
    logger.debug(`ATA already exists: ${ata.toBase58()}`);
    return { ata, createInstruction: null };
  }

  const createInstruction = buildCreateAtaInstruction(mint, owner, payer);
  return { ata, createInstruction };
}
