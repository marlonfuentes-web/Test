# 🎯 pump.fun Sniper

A high-speed Solana sniping tool that detects and buys newly launched [pump.fun](https://pump.fun) tokens in real-time, targeting early entry before price pumps.

> ⚠️ **Risk Warning**: Crypto trading involves significant financial risk. This tool is for educational purposes. Never invest more than you can afford to lose. New tokens on pump.fun are extremely high-risk — most go to zero.

---

## Features

- ⚡ **Sub-100ms detection** — WebSocket log subscription or Yellowstone gRPC
- 🏦 **Jito bundles** — MEV protection + priority execution, with direct RPC fallback
- 🎯 **Auto-sell** — Take profit, stop loss, trailing stop, time-based exit
- 🔍 **Token filters** — Block by creator, name patterns, liquidity range, social links
- 📊 **Portfolio tracking** — Real-time PnL, position management
- 🧪 **Dry run mode** — Test configuration without sending real transactions

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A Solana wallet with SOL for trades + fees
- RPC endpoint (recommended: [Helius](https://helius.dev), [QuickNode](https://quicknode.com), or [Triton](https://triton.one))
- (Optional) Jito-compatible RPC for bundle submission
- (Optional) Yellowstone gRPC endpoint for faster detection

### 2. Install

```bash
git clone <repo>
cd pumpfun-sniper
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
RPC_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Trading
BUY_AMOUNT_SOL=0.01        # SOL per snipe
SLIPPAGE_BPS=500           # 5% slippage
TAKE_PROFIT_MULTIPLIER=3.0 # Sell at 3x
STOP_LOSS_MULTIPLIER=0.5   # Sell at -50%
```

### 4. Run

```bash
# Dry run (no real transactions)
DRY_RUN=true npm run snipe

# Live trading
npm run snipe
```

---

## Configuration

See [`.env.example`](.env.example) for all options with descriptions.

### Key Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_AMOUNT_SOL` | `0.01` | SOL to spend per snipe |
| `SLIPPAGE_BPS` | `500` | Slippage tolerance (1 bps = 0.01%) |
| `TAKE_PROFIT_MULTIPLIER` | `3.0` | Sell when value reaches 3x entry |
| `STOP_LOSS_MULTIPLIER` | `0.5` | Sell when value drops to 0.5x entry |
| `TRAILING_STOP_PCT` | `0` | Trailing stop % from peak (0 = disabled) |
| `MAX_HOLD_DURATION_MS` | `600000` | Force sell after 10 minutes |
| `MAX_POSITIONS` | `10` | Max concurrent open positions |
| `MONITOR_MODE` | `websocket` | `websocket` or `grpc` |
| `JITO_TIP_PERCENTILE` | `75` | Jito tip aggressiveness (25/50/75/95) |

---

## Architecture

```
Monitor (WebSocket/gRPC)
    │
    ▼ NewTokenEvent
TokenFilter (sync + async checks)
    │
    ▼ passed
BuyExecutor
    ├── fetchBondingCurveState()     — get current price
    ├── buildBuyInstruction()        — encode tx
    ├── buildTransaction()           — VersionedTransaction + compute budget
    └── sendBundle() / sendRaw()     — Jito or direct RPC
    │
    ▼ position opened
PortfolioManager
    │
    ▼ price updates (every 2s)
AutoSellStrategy
    ├── Take profit check
    ├── Stop loss check
    ├── Trailing stop check
    └── Time limit check
    │
    ▼ sell signal
SellExecutor
    └── same tx flow as buy
```

---

## RPC Recommendations

For best performance (lowest latency):

| Provider | WebSocket | gRPC | Notes |
|----------|-----------|------|-------|
| [Helius](https://helius.dev) | ✅ | ✅ | Best for pump.fun |
| [Quicknode](https://quicknode.com) | ✅ | ❌ | Good WS performance |
| [Triton](https://triton.one) | ✅ | ✅ | Professional grade |
| Public RPC | ✅ | ❌ | High latency, not recommended |

---

## pump.fun Protocol Details

- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Bonding curve**: Constant-product AMM with virtual reserves
- **Token supply**: 1,000,000,000 (1B) tokens with 6 decimals
- **Graduation**: Token migrates to Raydium at ~85 SOL in bonding curve

---

## File Structure

```
src/
├── index.ts              # Entry point
├── config/               # Configuration loading
├── constants/            # Program IDs, discriminators
├── monitor/              # Token detection (WS + gRPC)
├── filter/               # Token filtering
├── pumpfun/              # Protocol math + instruction builders
├── jito/                 # Jito bundle submission
├── transaction/          # Transaction building utilities
├── executor/             # Buy + sell orchestration
├── portfolio/            # Position tracking + price polling
├── strategy/             # Auto-sell logic
└── utils/                # Logger, retry, keypair
```

---

## Disclaimer

This software is provided "as is" without warranty of any kind. The authors are not responsible for any financial losses incurred through the use of this tool. Cryptocurrency trading is highly speculative and carries substantial risk of loss.
