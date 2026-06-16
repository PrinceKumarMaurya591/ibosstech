import express from 'express';
import cors from 'cors';
import http from 'http';
import WebSocket from 'ws';

import { authenticate } from './auth';
import { sessionManager } from './sessionManager';

// Data source adapters
import * as okx from './okx';
import * as binance from './binance';

// ============================================================
// Configuration
// ============================================================

const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;
const MARKET_REFRESH_INTERVAL_MS = 10000; // 10 seconds

// Select data source: 'okx' (default) or 'binance'
const DATA_SOURCE = (process.env.DATA_SOURCE || 'okx').toLowerCase();
console.log(`[Server] Data source: ${DATA_SOURCE}`);

// Type definitions for the data source adapter
interface TickerData {
  symbol: string;
  lastPrice: string;
  change24h: string;
  change24hPercent: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

interface OrderBookData {
  bids: { price: string; size: string; count: string }[];
  asks: { price: string; size: string; count: string }[];
  timestamp: string;
}

type OrderBookCallback = (data: OrderBookData) => void;
type UnsubscribeFn = () => void;

interface DataSource {
  fetchTop20Pairs: () => Promise<TickerData[]>;
  fetchTicker: (symbol: string) => Promise<TickerData | null>;
  subscribeOrderBook: (symbol: string, callback: OrderBookCallback) => UnsubscribeFn;
}

// Select the active data source
const activeSource: DataSource = (() => {
  if (DATA_SOURCE === 'binance') {
    return {
      fetchTop20Pairs: binance.fetchTop20Pairs,
      fetchTicker: binance.fetchTicker,
      subscribeOrderBook: (symbol: string, cb: OrderBookCallback) =>
        binance.binanceWsManager.subscribeOrderBook(symbol, cb),
    };
  }
  // Default: OKX
  return {
    fetchTop20Pairs: okx.fetchTop20Pairs,
    fetchTicker: okx.fetchTicker,
    subscribeOrderBook: (symbol: string, cb: OrderBookCallback) =>
      okx.okxWsManager.subscribeOrderBook(symbol, cb),
  };
})();

// ============================================================
// Express REST API Server
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

// In-memory cache for market data
let cachedTop20: TickerData[] = [];
let lastMarketFetch: number = 0;
let consecutiveFailures = 0;

/**
 * Fetch and cache top 20 pairs. Uses cached data if within refresh interval.
 * Implements exponential backoff when the API is unreachable.
 */
async function getTop20Pairs(forceRefresh: boolean = false): Promise<TickerData[]> {
  const now = Date.now();
  if (!forceRefresh && cachedTop20.length > 0 && now - lastMarketFetch < MARKET_REFRESH_INTERVAL_MS) {
    return cachedTop20;
  }

  try {
    cachedTop20 = await activeSource.fetchTop20Pairs();
    lastMarketFetch = now;
    if (consecutiveFailures > 0) {
      console.log(`[Market] Back online - fetched ${cachedTop20.length} top pairs (after ${consecutiveFailures} failures)`);
      consecutiveFailures = 0;
    } else {
      console.log(`[Market] Fetched ${cachedTop20.length} top pairs`);
    }
  } catch (err: any) {
    consecutiveFailures++;
    if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
      console.error(`[Market] Failed to fetch top pairs (attempt ${consecutiveFailures}):`, err.message);
    }
  }

  return cachedTop20;
}

// Warm the cache on startup
getTop20Pairs(true);

// Periodically refresh market data
setInterval(() => getTop20Pairs(true), MARKET_REFRESH_INTERVAL_MS);

// Clean up stale sessions periodically
setInterval(() => {
  sessionManager.cleanupStaleSessions();
  console.log(`[Server] Active sessions: ${sessionManager.getActiveSessionCount()}`);
}, 60000);

// ============================================================
// REST Endpoints
// ============================================================

/**
 * POST /api/login
 * Authenticate user and create a session.
 * This enforces single-session-per-client: if the user already
 * has an active session, it will be invalidated.
 */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const result = authenticate(username, password);
  if (!result.success) {
    return res.status(401).json({ success: false, message: result.message });
  }

  // Create session (invalidates any existing session for this user)
  const sessionId = sessionManager.createSession(result.username!);

  return res.json({
    success: true,
    message: 'Login successful',
    sessionId,
    username: result.username,
  });
});

/**
 * POST /api/logout
 * End a session.
 */
app.post('/api/logout', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    sessionManager.removeSession(sessionId);
  }
  return res.json({ success: true, message: 'Logged out' });
});

/**
 * GET /api/market/top20
 * Get the top 20 spot pairs.
 * Requires a valid sessionId query parameter.
 */
