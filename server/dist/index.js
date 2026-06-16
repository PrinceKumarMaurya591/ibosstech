"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const ws_1 = __importDefault(require("ws"));
const auth_1 = require("./auth");
const sessionManager_1 = require("./sessionManager");
// Data source adapters
const okx = __importStar(require("./okx"));
const binance = __importStar(require("./binance"));
// ============================================================
// Configuration
// ============================================================
const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;
const MARKET_REFRESH_INTERVAL_MS = 10000; // 10 seconds
// Select data source: 'okx' (default) or 'binance'
const DATA_SOURCE = (process.env.DATA_SOURCE || 'okx').toLowerCase();
console.log(`[Server] Data source: ${DATA_SOURCE}`);
// Select the active data source
const activeSource = (() => {
    if (DATA_SOURCE === 'binance') {
        return {
            fetchTop20Pairs: binance.fetchTop20Pairs,
            fetchTicker: binance.fetchTicker,
            subscribeOrderBook: (symbol, cb) => binance.binanceWsManager.subscribeOrderBook(symbol, cb),
        };
    }
    // Default: OKX
    return {
        fetchTop20Pairs: okx.fetchTop20Pairs,
        fetchTicker: okx.fetchTicker,
        subscribeOrderBook: (symbol, cb) => okx.okxWsManager.subscribeOrderBook(symbol, cb),
    };
})();
// ============================================================
// Express REST API Server
// ============================================================
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// In-memory cache for market data
let cachedTop20 = [];
let lastMarketFetch = 0;
let consecutiveFailures = 0;
/**
 * Fetch and cache top 20 pairs. Uses cached data if within refresh interval.
 * Implements exponential backoff when the API is unreachable.
 */
async function getTop20Pairs(forceRefresh = false) {
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
        }
        else {
            console.log(`[Market] Fetched ${cachedTop20.length} top pairs`);
        }
    }
    catch (err) {
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
    sessionManager_1.sessionManager.cleanupStaleSessions();
    console.log(`[Server] Active sessions: ${sessionManager_1.sessionManager.getActiveSessionCount()}`);
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
    const result = (0, auth_1.authenticate)(username, password);
    if (!result.success) {
        return res.status(401).json({ success: false, message: result.message });
    }
    // Create session (invalidates any existing session for this user)
    const sessionId = sessionManager_1.sessionManager.createSession(result.username);
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
        sessionManager_1.sessionManager.removeSession(sessionId);
    }
    return res.json({ success: true, message: 'Logged out' });
});
/**
 * GET /api/market/top20
 * Get the top 20 spot pairs.
 * Requires a valid sessionId query parameter.
 */
app.get('/api/market/top20', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !sessionManager_1.sessionManager.validateSession(sessionId)) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    try {
        const data = await getTop20Pairs();
        return res.json({ success: true, data });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});
/**
 * GET /api/market/ticker?symbol=BTC-USDT
 * Get ticker for a specific symbol.
 */
app.get('/api/market/ticker', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !sessionManager_1.sessionManager.validateSession(sessionId)) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    const symbol = req.query.symbol;
    if (!symbol) {
        return res.status(400).json({ success: false, message: 'Symbol is required' });
    }
    try {
        const data = await activeSource.fetchTicker(symbol);
        return res.json({ success: true, data });
    }
    catch (err) {
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
        activeSessions: sessionManager_1.sessionManager.getActiveSessionCount(),
        cachedPairs: cachedTop20.length,
        dataSource: DATA_SOURCE,
    });
});
// Start REST server
const httpServer = http_1.default.createServer(app);
httpServer.listen(PORT, () => {
    console.log(`[Server] REST API running on http://localhost:${PORT}`);
});
// ============================================================
// WebSocket Server for Order Book Streaming
// ============================================================
const wss = new ws_1.default.Server({ port: Number(WS_PORT) });
console.log(`[Server] WebSocket server running on ws://localhost:${WS_PORT}`);
/**
 * Send a JSON message to a WebSocket client.
 */
function sendToClient(ws, data) {
    if (ws.readyState === ws_1.default.OPEN) {
        ws.send(JSON.stringify(data));
    }
}
/**
 * Send an error message to a WebSocket client.
 */
function sendError(ws, message, code) {
    sendToClient(ws, { type: 'error', code: code || 'ERROR', message });
}
// Track client subscriptions: clientWs -> { symbol, unsubscribe function }
const clientSubscriptions = new Map();
wss.on('connection', (ws) => {
    console.log(`[WS Server] New client connection`);
    let authenticated = false;
    let clientSessionId = null;
    /**
     * Handle authentication message.
     * Expected: { type: "auth", sessionId: "..." }
     */
    function handleAuth(data) {
        if (!data.sessionId) {
            sendError(ws, 'sessionId is required', 'AUTH_REQUIRED');
            return;
        }
        const username = sessionManager_1.sessionManager.validateSession(data.sessionId);
        if (!username) {
            sendError(ws, 'Invalid or expired session', 'AUTH_FAILED');
            return;
        }
        sessionManager_1.sessionManager.attachWebSocket(data.sessionId, ws);
        authenticated = true;
        clientSessionId = data.sessionId;
        sendToClient(ws, { type: 'auth_ok', message: 'Authenticated' });
        console.log(`[WS Server] Client authenticated: ${username}`);
    }
    /**
     * Handle order book subscription.
     * Expected: { type: "subscribe", symbol: "BTC-USDT" }
     */
    function handleSubscribe(data) {
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
    function handleUnsubscribe() {
        const existing = clientSubscriptions.get(ws);
        if (existing) {
            existing.unsubscribe();
            clientSubscriptions.delete(ws);
            sendToClient(ws, { type: 'unsubscribed' });
            console.log(`[WS Server] Client unsubscribed`);
        }
    }
    ws.on('message', (raw) => {
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
        }
        catch (e) {
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
//# sourceMappingURL=index.js.map