/**
 * Demo simulation — shows realistic sniper output without a real RPC.
 * Run: npx ts-node scripts/demo.ts
 */

import { EventEmitter } from 'events';
import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ─── ANSI colours ────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const ts = () => {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`;
};

const log = (level: 'info'|'warn'|'error'|'debug', msg: string, meta?: Record<string,string>) => {
  const colours = { info: c.green, warn: c.yellow, error: c.red, debug: c.dim };
  const col = colours[level];
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.log(`${c.dim}${ts()}${c.reset} [${col}${level}${c.reset}] ${col}${msg}${c.reset}${metaStr}`);
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function randMint() {
  return bs58.encode(Keypair.generate().publicKey.toBuffer());
}

function randSig() {
  const bytes = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bs58.encode(bytes);
}

// Realistic pump.fun tokens (names inspired by what actually launches)
const TOKEN_POOL = [
  { name: 'Elon Cat',         symbol: 'ECAT',    liquidity: 0,       pass: false, reason: 'SOL too low' },
  { name: 'SolanaAI',         symbol: 'SAI',     liquidity: 3.2,     pass: true,  pnl: 4.1  },
  { name: 'RUGTOKEN',         symbol: 'RUG',     liquidity: 12,      pass: false, reason: 'Blocked by pattern: rug' },
  { name: 'PepeSol',          symbol: 'PSOL',    liquidity: 8.7,     pass: true,  pnl: 0.45 },
  { name: 'DogeMoon',         symbol: 'DOGM',    liquidity: 45,      pass: true,  pnl: 2.8  },
  { name: 'TestToken',        symbol: 'TEST',    liquidity: 2.1,     pass: false, reason: 'Suspicious name: TestToken (TEST)' },
  { name: 'BonkSon',         symbol: 'BKSON',   liquidity: 5.5,     pass: true,  pnl: 9.3  },
  { name: 'FakeFloki',        symbol: 'FFLOKI',  liquidity: 0.3,     pass: false, reason: 'SOL too low' },
  { name: 'Sol100x',          symbol: 'S100X',   liquidity: 18.2,    pass: true,  pnl: 1.2  },
  { name: 'WifHatSol',        symbol: 'WIFHAT',  liquidity: 31.0,    pass: true,  pnl: 6.7  },
];

interface Position {
  symbol: string;
  name: string;
  mint: string;
  tokens: number;
  solSpent: number;
  entryPrice: number;
  currentPrice: number;
  pnlMultiplier: number;
  buyTime: number;
  sig: string;
}

const positions = new Map<string, Position>();
let totalSniped = 0;
let totalDetected = 0;

async function simulateSnipe(token: typeof TOKEN_POOL[0], detectionLatency: number) {
  const mint = randMint();
  totalDetected++;

  log('info', `🔍 Token #${totalDetected}: ${token.name} (${token.symbol}) | Mint: ${mint.slice(0,8)}... | Detection latency: ${detectionLatency}ms`);

  await sleep(15 + Math.random() * 20); // curve fetch

  if (!token.pass) {
    log('debug', `⛔ Filtered out ${token.symbol}: ${token.reason}`);
    return;
  }

  const solSpent = 0.05;
  const buyTokens = Math.floor((1_000_000 * solSpent) / (token.liquidity / 30 + 0.001));
  const maxSol = solSpent * 1.1;
  const tip = 0.00187; // 75th percentile tip
  const priorityFee = 45_000; // µlamports

  log('info', `⚡ Attempting to snipe ${token.symbol} (${mint.slice(0,8)}...)`);
  await sleep(8);
  log('debug', `${token.symbol}: buying ${(buyTokens).toLocaleString()} tokens for max ${maxSol.toFixed(6)} SOL`);

  await sleep(12);

  const sig = randSig();
  const elapsed = detectionLatency + 45 + Math.floor(Math.random() * 30);

  log('info', `🧪 DRY RUN: Would buy ${token.symbol} | Tokens: ${buyTokens.toLocaleString()} | Max SOL: ${maxSol.toFixed(4)} | Tip: ${tip.toFixed(5)} SOL | Priority: ${priorityFee.toLocaleString()} µlam | Elapsed: ${elapsed}ms`);

  // Simulate position open
  const entryPrice = (solSpent / buyTokens) * 1e9;
  totalSniped++;

  const pos: Position = {
    symbol: token.symbol,
    name: token.name,
    mint,
    tokens: buyTokens,
    solSpent,
    entryPrice,
    currentPrice: entryPrice,
    pnlMultiplier: 1.0,
    buyTime: Date.now(),
    sig,
  };
  positions.set(mint, pos);

  log('info', `📂 Position opened: ${token.symbol} | Tokens: ${(buyTokens/1e6).toFixed(2)}M | SOL spent: ${solSpent} | Tx: ${sig.slice(0,8)}...`);

  // Simulate price movement over time then auto-sell
  simulatePriceMovement(pos, token.pnl ?? 1.0);
}

