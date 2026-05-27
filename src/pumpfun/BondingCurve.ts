/**
 * pump.fun Bonding Curve Math
 *
 * pump.fun uses a constant-product virtual AMM:
 *   virtualSolReserves * virtualTokenReserves = k  (constant)
 *
 * When you buy: SOL flows in, tokens flow out
 * When you sell: tokens flow in, SOL flows out
 *
 * All values use BigInt for precision (no floating point).
 * SOL amounts are in lamports (1 SOL = 1,000,000,000 lamports).
 * Token amounts include 6 decimal places (1 token = 1,000,000 base units).
 */

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

/**
 * Calculate how many tokens you receive for a given SOL amount.
 * Uses the constant-product formula: xy = k
 */
export function getTokensForSol(
  state: BondingCurveState,
  solLamports: bigint
): bigint {
  if (solLamports <= 0n) return 0n;

  // new_virtual_sol = virtual_sol + sol_in
  // new_virtual_tokens = k / new_virtual_sol = (virtual_sol * virtual_tokens) / new_virtual_sol
  // tokens_out = virtual_tokens - new_virtual_tokens
  const newVirtualSolReserves = state.virtualSolReserves + solLamports;
  const newVirtualTokenReserves =
    (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualSolReserves;
  const tokensOut = state.virtualTokenReserves - newVirtualTokenReserves;

  // Can't receive more tokens than the real reserves hold
  return tokensOut > state.realTokenReserves ? state.realTokenReserves : tokensOut;
}

/**
 * Calculate how much SOL you need to pay to receive a specific number of tokens.
 */
export function getSolCostForTokens(
  state: BondingCurveState,
  tokenAmount: bigint
): bigint {
  if (tokenAmount <= 0n) return 0n;
  if (tokenAmount >= state.virtualTokenReserves) {
    // Would drain the curve — return max possible cost
    return BigInt(Number.MAX_SAFE_INTEGER);
  }

  // new_virtual_tokens = virtual_tokens - tokens_out
  // new_virtual_sol = k / new_virtual_tokens
  // sol_cost = new_virtual_sol - virtual_sol
  const newVirtualTokenReserves = state.virtualTokenReserves - tokenAmount;
  const newVirtualSolReserves =
    (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualTokenReserves;
  return newVirtualSolReserves - state.virtualSolReserves;
}

/**
 * Calculate how much SOL you receive for selling a specific number of tokens.
 */
export function getSolForTokens(
  state: BondingCurveState,
  tokenAmount: bigint
): bigint {
  if (tokenAmount <= 0n) return 0n;

  // new_virtual_tokens = virtual_tokens + tokens_in
  // new_virtual_sol = k / new_virtual_tokens
  // sol_out = virtual_sol - new_virtual_sol
  const newVirtualTokenReserves = state.virtualTokenReserves + tokenAmount;
  const newVirtualSolReserves =
    (state.virtualSolReserves * state.virtualTokenReserves) / newVirtualTokenReserves;
  const solOut = state.virtualSolReserves - newVirtualSolReserves;

  // Can't receive more SOL than the real reserves hold
  return solOut > state.realSolReserves ? state.realSolReserves : solOut;
}

/**
 * Apply slippage tolerance to a buy cost.
 * Returns the maximum SOL you're willing to pay (including slippage).
 */
export function applyBuySlippage(solCost: bigint, slippageBps: number): bigint {
  return (solCost * BigInt(10_000 + slippageBps)) / 10_000n;
}

/**
 * Apply slippage tolerance to a sell output.
 * Returns the minimum SOL you're willing to receive (accounting for slippage).
 */
export function applySellSlippage(solOut: bigint, slippageBps: number): bigint {
  return (solOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Get the current token price in lamports per token (6 decimal base unit).
 */
export function getCurrentPricePerToken(state: BondingCurveState): bigint {
  if (state.virtualTokenReserves === 0n) return 0n;
  return (state.virtualSolReserves * BigInt(1e9)) / state.virtualTokenReserves;
}

/**
 * Get market cap in lamports (price per token * total supply).
 */
export function getMarketCap(state: BondingCurveState): bigint {
  const pricePerTokenNano = getCurrentPricePerToken(state);
  return (pricePerTokenNano * state.tokenTotalSupply) / BigInt(1e9);
}

/**
 * Calculate PnL multiplier: current value / entry cost
 * Returns a float (e.g., 2.5 = 150% gain)
 */
export function getPnlMultiplier(
  state: BondingCurveState,
  tokenAmountHeld: bigint,
  solSpentLamports: bigint
): number {
  if (solSpentLamports === 0n) return 0;
  const currentValueLamports = getSolForTokens(state, tokenAmountHeld);
  return Number(currentValueLamports) / Number(solSpentLamports);
}

/**
 * Format lamports as human-readable SOL string.
 */
export function formatSol(lamports: bigint): string {
  return `${(Number(lamports) / 1e9).toFixed(6)} SOL`;
}

/**
 * Format token amount (base units with 6 decimals) as human-readable.
 */
export function formatTokens(amount: bigint): string {
  return (Number(amount) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
