// ============================================================
// API client for Market Data Service
// ============================================================

const API_BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws/market';

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

// ============================================================
// Session management
// ============================================================

let _sessionId: string | null = localStorage.getItem('sessionId');
let _username: string | null = localStorage.getItem('username');

export function getSessionId(): string | null {
  return _sessionId;
}

export function getUsername(): string | null {
  return _username;
}

export function isAuthenticated(): boolean {
  return _sessionId !== null;
}

function setSession(sessionId: string, username: string): void {
  _sessionId = sessionId;
  _username = username;
  localStorage.setItem('sessionId', sessionId);
  localStorage.setItem('username', username);
}

function clearSession(): void {
  _sessionId = null;
  _username = null;
  localStorage.removeItem('sessionId');
  localStorage.removeItem('username');
}

// ============================================================
// REST API calls
// ============================================================

export async function login(
  username: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success && data.sessionId) {
      setSession(data.sessionId, data.username);
    }

    return { success: data.success, message: data.message };
  } catch (err: any) {
    return { success: false, message: `Connection error: ${err.message}` };
  }
}

export async function logout(): Promise<void> {
  const sessionId = _sessionId;
  clearSession();

  if (sessionId) {
    try {
      await fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // Ignore errors on logout
    }
  }
}

export async function fetchTop20(): Promise<TickerData[]> {
  const sessionId = _sessionId;
  if (!sessionId) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(`${API_BASE}/api/market/top20?sessionId=${sessionId}`);
  const data = await res.json();

  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch market data');
  }

  return data.data;
}

// ============================================================
// WebSocket connection for order book
// ============================================================

type MessageHandler = (data: any) => void;

class OrderBookWebSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedSymbol: string | null = null;
  private intentionalClose: boolean = false;

  /**
   * Connect to the WebSocket server and authenticate.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.intentionalClose = false;
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        // Authenticate with session ID
        const sessionId = getSessionId();
        if (sessionId) {
          this.send({ type: 'auth', sessionId });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle auth response
          if (msg.type === 'auth_ok') {
            resolve();
            return;
          }

          if (msg.type === 'error') {
            // Don't reject on errors after auth
            if (msg.code === 'AUTH_REQUIRED' || msg.code === 'AUTH_FAILED') {
              reject(new Error(msg.message));
              return;
            }
          }

          // Dispatch message to handlers
          const handlers = this.messageHandlers.get(msg.type);
          if (handlers) {
            handlers.forEach((handler) => handler(msg));
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        if (!this.intentionalClose) {
          // Auto-reconnect
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {});
            // Re-subscribe if was subscribed (without handler since we lost it)
            if (this.subscribedSymbol) {
              setTimeout(() => {
                this.send({ type: 'subscribe', symbol: this.subscribedSymbol });
              }, 500);
            }
          }, 3000);
        }
      };
    });
  }

  /**
   * Send a message to the server.
   */
  send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Subscribe to order book updates for a symbol.
   * Returns an unsubscribe function.
   */
  subscribeOrderBook(
    symbol: string,
    onData: (data: any) => void
  ): () => void {
    this.subscribedSymbol = symbol;

    // Register handler
    if (!this.messageHandlers.has('orderbook')) {
      this.messageHandlers.set('orderbook', new Set());
    }
    this.messageHandlers.get('orderbook')!.add(onData);

    // Send subscribe message
    this.send({ type: 'subscribe', symbol });

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get('orderbook');
      if (handlers) {
        handlers.delete(onData);
        if (handlers.size === 0) {
          this.messageHandlers.delete('orderbook');
          this.send({ type: 'unsubscribe' });
          this.subscribedSymbol = null;
        }
      }
    };
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
    this.subscribedSymbol = null;
  }
}

export const orderBookWs = new OrderBookWebSocket();
