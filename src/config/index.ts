import dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function parseNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`Invalid number for env var ${key}: "${val}"`);
  return n;
}

function parseBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val.toLowerCase() === 'true';
}

function parseTipPercentile(val: string): 25 | 50 | 75 | 95 {
  const n = parseInt(val, 10);
  if (n === 25 || n === 50 || n === 75 || n === 95) return n;
  throw new Error(`JITO_TIP_PERCENTILE must be 25, 50, 75, or 95. Got: ${val}`);
}

function parseMonitorMode(val: string): 'grpc' | 'websocket' {
  if (val === 'grpc' || val === 'websocket') return val;
  throw new Error(`MONITOR_MODE must be "grpc" or "websocket". Got: ${val}`);
}

function parseBlockedCreators(val: string): Set<string> {
  if (!val) return new Set();
  return new Set(val.split(',').map((s) => s.trim()).filter(Boolean));
}

function parseBlockedNamePatterns(val: string): RegExp[] {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, 'i'));
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const buyAmountSol = parseNumber('BUY_AMOUNT_SOL', 0.01);
  const minLiquiditySol = parseNumber('MIN_INITIAL_LIQUIDITY_SOL', 1);
  const maxLiquiditySol = parseNumber('MAX_INITIAL_LIQUIDITY_SOL', 85);

  _config = {
    privateKey: requireEnv('PRIVATE_KEY'),
    rpcUrl: requireEnv('RPC_URL'),
    rpcWsUrl: optionalEnv('RPC_WS_URL', requireEnv('RPC_URL').replace('https://', 'wss://').replace('http://', 'ws://')),

    grpcEndpoint: process.env['GRPC_ENDPOINT'] || undefined,
    grpcToken: process.env['GRPC_TOKEN'] || undefined,

    jitoBlockEngine: optionalEnv('JITO_BLOCK_ENGINE', 'mainnet.block-engine.jito.wtf:443'),
    jitoTipPercentile: parseTipPercentile(optionalEnv('JITO_TIP_PERCENTILE', '75')),

    buyAmountLamports: BigInt(Math.floor(buyAmountSol * 1e9)),
    slippageBps: parseNumber('SLIPPAGE_BPS', 500),
    priorityFeeMultiplier: parseNumber('PRIORITY_FEE_MULTIPLIER', 1.5),
    maxPositions: parseNumber('MAX_POSITIONS', 10),

    takeProfitMultiplier: parseNumber('TAKE_PROFIT_MULTIPLIER', 3.0),
    stopLossMultiplier: parseNumber('STOP_LOSS_MULTIPLIER', 0.5),
    trailingStopPct: parseNumber('TRAILING_STOP_PCT', 0),
    maxHoldDurationMs: parseNumber('MAX_HOLD_DURATION_MS', 600_000),
    sellPortionBps: parseNumber('SELL_PORTION_BPS', 10_000),

    minInitialLiquidityLamports: BigInt(Math.floor(minLiquiditySol * 1e9)),
    maxInitialLiquidityLamports: BigInt(Math.floor(maxLiquiditySol * 1e9)),
    requireSocialLinks: parseBool('REQUIRE_SOCIAL_LINKS', false),
    blockedNamePatterns: parseBlockedNamePatterns(optionalEnv('BLOCKED_NAME_PATTERNS', '')),
    blockedCreators: parseBlockedCreators(optionalEnv('BLOCKED_CREATORS', '')),

    monitorMode: parseMonitorMode(optionalEnv('MONITOR_MODE', 'websocket')),
    dryRun: parseBool('DRY_RUN', false),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
  };

  return _config;
}
