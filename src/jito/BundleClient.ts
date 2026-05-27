import axios from 'axios';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '../utils/logger';
import { retry } from '../utils/retry';

export interface BundleResult {
  bundleId: string;
  landed: boolean;
  error?: string;
}

/**
 * Submit a Jito bundle via the REST API.
 * A bundle is an ordered list of transactions (max 5) that are executed atomically.
 * The first transaction is typically the tip payment.
 *
 * Using the REST API instead of gRPC searcherClient for simplicity and reliability.
 * Endpoint: POST https://<block-engine>/api/v1/bundles
 */
export class BundleClient {
  private readonly bundleUrl: string;

  constructor(blockEngineUrl: string) {
    // Strip :443 suffix for HTTPS URL construction
    const host = blockEngineUrl.replace(':443', '');
    this.bundleUrl = `https://${host}/api/v1/bundles`;
  }

  /**
   * Submit a bundle of transactions.
   * Transactions must be signed and serialized.
   * The tip transaction MUST be first in the array.
   */
  async sendBundle(transactions: VersionedTransaction[]): Promise<BundleResult> {
    if (transactions.length === 0 || transactions.length > 5) {
      throw new Error(`Bundle must have 1-5 transactions, got ${transactions.length}`);
    }

    const encodedTxs = transactions.map((tx) =>
      bs58.encode(tx.serialize())
    );

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [encodedTxs],
    };

    const result = await retry(
      async () => {
        const response = await axios.post<{
          result?: string;
          error?: { code: number; message: string };
        }>(this.bundleUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        });

        if (response.data.error) {
          throw new Error(`Jito bundle error: ${response.data.error.message}`);
        }

        const bundleId = response.data.result;
        if (!bundleId) {
          throw new Error('No bundle ID in response');
        }

        return bundleId;
      },
      { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
      'Jito bundle submission'
    );

    logger.info(`Jito bundle submitted: ${result}`);
    return { bundleId: result, landed: true };
  }

  /**
   * Get the status of a submitted bundle.
   */
  async getBundleStatuses(bundleIds: string[]): Promise<unknown> {
    try {
      const response = await axios.post(
        this.bundleUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [bundleIds],
        },
        { timeout: 3000 }
      );
      return response.data;
    } catch (err) {
      logger.warn(`Failed to get bundle status: ${err}`);
      return null;
    }
  }
}
