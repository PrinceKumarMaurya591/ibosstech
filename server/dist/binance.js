"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.binanceWsManager = void 0;
exports.fetchTop20Pairs = fetchTop20Pairs;
exports.fetchTicker = fetchTicker;
const ws_1 = __importDefault(require("ws"));
const https_1 = __importDefault(require("https"));
// ============================================================
// Binance REST API client
// ============================================================
const BINANCE_REST_BASE = 'https://api.binance.com';
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
/**
 * Make a REST API call to Binance.
 */
function binanceRequest(path) {
    return new Promise((resolve, reject) => {
        const url = `${BINANCE_REST_BASE}${path}`;
        https_1.default
            .get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error(`Failed to parse Binance response: ${data.substring(0, 200)}`));
                }
            });
        })
            .on('error', (err) => reject(err));
    });
}
/**
 * Convert Binance symbol format (BTCUSDT) to standard format (BTC-USDT).
 */
function toStandardSymbol(binanceSymbol) {
    // Binance uses BTCUSDT, we want BTC-USDT
    // Find the quote asset: USDT, USDC, BUSD, etc.
    const quoteAssets = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD'];
    for (const quote of quoteAssets) {
        if (binanceSymbol.endsWith(quote) && binanceSymbol.length > quote.length) {
            const base = binanceSymbol.substring(0, binanceSymbol.length - quote.length);
            return `${base}-${quote}`;
        }
    }
    return binanceSymbol;
}
/**
 * Convert standard symbol (BTC-USDT) to Binance format (BTCUSDT).
 */
function toBinanceSymbol(standard) {
    return standard.replace('-', '');
}
/**
 * Fetch the top 20 spot trading pairs by 24h volume from Binance.
 * Binance's /api/v3/ticker/24hr returns all tickers.
 * We filter for USDT pairs and take the top 20 by volume.
 */
async function fetchTop20Pairs() {
    const response = await binanceRequest('/api/v3/ticker/24hr');
    if (!Array.isArray(response)) {
        throw new Error(`Binance API error: ${JSON.stringify(response).substring(0, 200)}`);
    }
    // Filter for USDT pairs and sort by volume descending
    const usdtPairs = response
        .filter((t) => t.symbol.endsWith('USDT'))
        .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'));
    const top20 = usdtPairs.slice(0, 20).map((t) => ({
        symbol: toStandardSymbol(t.symbol),
        lastPrice: t.lastPrice || '0',
        change24h: t.priceChange || '0',
        change24hPercent: t.priceChangePercent || '0',
        volume24h: t.quoteVolume || t.volume || '0',
        high24h: t.highPrice || '0',
        low24h: t.lowPrice || '0',
    }));
    return top20;
}
/**
 * Fetch ticker for a single symbol.
 */
async function fetchTicker(symbol) {
    const binanceSymbol = toBinanceSymbol(symbol);
    const response = await binanceRequest(`/api/v3/ticker/24hr?symbol=${binanceSymbol}`);
    if (!response || response.code === -1121) {
        return null;
    }
    return {
        symbol: toStandardSymbol(response.symbol),
        lastPrice: response.lastPrice || '0',
        change24h: response.priceChange || '0',
        change24hPercent: response.priceChangePercent || '0',
        volume24h: response.quoteVolume || response.volume || '0',
        high24h: response.highPrice || '0',
        low24h: response.lowPrice || '0',
    };
}
/**
 * Manages a WebSocket connection to Binance for order book data.
 */
class BinanceWebSocketManager {
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
        const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
        const streamName = `${binanceSymbol}@depth20@100ms`;
        const wsUrl = `${BINANCE_WS_URL}/${streamName}`;
        console.log(`[Binance WS] Connecting to order book for ${symbol}...`);
        const ws = new ws_1.default(wsUrl);
        ws.on('open', () => {
            console.log(`[Binance WS] Connected for ${symbol}`);
        });
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                // Handle order book data
                if (msg.bids || msg.asks) {
                    const orderBookData = {
                        bids: (msg.bids || []).map((b) => ({
                            price: b[0],
                            size: b[1],
                            count: '1',
                        })),
                        asks: (msg.asks || []).map((a) => ({
                            price: a[0],
                            size: a[1],
                            count: '1',
                        })),
                        timestamp: msg.E || String(Date.now()),
                    };
                    const conn = this.connections.get(symbol);
                    if (conn) {
                        conn.subscribers.forEach((cb) => {
                            try {
                                cb(orderBookData);
                            }
                            catch (e) {
                                console.error(`[Binance WS] Subscriber error for ${symbol}:`, e);
                            }
                        });
                    }
                }
            }
            catch (e) {
                console.error(`[Binance WS] Failed to parse message for ${symbol}:`, e);
            }
        });
        ws.on('close', (code, reason) => {
            console.log(`[Binance WS] Disconnected from ${symbol}: ${code} ${reason}`);
            const conn = this.connections.get(symbol);
            if (conn && conn.subscribers.size > 0) {
                const timer = setTimeout(() => {
                    this.connect(symbol);
                }, 3000);
                this.reconnectTimers.set(symbol, timer);
            }
        });
        ws.on('error', (err) => {
            console.error(`[Binance WS] Error for ${symbol}:`, err.message);
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
        console.log(`[Binance WS] Disconnected ${symbol} - no more subscribers`);
    }
}
exports.binanceWsManager = new BinanceWebSocketManager();
//# sourceMappingURL=binance.js.map