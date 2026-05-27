export interface Config {
  // Wallet
  privateKey: string;

  // RPC
  rpcUrl: string;
  rpcWsUrl: string;

  // gRPC (optional)
  grpcEndpoint?: string;
  grpcToken?: string;

  // Jito
  jitoBlockEngine: string;
  jitoTipPercentile: 25 | 50 | 75 | 95;

  // Trading
  buyAmountLamports: bigint;
  slippageBps: number;
  priorityFeeMultiplier: number;
  maxPositions: number;

  // Auto-sell strategy
  takeProfitMultiplier: number;
  stopLossMultiplier: number;
  trailingStopPct: number;
  maxHoldDurationMs: number;
  sellPortionBps: number;

  // Filters
  minInitialLiquidityLamports: bigint;
  maxInitialLiquidityLamports: bigint;
  requireSocialLinks: boolean;
  blockedNamePatterns: RegExp[];
  blockedCreators: Set<string>;

  // Mode
  monitorMode: 'grpc' | 'websocket';
  dryRun: boolean;
  logLevel: string;
}
