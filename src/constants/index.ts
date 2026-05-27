import { PublicKey } from '@solana/web3.js';

// ─── pump.fun Program ────────────────────────────────────────────────────────
export const PUMP_FUN_PROGRAM_ID = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
);

export const PUMP_FUN_FEE_RECIPIENT = new PublicKey(
  'CebN5WGQ4jvEPvsVU4EoHEpgznyQHeMKZHEMJn2aWE2'
);

export const PUMP_FUN_EVENT_AUTHORITY = new PublicKey(
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'
);

export const PUMP_FUN_GLOBAL_STATE = new PublicKey(
  '4wTV81avi73KGp6kpNqFVmMHZqQBGvxVYKDFgxL8xhFr'
);

export const PUMP_FUN_MINT_AUTHORITY = new PublicKey(
  'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'
);

// ─── Instruction Discriminators ──────────────────────────────────────────────
// First 8 bytes of sha256("global:<instruction_name>")
export const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
export const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
export const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

// ─── Bonding Curve Seeds ─────────────────────────────────────────────────────
export const BONDING_CURVE_SEED = 'bonding-curve';
export const GLOBAL_SEED = 'global';
export const EVENT_AUTHORITY_SEED = '__event_authority';

// ─── Bonding Curve Initial Virtual Reserves ──────────────────────────────────
// These are the starting values for every new pump.fun token
export const INITIAL_VIRTUAL_TOKEN_RESERVES = BigInt('1073000000000000'); // 1,073,000,000 tokens (6 decimals)
export const INITIAL_VIRTUAL_SOL_RESERVES = BigInt('30000000000');        // 30 SOL in lamports
export const TOKEN_TOTAL_SUPPLY = BigInt('1000000000000000');              // 1,000,000,000 tokens (6 decimals)

// ─── Jito ────────────────────────────────────────────────────────────────────
export const JITO_TIP_ACCOUNTS = [
  new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
  new PublicKey('HFqU5x63VTqvB6pCQFdHR2SN7q1oEFSbcXHxPHRFP1ZE'),
  new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
  new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt13yfRiqB'),
  new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
  new PublicKey('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
  new PublicKey('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
  new PublicKey('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
];

export const JITO_BLOCK_ENGINE_URLS = [
  'mainnet.block-engine.jito.wtf:443',
  'ny.mainnet.block-engine.jito.wtf:443',
  'amsterdam.mainnet.block-engine.jito.wtf:443',
  'frankfurt.mainnet.block-engine.jito.wtf:443',
  'tokyo.mainnet.block-engine.jito.wtf:443',
];

export const JITO_TIP_API_URL = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';

// ─── Solana Program Addresses ─────────────────────────────────────────────────
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bry');
export const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');

// ─── Compute Budget Defaults ─────────────────────────────────────────────────
export const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;
export const MIN_PRIORITY_FEE_MICRO_LAMPORTS = 1_000;
export const MAX_PRIORITY_FEE_MICRO_LAMPORTS = 10_000_000;

// ─── Blockhash Cache TTL ─────────────────────────────────────────────────────
export const BLOCKHASH_CACHE_TTL_MS = 10_000; // reuse blockhash for up to 10s
