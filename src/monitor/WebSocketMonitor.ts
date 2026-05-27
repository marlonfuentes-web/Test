import { EventEmitter } from 'events';
import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import WebSocket from 'ws';
import { NewTokenEvent } from './types';
import { PUMP_FUN_PROGRAM_ID, BONDING_CURVE_SEED } from '../constants';
import { getBondingCurvePda } from '../pumpfun/AccountDecoder';
import logger from '../utils/logger';
import { sleep } from '../utils/retry';

export declare interface WebSocketMonitor {
  on(event: 'newToken', listener: (token: NewTokenEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
}

export class WebSocketMonitor extends EventEmitter {
  private ws: WebSocket | null = null;
  private connection: Connection;
  private wsUrl: string;
  private subscriptionId: number | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private isRunning = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(connection: Connection, wsUrl: string) {
    super();
    this.connection = connection;
    this.wsUrl = wsUrl;
  }

  start(): void {
    this.isRunning = true;
    this.connect();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info('WebSocket monitor stopped');
  }

  private connect(): void {
    logger.info(`Connecting to WebSocket: ${this.wsUrl}`);

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      logger.info('WebSocket connected — subscribing to pump.fun logs');
      this.reconnectAttempts = 0;
      this.emit('connected');
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
      this.emit('error', err);
    });

    this.ws.on('close', () => {
      logger.warn('WebSocket disconnected');
      this.emit('disconnected');
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.scheduleReconnect();
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [PUMP_FUN_PROGRAM_ID.toBase58()] },
        { commitment: 'processed' },
      ],
    });

    this.ws.send(subscribeMsg);
    logger.debug('Sent logsSubscribe request');
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30_000);
  }

  private handleMessage(rawMessage: string): void {
    try {
      const msg = JSON.parse(rawMessage);

      // Handle subscription confirmation
      if (msg.id === 1 && msg.result !== undefined) {
        this.subscriptionId = msg.result;
        logger.info(`Subscribed to pump.fun logs (subscription: ${this.subscriptionId})`);
        return;
      }

      // Handle log notifications
      if (msg.method === 'logsNotification') {
        const { value } = msg.params.result;
        const { signature, logs, err } = value;

        // Skip failed transactions
        if (err) return;

        // Check if this is a Create instruction
        const isCreate = logs.some((log: string) =>
          log.includes('Program log: Instruction: Create') ||
          log.includes('Instruction: Create')
        );

        if (isCreate) {
          logger.debug(`New pump.fun create tx detected: ${signature}`);
          this.processCreateTransaction(signature).catch((err) => {
            logger.debug(`Failed to process create tx ${signature}: ${err.message}`);
          });
        }
      }
    } catch (err) {
      // Ignore parse errors
    }
  }

  private async processCreateTransaction(signature: string): Promise<void> {
    try {
      // Fetch the full transaction to extract mint + metadata
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || !tx.transaction) return;

      const event = this.extractNewTokenEvent(tx, signature);
      if (event) {
        logger.info(`🚀 New token: ${event.symbol} (${event.mint.toBase58().slice(0, 8)}...)`);
        this.emit('newToken', event);
      }
    } catch (err) {
      logger.debug(`Error processing tx ${signature}: ${err}`);
    }
  }

  private extractNewTokenEvent(
    tx: ParsedTransactionWithMeta,
    signature: string
  ): NewTokenEvent | null {
    try {
      const accountKeys = tx.transaction.message.accountKeys;
      if (accountKeys.length < 8) return null;

      // In the pump.fun Create instruction, the mint is account at index 0
      // and the user/creator is the fee payer (first signer)
      // We need to find the mint by looking at account roles

      // The bonding curve PDA is always present in create transactions
      // Look for an account that when used as a seed produces a PDA owned by pump.fun
      // Alternatively: the mint is the account that gets InitializeMint2 invoked on it

      let mintPubkey: PublicKey | null = null;
      let creatorPubkey: PublicKey | null = null;

      // Find the signer (creator)
      const signer = accountKeys.find(k => k.signer);
      if (signer) creatorPubkey = new PublicKey(signer.pubkey);

      // Find mint: look for account that appears in SPL token InitializeMint
      const innerInstructions = tx.meta?.innerInstructions ?? [];
      for (const inner of innerInstructions) {
        for (const ix of inner.instructions) {
          if ('program' in ix && ix.program === 'spl-token') {
            const parsed = ix as { program: string; parsed?: { type: string; info?: { mint?: string } } };
            if (parsed.parsed?.type === 'initializeMint' || parsed.parsed?.type === 'initializeMint2') {
              const mintStr = parsed.parsed?.info?.mint;
              if (mintStr) {
                mintPubkey = new PublicKey(mintStr);
                break;
              }
            }
          }
        }
        if (mintPubkey) break;
      }

      // Fallback: look for the account that matches [bonding-curve, account] PDA pattern
      if (!mintPubkey) {
        for (const key of accountKeys) {
          try {
            const pubkey = new PublicKey(key.pubkey);
            const pda = getBondingCurvePda(pubkey);
            const pdaStr = pda.toBase58();
            if (accountKeys.some(k => k.pubkey.toString() === pdaStr)) {
              mintPubkey = pubkey;
              break;
            }
          } catch {
            // Not a valid pubkey
          }
        }
      }

      if (!mintPubkey || !creatorPubkey) return null;

      const bondingCurvePda = getBondingCurvePda(mintPubkey);

      // Extract name/symbol from log data if available
      // pump.fun logs: "Program log: {"name":"...","symbol":"...","uri":"..."}"
      const logs = tx.meta?.logMessages ?? [];
      let name = 'Unknown';
      let symbol = 'UNKNOWN';
      let metadataUri = '';

      for (const log of logs) {
        if (log.startsWith('Program log: {"name"') || log.includes('"name"') && log.includes('"symbol"')) {
          try {
            const jsonStart = log.indexOf('{');
            if (jsonStart !== -1) {
              const parsed = JSON.parse(log.slice(jsonStart)) as {
                name?: string;
                symbol?: string;
                uri?: string;
              };
              if (parsed.name) name = parsed.name;
              if (parsed.symbol) symbol = parsed.symbol;
              if (parsed.uri) metadataUri = parsed.uri;
              break;
            }
          } catch {
            // Not JSON
          }
        }
      }

      return {
        mint: mintPubkey,
        bondingCurvePda,
        creator: creatorPubkey,
        name,
        symbol,
        metadataUri,
        signature,
        slot: tx.slot,
        detectedAt: Date.now(),
      };
    } catch (err) {
      logger.debug(`Failed to extract token event: ${err}`);
      return null;
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (!this.isRunning) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached. Stopping monitor.');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
    logger.warn(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    await sleep(delay);

    if (this.isRunning) {
      this.connect();
    }
  }
}
