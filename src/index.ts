/**
 * pump.fun Sniper — Main Entry Point
 *
 * Pipeline: Monitor → Filter → BuyExecutor → PortfolioManager → AutoSellStrategy → SellExecutor
 *
 * Usage:
 *   cp .env.example .env && nano .env    # Configure your wallet + RPC
 *   npm run snipe                        # Start sniping
 *   DRY_RUN=true npm run snipe           # Dry run (no real transactions)
 */

import { Connection } from '@solana/web3.js';
import { getConfig } from './config';
import { getWalletKeypair } from './utils/keypair';
import logger from './utils/logger';

import { WebSocketMonitor } from './monitor/WebSocketMonitor';
import { GrpcMonitor } from './monitor/GrpcMonitor';
import { NewTokenEvent } from './monitor/types';

import { TokenFilter } from './filter/TokenFilter';
import { BuyExecutor } from './executor/BuyExecutor';
import { SellExecutor } from './executor/SellExecutor';
import { PortfolioManager } from './portfolio/PortfolioManager';
import { PricePoller } from './portfolio/PricePoller';
import { AutoSellStrategy } from './strategy/AutoSellStrategy';

async function main() {
  // ── Load config ─────────────────────────────────────────────────────────
  const config = getConfig();
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('🎯  pump.fun Sniper  |  Catch those 100x tokens');
  logger.info('═══════════════════════════════════════════════════════');

  if (config.dryRun) {
    logger.warn('🧪 DRY RUN MODE — No real transactions will be sent');
  }

  // ── Initialize wallet ────────────────────────────────────────────────────
  const wallet = getWalletKeypair(config.privateKey);
  logger.info(`Wallet: ${wallet.publicKey.toBase58()}`);

  // ── Initialize RPC connection ────────────────────────────────────────────
  const connection = new Connection(config.rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: config.rpcWsUrl,
  });

  // Check connection
  try {
    const slot = await connection.getSlot();
    logger.info(`RPC connected | Current slot: ${slot}`);
  } catch (err) {
    logger.error(`Failed to connect to RPC: ${err}`);
    process.exit(1);
  }

  // Check wallet balance
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    const balanceSol = balance / 1e9;
    logger.info(`Wallet balance: ${balanceSol.toFixed(6)} SOL`);

    if (balance < Number(config.buyAmountLamports)) {
      logger.warn(
        `⚠️  Wallet balance (${balanceSol} SOL) is less than BUY_AMOUNT_SOL ` +
        `(${Number(config.buyAmountLamports) / 1e9} SOL)`
      );
    }
  } catch (err) {
    logger.warn(`Could not fetch wallet balance: ${err}`);
  }

  // ── Log configuration ────────────────────────────────────────────────────
  logger.info(`Buy amount: ${Number(config.buyAmountLamports) / 1e9} SOL`);
  logger.info(`Slippage: ${config.slippageBps / 100}%`);
  logger.info(`Take profit: ${config.takeProfitMultiplier}x`);
  logger.info(`Stop loss: ${config.stopLossMultiplier}x`);
  logger.info(`Max positions: ${config.maxPositions}`);
  logger.info(`Monitor mode: ${config.monitorMode}`);

  // ── Initialize modules ───────────────────────────────────────────────────
  const portfolio = new PortfolioManager();
  const pricePoller = new PricePoller(connection, portfolio);
  const filter = new TokenFilter(config);
  const buyExecutor = new BuyExecutor(connection, wallet, config, filter, portfolio);
  const sellExecutor = new SellExecutor(connection, wallet, config, portfolio);

  const autoSell = new AutoSellStrategy(portfolio, config, async (signal) => {
    await sellExecutor.execute(signal);
  });

  // ── Start price poller ───────────────────────────────────────────────────
  pricePoller.start();

  // ── Token detection handler ──────────────────────────────────────────────
  let tokensDetected = 0;
  let tokensSniped = 0;

  const handleNewToken = async (event: NewTokenEvent): Promise<void> => {
    tokensDetected++;
    const latencyMs = Date.now() - event.detectedAt;
    logger.info(
      `🔍 Token #${tokensDetected}: ${event.name} (${event.symbol}) | ` +
      `Mint: ${event.mint.toBase58().slice(0, 8)}... | ` +
      `Detection latency: ${latencyMs}ms`
    );

    try {
      await buyExecutor.execute(event);
    } catch (err) {
      logger.error(`Buy executor error for ${event.symbol}: ${err}`);
    }
  };

  // ── Start monitor ────────────────────────────────────────────────────────
  if (config.monitorMode === 'grpc' && config.grpcEndpoint && config.grpcToken) {
    logger.info(`Starting gRPC monitor: ${config.grpcEndpoint}`);
    const grpcMonitor = new GrpcMonitor(config.grpcEndpoint, config.grpcToken);

    grpcMonitor.on('newToken', handleNewToken);
    grpcMonitor.on('error', (err) => logger.error(`gRPC monitor error: ${err.message}`));
    grpcMonitor.on('connected', () => logger.info('✅ gRPC monitor connected'));
    grpcMonitor.on('disconnected', () => logger.warn('gRPC monitor disconnected'));

    await grpcMonitor.start();

    setupShutdown(() => {
      grpcMonitor.stop();
      pricePoller.stop();
      portfolio.printSummary();
    });
  } else {
    if (config.monitorMode === 'grpc') {
      logger.warn('gRPC mode requested but GRPC_ENDPOINT/GRPC_TOKEN not set — falling back to WebSocket');
    }

    logger.info(`Starting WebSocket monitor: ${config.rpcWsUrl}`);
    const wsMonitor = new WebSocketMonitor(connection, config.rpcWsUrl);

    wsMonitor.on('newToken', handleNewToken);
    wsMonitor.on('error', (err) => logger.error(`WebSocket error: ${err.message}`));
    wsMonitor.on('connected', () => logger.info('✅ WebSocket monitor connected'));
    wsMonitor.on('disconnected', () => logger.warn('WebSocket monitor disconnected'));

    wsMonitor.start();

    setupShutdown(() => {
      wsMonitor.stop();
      pricePoller.stop();
      portfolio.printSummary();
    });
  }

  // ── Stats loop ───────────────────────────────────────────────────────────
  setInterval(() => {
    const openCount = portfolio.getOpenPositionCount();
    if (openCount > 0) {
      logger.info(`📊 Stats | Detected: ${tokensDetected} | Open positions: ${openCount}`);
    }
  }, 60_000);

  logger.info('🚀 Sniper running — waiting for new tokens...');
}

function setupShutdown(cleanup: () => void): void {
  const handler = () => {
    logger.info('\nShutting down...');
    cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err}`);
    logger.error(err.stack ?? '');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
