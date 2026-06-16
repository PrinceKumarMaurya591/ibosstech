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
 * Fetch the top 20 spot trading pairs by 24h volume from OKX.
 * OKX's /api/v5/market/tickers returns all tickers sorted by volume (descending).
 * We filter for SPOT pairs only and take the top 20.
 */
export declare function fetchTop20Pairs(): Promise<TickerData[]>;
/**
 * Fetch ticker for a single symbol.
 */
export declare function fetchTicker(symbol: string): Promise<TickerData | null>;
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
declare class OkxWebSocketManager {
    private connections;
    private reconnectTimers;
    /**
     * Subscribe to order book updates for a symbol.
     * Returns an unsubscribe function.
     */
    subscribeOrderBook(symbol: string, callback: OrderBookCallback): () => void;
    private connect;
    private disconnect;
}
export declare const okxWsManager: OkxWebSocketManager;
export {};
//# sourceMappingURL=okx.d.ts.map