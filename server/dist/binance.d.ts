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
 * Fetch the top 20 spot trading pairs by 24h volume from Binance.
 * Binance's /api/v3/ticker/24hr returns all tickers.
 * We filter for USDT pairs and take the top 20 by volume.
 */
export declare function fetchTop20Pairs(): Promise<TickerData[]>;
/**
 * Fetch ticker for a single symbol.
 */
export declare function fetchTicker(symbol: string): Promise<TickerData | null>;
export type OrderBookCallback = (data: OrderBookData) => void;
/**
 * Manages a WebSocket connection to Binance for order book data.
 */
declare class BinanceWebSocketManager {
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
export declare const binanceWsManager: BinanceWebSocketManager;
export {};
//# sourceMappingURL=binance.d.ts.map