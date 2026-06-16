import WebSocket from 'ws';
import https from 'https';

// ============================================================
// Binance REST API client
// ============================================================

const BINANCE_REST_BASE = 'https://api.binance.com';
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

export interface TickerData {
  symbol: string;
  lastPrice: string;
  change24h: string;
  change24hPercent: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
  count: string;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

/**
 * Make a REST API call to Binance.
 */
function binanceRequest(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${BINANCE_REST_BASE}${path}`;
    https
      .get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
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
function toStandardSymbol(binanceSymbol: string): string {
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
function toBinanceSymbol(standard: string): string {
  return standard.replace('-', '');
}

/**
 * Fetch the top 20 spot trading pairs by 24h volume from Binance.
 * Binance's /api/v3/ticker/24hr returns all tickers.
 * We filter for USDT pairs and take the top 20 by volume.
 */
export async function fetchTop20Pairs(): Promise<TickerData[]> {
  const response = await binanceRequest('/api/v3/ticker/24hr');

  if (!Array.isArray(response)) {
    throw new Error(`Binance API error: ${JSON.stringify(response).substring(0, 200)}`);
  }

  // Filter for USDT pairs and sort by volume descending
  const usdtPairs = response
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'));

  const top20 = usdtPairs.slice(0, 20).map((t: any) => ({
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
export async function fetchTicker(symbol: string): Promise<TickerData | null> {
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

// ============================================================
// Binance WebSocket client for order book streaming
// ============================================================

export type OrderBookCallback = (data: OrderBookData) => void;

/**
 * Manages a WebSocket connection to Binance for order book data.
 */
class BinanceWebSocketManager {
  private connections: Map<string, { ws: WebSocket; subscribers: Set<OrderBookCallback> }> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Subscribe to order book updates for a symbol.
   * Returns an unsubscribe function.
   */
  subscribeOrderBook(symbol: string, callback: OrderBookCallback): () => void {
    let connection = this.connections.get(symbol);

    if (!connection) {
      connection = { ws: null as any, subscribers: new Set() };
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

  private connect(symbol: string): void {
    const conn = this.connections.get(symbol);
    if (!conn) return;

    const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
    const streamName = `${binanceSymbol}@depth20@100ms`;
    const wsUrl = `${BINANCE_WS_URL}/${streamName}`;

    console.log(`[Binance WS] Connecting to order book for ${symbol}...`);

    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`[Binance WS] Connected for ${symbol}`);
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Handle order book data
        if (msg.bids || msg.asks) {
          const orderBookData: OrderBookData = {
            bids: (msg.bids || []).map((b: string[]) => ({
              price: b[0],
              size: b[1],
              count: '1',
            })),
            asks: (msg.asks || []).map((a: string[]) => ({
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
              } catch (e) {
                console.error(`[Binance WS] Subscriber error for ${symbol}:`, e);
              }
            });
          }
        }
      } catch (e) {
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

  private disconnect(symbol: string): void {
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

export const binanceWsManager = new BinanceWebSocketManager();
