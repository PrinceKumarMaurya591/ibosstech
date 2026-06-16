import WebSocket from 'ws';
import https from 'https';

// ============================================================
// OKX REST API client
// ============================================================

const OKX_REST_BASE = 'https://www.okx.com';
const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';

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
 * Make a REST API call to OKX.
 */
function okxRequest(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${OKX_REST_BASE}${path}`;
    https
      .get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
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
export async function fetchTop20Pairs(): Promise<TickerData[]> {
  const response = await okxRequest('/api/v5/market/tickers?instType=SPOT');
  
  if (!response || response.code !== '0' || !response.data) {
    throw new Error(`OKX API error: ${JSON.stringify(response)}`);
  }

  // OKX returns tickers sorted by 24h volume descending by default
  const top20 = response.data.slice(0, 20).map((t: any) => ({
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
export async function fetchTicker(symbol: string): Promise<TickerData | null> {
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

// ============================================================
// OKX WebSocket client for order book streaming
// ============================================================

export interface OkxWsMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: any[];
  action?: string;
}

export type OrderBookCallback = (data: OrderBookData) => void;
export type WsStatusCallback = (connected: boolean) => void;

/**
 * Manages a WebSocket connection to OKX for order book data.
 * Only one connection per symbol is maintained and shared across clients.
 */
class OkxWebSocketManager {
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

  private connect(symbol: string): void {
    const conn = this.connections.get(symbol);
    if (!conn) return;

    console.log(`[OKX WS] Connecting to order book for ${symbol}...`);

    const ws = new WebSocket(OKX_WS_URL);

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

    ws.on('message', (raw: Buffer) => {
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
          const orderBookData: OrderBookData = {
            bids: (bookData.bids || []).map((b: string[]) => ({
              price: b[0],
              size: b[1],
              count: b[3] || '0',
            })),
            asks: (bookData.asks || []).map((a: string[]) => ({
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
              } catch (e) {
                console.error(`[OKX WS] Subscriber error for ${symbol}:`, e);
              }
            });
          }
        }
      } catch (e) {
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
    console.log(`[OKX WS] Disconnected ${symbol} - no more subscribers`);
  }
}

export const okxWsManager = new OkxWebSocketManager();