async function simulatePriceMovement(pos: Position, targetMultiplier: number) {
  const steps = 8;
  const stepDelay = 2000;

  for (let i = 0; i < steps; i++) {
    await sleep(stepDelay);

    if (!positions.has(pos.mint)) return;

    const progress = i / steps;
    // Simulate realistic pump: initial spike, plateau, then TP or SL
    let multiplier: number;
    if (targetMultiplier >= 3) {
      // pumping token
      multiplier = 1 + (targetMultiplier - 1) * Math.pow(progress, 0.7) + (Math.random() - 0.4) * 0.3;
    } else {
      // dumping token
      multiplier = 1 - (1 - targetMultiplier) * Math.pow(progress, 1.2) + (Math.random() - 0.5) * 0.1;
    }

    pos.pnlMultiplier = Math.max(0.01, multiplier);
    pos.currentPrice = pos.entryPrice * multiplier;

    const pnlSol = (pos.pnlMultiplier - 1) * pos.solSpent;
    const sign = pnlSol >= 0 ? '+' : '';

    // Check TP/SL
    if (pos.pnlMultiplier >= 3.0) {
      // Take profit
      await sleep(200);
      const sellSol = pos.solSpent * pos.pnlMultiplier;
      const realizedPnl = sellSol - pos.solSpent;
      const holdSec = ((Date.now() - pos.buyTime) / 1000).toFixed(1);

      log('info', `🎯 Take profit: ${pos.symbol} at ${pos.pnlMultiplier.toFixed(2)}x`);
      await sleep(300);
      log('info', `📤 Selling ${pos.symbol} | Trigger: takeProfit | Tokens: ${(pos.tokens/1e6).toFixed(2)}M | Reason: Take profit at ${pos.pnlMultiplier.toFixed(2)}x (target: 3.00x)`);
      await sleep(250);

      if (!process.env['DRY_RUN_SILENT']) {
        log('info', `🧪 DRY RUN: Would sell ${pos.symbol} | Min SOL out: ${(sellSol * 0.9).toFixed(6)} | Trigger: takeProfit`);
      }
      await sleep(100);
      log('info', `💰 Position closed: ${pos.symbol} | PnL: +${realizedPnl.toFixed(6)} SOL | Multiplier: ${pos.pnlMultiplier.toFixed(2)}x | Hold: ${holdSec}s | Tx: ${randSig().slice(0,8)}...`);

      positions.delete(pos.mint);
      return;
    }

    if (pos.pnlMultiplier <= 0.5) {
      // Stop loss
      const sellSol = pos.solSpent * pos.pnlMultiplier;
      const realizedPnl = sellSol - pos.solSpent;
      const holdSec = ((Date.now() - pos.buyTime) / 1000).toFixed(1);

      log('info', `🛑 Stop loss: ${pos.symbol} at ${pos.pnlMultiplier.toFixed(2)}x`);
      await sleep(300);
      log('info', `📤 Selling ${pos.symbol} | Trigger: stopLoss | Reason: Stop loss at ${pos.pnlMultiplier.toFixed(2)}x`);
      await sleep(250);
      log('info', `💰 Position closed: ${pos.symbol} | PnL: ${realizedPnl.toFixed(6)} SOL | Multiplier: ${pos.pnlMultiplier.toFixed(2)}x | Hold: ${holdSec}s | Tx: ${randSig().slice(0,8)}...`);

      positions.delete(pos.mint);
      return;
    }
  }

  // Time limit
  if (positions.has(pos.mint)) {
    const sellSol = pos.solSpent * pos.pnlMultiplier;
    const realizedPnl = sellSol - pos.solSpent;
    const holdSec = ((Date.now() - pos.buyTime) / 1000).toFixed(1);

    log('info', `⏰ Time limit reached for ${pos.symbol} — triggering sell`);
    await sleep(300);
    log('info', `💰 Position closed: ${pos.symbol} | PnL: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(6)} SOL | Multiplier: ${pos.pnlMultiplier.toFixed(2)}x | Hold: ${holdSec}s | Tx: ${randSig().slice(0,8)}...`);
    positions.delete(pos.mint);
  }
}

async function main() {
  console.log('');
  log('info', '═══════════════════════════════════════════════════════');
  log('info', '🎯  pump.fun Sniper  |  Catch those 100x tokens');
  log('info', '═══════════════════════════════════════════════════════');
  log('warn', '🧪 DRY RUN MODE — No real transactions will be sent');
  await sleep(50);
  log('info', 'Wallet: Hw8ztYdtproA3qfHYjuwVnhpJMyo9XZ3C8x9TtraDwhr');
  await sleep(300);
  log('info', 'RPC connected | Current slot: 334182847');
  log('info', 'Wallet balance: 2.841650 SOL');
  log('info', 'Buy amount: 0.05 SOL');
  log('info', 'Slippage: 10%');
  log('info', 'Take profit: 3x');
  log('info', 'Stop loss: 0.5x');
  log('info', 'Max positions: 5');
  log('info', 'Monitor mode: websocket');
  await sleep(400);
  log('info', 'Starting WebSocket monitor: wss://api.mainnet-beta.solana.com');
  await sleep(600);
  log('info', '✅ WebSocket monitor connected');
  log('info', 'Subscribed to pump.fun logs (subscription: 48291)');
  log('info', '🚀 Sniper running — waiting for new tokens...');
  console.log('');

  // Simulate tokens arriving at realistic intervals
  const delays = [3200, 5100, 2800, 7400, 4100, 6200, 3900, 8100, 2300, 5700];
  const latencies = [82, 94, 71, 88, 103, 76, 91, 85, 79, 96];

  for (let i = 0; i < TOKEN_POOL.length; i++) {
    await sleep(delays[i]);
    const token = TOKEN_POOL[i];
    await simulateSnipe(token, latencies[i]);
  }

  await sleep(3000);

  // Final summary
  console.log('');
  log('info', '═══════════════════════════════════════════════════════');
  log('info', `📊 Portfolio Summary`);
  log('info', `   Tokens detected: ${totalDetected}`);
  log('info', `   Snipes attempted: ${totalSniped}`);
  log('info', `   Filters rejected: ${totalDetected - totalSniped}`);
  log('info', '═══════════════════════════════════════════════════════');
  console.log('');

  process.exit(0);
}

main().catch(console.error);
