import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import { NewTokenEvent } from './types';
import { PUMP_FUN_PROGRAM_ID, CREATE_DISCRIMINATOR } from '../constants';
import { getBondingCurvePda } from '../pumpfun/AccountDecoder';
import logger from '../utils/logger';

export declare interface GrpcMonitor {
  on(event: 'newToken', listener: (token: NewTokenEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
}

/**
 * Yellowstone gRPC monitor for pump.fun new token creations.
 *
 * Faster than WebSocket because:
 * 1. Full transaction data is delivered inline (no extra getTransaction RPC call)
 * 2. gRPC streaming has lower latency than WebSocket JSON parsing
 * 3. Transaction filter runs server-side (less data over the wire)
 *
 * Requires a Yellowstone-compatible RPC endpoint (Helius, Triton, etc.)
 */
export class GrpcMonitor extends EventEmitter {
  private endpoint: string;
  private token: string;
  private isRunning = false;
  private client: unknown = null;
  private stream: unknown = null;

  constructor(endpoint: string, token: string) {
    super();
    this.endpoint = endpoint;
    this.token = token;
  }

  async start(): Promise<void> {
    this.isRunning = true;

    try {
      // Dynamic import to avoid requiring gRPC deps when using WebSocket mode
      const { default: Client, CommitmentLevel } = await import(
        '@triton-one/yellowstone-grpc'
      ) as typeof import('@triton-one/yellowstone-grpc');

      this.client = new Client(this.endpoint, this.token, {
        'grpc.max_receive_message_length': 128 * 1024 * 1024,
      });

      const clientWithStream = this.client as {
        subscribe: () => Promise<{
          write: (data: unknown) => Promise<void>;
          on: (event: string, listener: (data: unknown) => void) => void;
        }>;
      };

      this.stream = await clientWithStream.subscribe();
      const stream = this.stream as {
        write: (data: unknown) => Promise<void>;
        on: (event: string, listener: (data: unknown) => void) => void;
      };

      logger.info('gRPC stream opened — subscribing to pump.fun transactions');
      this.emit('connected');

      // Subscribe to transactions mentioning the pump.fun program
      await stream.write({
        slots: {},
        accounts: {},
        transactions: {
          pumpfunCreate: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_FUN_PROGRAM_ID.toBase58()],
            accountExclude: [],
            accountRequired: [],
          },
        },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: [],
        ping: undefined,
        commitment: 1, // processed
      });

      stream.on('data', (data: unknown) => {
        this.handleUpdate(data);
      });

      stream.on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(`gRPC stream error: ${error.message}`);
        this.emit('error', error);
        if (this.isRunning) {
          setTimeout(() => this.start(), 3000);
        }
      });

      stream.on('end', () => {
        logger.warn('gRPC stream ended');
        this.emit('disconnected');
        if (this.isRunning) {
          setTimeout(() => this.start(), 3000);
        }
      });
    } catch (err) {
      logger.error(`Failed to start gRPC monitor: ${err}`);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));

      if (this.isRunning) {
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    const stream = this.stream as { cancel?: () => void } | null;
    if (stream?.cancel) stream.cancel();
    logger.info('gRPC monitor stopped');
  }

  private handleUpdate(data: unknown): void {
    try {
      const update = data as {
        transaction?: {
          slot?: number | bigint;
          transaction?: {
            signatures?: Uint8Array[];
            transaction?: {
              message?: {
                accountKeys?: Uint8Array[];
                instructions?: Array<{
                  programIdIndex?: number;
                  data?: Uint8Array;
                }>;
              };
            };
            meta?: {
              logMessages?: string[];
              err?: unknown;
            };
          };
        };
      };

      if (!update.transaction) return;

      const txUpdate = update.transaction;
      const tx = txUpdate.transaction;
      if (!tx) return;

      // Skip failed transactions
      if (tx.meta?.err) return;

      const message = tx.transaction?.message;
      if (!message) return;

      const accountKeys = message.accountKeys ?? [];
      const instructions = message.instructions ?? [];

      // Check if any instruction matches the pump.fun program + CREATE discriminator
      const pumpFunProgramIndex = accountKeys.findIndex((key) => {
        try {
          return new PublicKey(key).equals(PUMP_FUN_PROGRAM_ID);
        } catch { return false; }
      });

      if (pumpFunProgramIndex === -1) return;

      const createIx = instructions.find((ix) => {
        if (ix.programIdIndex !== pumpFunProgramIndex) return false;
        if (!ix.data || ix.data.length < 8) return false;
        return CREATE_DISCRIMINATOR.every((byte, i) => ix.data![i] === byte);
      });

      if (!createIx) return;

      // Extract mint from account keys
      // In the create instruction, accounts are: [mint, mintAuthority, bondingCurve, ...]
      // The mint is typically at accountKeys index that maps to ix.accounts[0]
      const logs = tx.meta?.logMessages ?? [];
      const slot = Number(txUpdate.slot ?? 0);
      const signatures = tx.signatures ?? [];
      const signature = signatures[0]
        ? Buffer.from(signatures[0]).toString('base64')
        : 'unknown';

      // Parse name/symbol from logs
      let name = 'Unknown';
      let symbol = 'UNKNOWN';
      let metadataUri = '';

      for (const log of logs) {
        if (log.includes('"name"') && log.includes('"symbol"')) {
          try {
            const jsonStart = log.indexOf('{');
            if (jsonStart !== -1) {
              const parsed = JSON.parse(log.slice(jsonStart)) as {
                name?: string; symbol?: string; uri?: string;
              };
              if (parsed.name) name = parsed.name;
              if (parsed.symbol) symbol = parsed.symbol;
              if (parsed.uri) metadataUri = parsed.uri;
              break;
            }
          } catch { /* not JSON */ }
        }
      }

      // Find mint: first non-program account key that could be a mint
      // In pump.fun create: accounts[0]=mint, accounts[2]=bondingCurve
      let mintPubkey: PublicKey | null = null;
      if (accountKeys.length > 0) {
        try {
          // The mint is usually the first non-system account in create instructions
          for (const rawKey of accountKeys) {
            const key = new PublicKey(rawKey);
            if (!key.equals(PUMP_FUN_PROGRAM_ID)) {
              // Try to verify it's the mint by deriving bondingCurve and checking if it's in accounts
              const bondingCurvePda = getBondingCurvePda(key);
              const bondingCurveStr = bondingCurvePda.toBase58();
              const hasBondingCurve = accountKeys.some((k) => {
                try { return new PublicKey(k).toBase58() === bondingCurveStr; }
                catch { return false; }
              });
              if (hasBondingCurve) {
                mintPubkey = key;
                break;
              }
            }
          }
        } catch { /* skip */ }
      }

      if (!mintPubkey) return;

      const bondingCurvePda = getBondingCurvePda(mintPubkey);

      // Find creator (signer)
      let creatorPubkey = new PublicKey(accountKeys[0]);

      const event: NewTokenEvent = {
        mint: mintPubkey,
        bondingCurvePda,
        creator: creatorPubkey,
        name,
        symbol,
        metadataUri,
        signature,
        slot,
        detectedAt: Date.now(),
      };

      logger.info(`🚀 [gRPC] New token: ${symbol} (${mintPubkey.toBase58().slice(0, 8)}...)`);
      this.emit('newToken', event);
    } catch (err) {
      logger.debug(`gRPC update parse error: ${err}`);
    }
  }
}