app.get('/api/market/top20', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId || !sessionManager.validateSession(sessionId)) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  try {
    const data = await getTop20Pairs();
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/market/ticker?symbol=BTC-USDT
 * Get ticker for a specific symbol.
 */
app.get('/api/market/ticker', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId || !sessionManager.validateSession(sessionId)) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  const symbol = req.query.symbol as string;
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Symbol is required' });
  }

  try {
    const data = await activeSource.fetchTicker(symbol);
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/health
 * Health check endpoint.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeSessions: sessionManager.getActiveSessionCount(),
    cachedPairs: cachedTop20.length,
    dataSource: DATA_SOURCE,
  });
});

// Start REST server
const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`[Server] REST API running on http://localhost:${PORT}`);
});

// ============================================================
// WebSocket Server for Order Book Streaming
// ============================================================

const wss = new WebSocket.Server({ port: Number(WS_PORT) });
console.log(`[Server] WebSocket server running on ws://localhost:${WS_PORT}`);

/**
 * Send a JSON message to a WebSocket client.
 */
function sendToClient(ws: WebSocket, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Send an error message to a WebSocket client.
 */
function sendError(ws: WebSocket, message: string, code?: string): void {
  sendToClient(ws, { type: 'error', code: code || 'ERROR', message });
}

// Track client subscriptions: clientWs -> { symbol, unsubscribe function }
const clientSubscriptions = new Map<WebSocket, { symbol: string; unsubscribe: () => void }>();

wss.on('connection', (ws: WebSocket) => {
  console.log(`[WS Server] New client connection`);

  let authenticated = false;
  let clientSessionId: string | null = null;

  /**
   * Handle authentication message.
   * Expected: { type: "auth", sessionId: "..." }
   */
  function handleAuth(data: any): void {
    if (!data.sessionId) {
      sendError(ws, 'sessionId is required', 'AUTH_REQUIRED');
      return;
    }

    const username = sessionManager.validateSession(data.sessionId);
    if (!username) {
      sendError(ws, 'Invalid or expired session', 'AUTH_FAILED');
      return;
    }

    sessionManager.attachWebSocket(data.sessionId, ws);

    authenticated = true;
    clientSessionId = data.sessionId;
    sendToClient(ws, { type: 'auth_ok', message: 'Authenticated' });
    console.log(`[WS Server] Client authenticated: ${username}`);
  }

  /**
   * Handle order book subscription.
   * Expected: { type: "subscribe", symbol: "BTC-USDT" }
   */
  function handleSubscribe(data: any): void {
    if (!authenticated) {
      sendError(ws, 'Please authenticate first', 'AUTH_REQUIRED');
      return;
    }

    const symbol = data.symbol?.toUpperCase();
    if (!symbol) {
      sendError(ws, 'Symbol is required');
      return;
    }

    // Unsubscribe from previous subscription if any
    const existing = clientSubscriptions.get(ws);
    if (existing) {
      existing.unsubscribe();
      clientSubscriptions.delete(ws);
    }

    // Subscribe using the active data source
    const unsubscribe = activeSource.subscribeOrderBook(symbol, (orderBook) => {
      sendToClient(ws, {
        type: 'orderbook',
        symbol,
        data: orderBook,
      });
    });

    clientSubscriptions.set(ws, { symbol, unsubscribe });
    sendToClient(ws, { type: 'subscribed', symbol });
    console.log(`[WS Server] Client subscribed to ${symbol} via ${DATA_SOURCE}`);
  }

  /**
   * Handle unsubscription.
   */
  function handleUnsubscribe(): void {
    const existing = clientSubscriptions.get(ws);
    if (existing) {
      existing.unsubscribe();
      clientSubscriptions.delete(ws);
      sendToClient(ws, { type: 'unsubscribed' });
      console.log(`[WS Server] Client unsubscribed`);
    }
  }

  ws.on('message', (raw: Buffer) => {
    try {
      const data = JSON.parse(raw.toString());

      switch (data.type) {
        case 'auth':
          handleAuth(data);
          break;
        case 'subscribe':
          handleSubscribe(data);
          break;
        case 'unsubscribe':
          handleUnsubscribe();
          break;
        default:
          sendError(ws, `Unknown message type: ${data.type}`);
      }
    } catch (e) {
      sendError(ws, 'Invalid JSON');
    }
  });

  ws.on('close', () => {
    console.log(`[WS Server] Client disconnected`);

    const existing = clientSubscriptions.get(ws);
    if (existing) {
      existing.unsubscribe();
      clientSubscriptions.delete(ws);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Server] Client error:`, err.message);
  });
});
