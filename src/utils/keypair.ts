import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

let _keypair: Keypair | null = null;

export function getWalletKeypair(privateKeyBase58: string): Keypair {
  if (_keypair) return _keypair;

  try {
    const secretKey = bs58.decode(privateKeyBase58);
    _keypair = Keypair.fromSecretKey(secretKey);
    return _keypair;
  } catch (err) {
    // Try parsing as a JSON array (Solana CLI format)
    try {
      const arr = JSON.parse(privateKeyBase58) as number[];
      _keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
      return _keypair;
    } catch {
      throw new Error(
        `Invalid PRIVATE_KEY format. Expected Base58 string or JSON array of numbers. Error: ${err}`
      );
    }
  }
}
