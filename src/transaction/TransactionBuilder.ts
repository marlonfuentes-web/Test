import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  BlockhashWithExpiryBlockHeight,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BLOCKHASH_CACHE_TTL_MS, DEFAULT_COMPUTE_UNIT_LIMIT } from '../constants';
import logger from '../utils/logger';

// Blockhash cache
let cachedBlockhash: { value: BlockhashWithExpiryBlockHeight; cachedAt: number } | null = null;

/**
 * Get a recent blockhash, using cache to avoid extra RPC calls on the hot path.
 */
export async function getCachedBlockhash(
  connection: Connection,
  forceRefresh = false
): Promise<BlockhashWithExpiryBlockHeight> {
  const now = Date.now();

  if (!forceRefresh && cachedBlockhash && now - cachedBlockhash.cachedAt < BLOCKHASH_CACHE_TTL_MS) {
    return cachedBlockhash.value;
  }

  const result = await connection.getLatestBlockhash('confirmed');
  cachedBlockhash = { value: result, cachedAt: now };
  return result;
}

export interface BuildTransactionParams {
  connection: Connection;
  payer: Keypair;
  instructions: TransactionInstruction[];
  computeUnitLimit?: number;
  computeUnitPrice?: number; // micro-lamports per CU
  blockhash?: BlockhashWithExpiryBlockHeight;
}

/**
 * Build a signed VersionedTransaction (v0) with compute budget instructions prepended.
 */
export async function buildTransaction(
  params: BuildTransactionParams
): Promise<VersionedTransaction> {
  const {
    connection,
    payer,
    instructions,
    computeUnitLimit = DEFAULT_COMPUTE_UNIT_LIMIT,
    computeUnitPrice = 1000,
  } = params;

  const blockhash = params.blockhash ?? await getCachedBlockhash(connection);

  const computeBudgetInstructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
  ];

  const allInstructions = [...computeBudgetInstructions, ...instructions];

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: allInstructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);

  return transaction;
}

/**
 * Build a simple SOL transfer transaction (used for Jito tip).
 */
export async function buildTipTransaction(
  connection: Connection,
  payer: Keypair,
  tipAccount: PublicKey,
  tipLamports: bigint
): Promise<VersionedTransaction> {
  const blockhash = await getCachedBlockhash(connection);

  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: tipAccount,
    lamports: tipLamports,
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [transferIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return tx;
}

/**
 * Send a transaction directly via RPC (fallback when Jito bundle fails).
 * Uses skipPreflight for maximum speed.
 */
export async function sendRawTransaction(
  connection: Connection,
  transaction: VersionedTransaction
): Promise<string> {
  const serialized = transaction.serialize();

  const signature = await connection.sendRawTransaction(serialized, {
    skipPreflight: true,
    maxRetries: 3,
    preflightCommitment: 'processed',
  });

  logger.debug(`Direct RPC tx sent: ${signature}`);
  return signature;
}
