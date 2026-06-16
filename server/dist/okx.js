"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.okxWsManager = void 0;
exports.fetchTop20Pairs = fetchTop20Pairs;
exports.fetchTicker = fetchTicker;
const ws_1 = __importDefault(require("ws"));
const https_1 = __importDefault(require("https"));
// ============================================================
// OKX REST API client
// ============================================================
const OKX_REST_BASE = 'https://www.okx.com';
const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
/**
 * Make a REST API call to OKX.
 */
function okxRequest(path) {
    return new Promise((resolve, reject) => {
        const url = `${OKX_REST_BASE}${path}`;
        https_1.default
            .get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error(`Failed to parse OKX response: ${data}`));
                }
            });
        })
            .on('error', (err) => reject(err));
    });
}
/**
 * Fetch the top 20 spot trading pairs by 24h volume from OKX.
 * OKX's /api/v5/market/tickers returns all tickers sorted by volume (descending).
 * We filter for SPOT pairs only and take the top 20.
 */
async function fetchTop20Pairs() {
    const response = await okxRequest('/api/v5/market/tickers?instType=SPOT');
    if (!response || response.code !== '0' || !response.data) {
        throw new Error(`OKX API error: ${JSON.stringify(response)}`);
    }
    // OKX returns tickers sorted by 24h volume descending by default
    const top20 = response.data.slice(0, 20).map((t) => ({
        symbol: t.instId,
        lastPrice: t.last || '0',
        change24h: t.open24h ? (parseFloat(t.last) - parseFloat(t.open24h)).toFixed(t.last?.includes('.') ? t.last.split('.')[1].length : 2) : '0',
        change24hPercent: t.open24h
            ? (((parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h)) * 100).toFixed(2)
            : '0',
        volume24h: t.volCcy24h || t.vol24h || '0',
        high24h: t.high24h || '0',
        low24h: t.low24h || '0',
    }));
    return top20;
}
/**
 * Fetch ticker for a single symbol.
 */
async function fetchTicker(symbol) {
    const response = await okxRequest(`/api/v5/market/ticker?instId=${symbol}`);
    if (!response || response.code !== '0' || !response.data || response.data.length === 0) {
        return null;
    }
    const t = response.data[0];
    return {
        symbol: t.instId,
        lastPrice: t.last || '0',
        change24h: t.open24h ? (parseFloat(t.last) - parseFloat(t.open24h)).toFixed(t.last?.includes('.') ? t.last.split('.')[1].length : 2) : '0',
        change24hPercent: t.open24h
            ? (((parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h)) * 100).toFixed(2)
            : '0',
        volume24h: t.volCcy24h || t.vol24h || '0',
        high24h: t.high24h || '0',
        low24h: t.low24h || '0',
    };
}
/**
 * Manages a WebSocket connection to OKX for order book data.
 * Only one connection per symbol is maintained and shared across clients.
 */
class OkxWebSocketManager {
    constructor() {
        this.connections = new Map();
        this.reconnectTimers = new Map();
    }
    /**
     * Subscribe to order book updates for a symbol.
     * Returns an unsubscribe function.
     */
    subscribeOrderBook(symbol, callback) {
        let connection = this.connections.get(symbol);
        if (!connection) {
            connection = { ws: null, subscribers: new Set() };
            this.connections.set(symbol, connection);
            this.connect(symbol);
        }
        connection.subscribers.add(callback);
        // Return unsubscribe function
        return () => {
            const conn = this.connections.get(symbol);
            if (conn) {
                conn.subscribers.delete(callback);
                if (conn.subscribers.size === 0) {
                    this.disconnect(symbol);
                }
            }
        };
    }
    connect(symbol) {
        const conn = this.connections.get(symbol);
        if (!conn)
            return;
        console.log(`[OKX WS] Connecting to order book for ${symbol}...`);
        const ws = new ws_1.default(OKX_WS_URL);
        ws.on('open', () => {
            console.log(`[OKX WS] Connected for ${symbol}`);
            // Subscribe to order book channel
            const subscribeMsg = {
                op: 'subscribe',
                args: [
                    {
                        channel: 'books',
                        instId: symbol,
                    },
                ],
            };
            ws.send(JSON.stringify(subscribeMsg));
        });
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                // Handle subscription response
                if (msg.event === 'subscribe' || msg.event === 'error') {
                    console.log(`[OKX WS] Event for ${symbol}:`, msg.event, msg.msg || '');
                    return;
                }
                // Handle order book data
                if (msg.arg && msg.arg.channel === 'books' && msg.data) {
                    const bookData = msg.data[0];
                    const orderBookData = {
                        bids: (bookData.bids || []).map((b) => ({
                            price: b[0],
                            size: b[1],
                            count: b[3] || '0',
                        })),
                        asks: (bookData.asks || []).map((a) => ({
                            price: a[0],
                            size: a[1],
                            count: a[3] || '0',
                        })),
                        timestamp: bookData.ts || String(Date.now()),
                    };
                    // Notify all subscribers
                    const conn = this.connections.get(symbol);
                    if (conn) {
                        conn.subscribers.forEach((cb) => {
                            try {
                                cb(orderBookData);
                            }
                            catch (e) {
                                console.error(`[OKX WS] Subscriber error for ${symbol}:`, e);
                            }
                        });
                    }
                }
            }
            catch (e) {
                console.error(`[OKX WS] Failed to parse message for ${symbol}:`, e);
            }
        });
        ws.on('close', (code, reason) => {
            console.log(`[OKX WS] Disconnected from ${symbol}: ${code} ${reason}`);
            // Auto-reconnect if there are still subscribers
            const conn = this.connections.get(symbol);
            if (conn && conn.subscribers.size > 0) {
                const timer = setTimeout(() => {
                    this.connect(symbol);
                }, 3000); // Reconnect after 3 seconds
                this.reconnectTimers.set(symbol, timer);
            }
        });
        ws.on('error', (err) => {
            console.error(`[OKX WS] Error for ${symbol}:`, err.message);
            ws.close();
        });
        conn.ws = ws;
    }
    disconnect(symbol) {
        const timer = this.reconnectTimers.get(symbol);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(symbol);
        }
        const conn = this.connections.get(symbol);
        if (conn && conn.ws) {
            conn.ws.close(1000, 'No more subscribers');
        }
        this.connections.delete(symbol);
        console.log(`[OKX WS] Disconnected ${symbol} - no more subscribers`);
    }
}
exports.okxWsManager = new OkxWebSocketManager();
//# sourceMappingURL=okx.js.map