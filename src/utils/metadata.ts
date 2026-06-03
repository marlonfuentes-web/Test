import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import axios from 'axios';
import { TokenMetadata } from '../monitor/types';
import logger from './logger';

/**
 * Fetch token metadata from on-chain Metaplex metadata account.
 *
 * pump.fun tokens store metadata via Metaplex Token Metadata program.
 * The metadata account PDA: findProgramAddress(["metadata", METADATA_PROGRAM_ID, mint], METADATA_PROGRAM_ID)
 *
 * We also support falling back to the off-chain URI stored in the account.
 */

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const METADATA_SEED = 'metadata';

export interface OnChainTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  offChain?: TokenMetadata;
}

/**
 * Derive the Metaplex metadata account PDA for a mint.
 */
export function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(METADATA_SEED),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Fetch on-chain token metadata from Metaplex metadata account.
 * Parses the raw account data to extract name, symbol, and URI.
 */
export async function fetchOnChainMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<OnChainTokenInfo | null> {
  try {
    const metadataPda = getMetadataPda(mint);
    const accountInfo = await connection.getAccountInfo(metadataPda, 'confirmed');
    if (!accountInfo) return null;

    const data = Buffer.from(accountInfo.data);

    // Metaplex metadata layout (after discriminator):
    // key: 1 byte
    // update_authority: 32 bytes
    // mint: 32 bytes
    // name: u32 length prefix + chars
    // symbol: u32 length prefix + chars
    // uri: u32 length prefix + chars

    let offset = 1 + 32 + 32; // skip key + update_authority + mint

    const readString = (): string => {
      if (offset + 4 > data.length) return '';
      const len = data.readUInt32LE(offset);
      offset += 4;
      if (len === 0 || offset + len > data.length) return '';
      const str = data.slice(offset, offset + len).toString('utf8').replace(/\0/g, '').trim();
      offset += len;
      return str;
    };

    const name = readString();
    const symbol = readString();
    const uri = readString();

    return { mint: mint.toBase58(), name, symbol, uri };
  } catch (err) {
    logger.debug(`Failed to fetch on-chain metadata for ${mint.toBase58()}: ${err}`);
    return null;
  }
}

/**
 * Fetch off-chain metadata JSON from the URI stored in the Metaplex account.
 * pump.fun stores token image, description, and social links here.
 */
export async function fetchOffChainMetadata(uri: string): Promise<TokenMetadata | null> {
  if (!uri || uri.trim() === '') return null;
  try {
    const response = await axios.get<TokenMetadata>(uri, { timeout: 3000 });
    return response.data;
  } catch (err) {
    logger.debug(`Failed to fetch off-chain metadata from ${uri}: ${err}`);
    return null;
  }
}

/**
 * Fetch complete token info: on-chain + off-chain metadata.
 */
export async function fetchTokenInfo(
  connection: Connection,
  mint: PublicKey
): Promise<OnChainTokenInfo | null> {
  const onChain = await fetchOnChainMetadata(connection, mint);
  if (!onChain) return null;

  if (onChain.uri) {
    const offChain = await fetchOffChainMetadata(onChain.uri);
    if (offChain) {
      onChain.offChain = offChain;
      // Prefer off-chain name/symbol if more complete
      if (offChain.name) onChain.name = offChain.name;
      if (offChain.symbol) onChain.symbol = offChain.symbol;
    }
  }

  return onChain;
}
