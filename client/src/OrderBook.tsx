import { useState, useEffect, useCallback, useRef } from 'react';
import { orderBookWs } from './api';
import type { OrderBookData } from './api';

interface OrderBookProps {
  symbol: string;
  onBack: () => void;
}

export default function OrderBook({ symbol, onBack }: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const wsConnectedRef = useRef(false);

  const connect = useCallback(async () => {
    if (wsConnectedRef.current) return;

    setStatus('connecting');
    try {
      await orderBookWs.connect();
      wsConnectedRef.current = true;
      setStatus('connected');

      // Subscribe to order book
      orderBookWs.subscribeOrderBook(symbol, (data: any) => {
        if (data.type === 'orderbook' && data.symbol === symbol) {
          setOrderBook(data.data);
        }
      });
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to connect');
    }
  }, [symbol]);

  useEffect(() => {
    connect();

    return () => {
      wsConnectedRef.current = false;
      orderBookWs.disconnect();
    };
  }, [connect]);

  const calculateSpread = (): string => {
    if (!orderBook || !orderBook.asks.length || !orderBook.bids.length) {
      return '—';
    }
    const bestAsk = parseFloat(orderBook.asks[orderBook.asks.length - 1]?.price || '0');
    const bestBid = parseFloat(orderBook.bids[0]?.price || '0');
    if (bestAsk === 0 || bestBid === 0) return '—';
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestBid) * 100;
    return `${spread.toFixed(2)} (${spreadPercent.toFixed(3)}%)`;
  };

  const formatPrice = (price: string): string => {
    const num = parseFloat(price);
    if (isNaN(num)) return price;
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatSize = (size: string): string => {
    const num = parseFloat(size);
    if (isNaN(num)) return size;
    if (num >= 1000) return num.toFixed(0);
    if (num >= 1) return num.toFixed(2);
    return num.toFixed(4);
  };

  // Get top 15 bids (sorted descending by price) and top 15 asks (sorted ascending by price)
  const bids = orderBook?.bids?.slice(0, 15).reverse() || []; // highest bid first at bottom
  const asks = orderBook?.asks?.slice(0, 15) || []; // lowest ask first at top

  return (
    <div className="orderbook-view">
      <div className="orderbook-header">
        <div>
          <h2>Order Book</h2>
          <p className="subtitle">Live streaming order book data</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="symbol-badge">{symbol}</span>
          <button className="btn-back" onClick={onBack}>
            ← Back to Overview
          </button>
        </div>
      </div>

      {status === 'connecting' && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Connecting to order book stream...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="error-view">
          <p>Connection error: {errorMsg}</p>
          <button className="btn-primary" onClick={connect} style={{ marginTop: 16, width: 'auto' }}>
            Reconnect
          </button>
        </div>
      )}

      {status === 'connected' && (
        <>
          <div className="orderbook-grid">
            {/* Asks column */}
            <div className="orderbook-column">
              <div className="orderbook-column-header">
                <span>Price</span>
                <span className="right">Size</span>
                <span className="right">Count</span>
              </div>
              {asks.map((ask, i) => (
                <div key={`ask-${i}`} className="orderbook-row">
                  <span className="price-ask">{formatPrice(ask.price)}</span>
                  <span className="size right">{formatSize(ask.size)}</span>
                  <span className="count right">{ask.count}</span>
                </div>
              ))}
              {asks.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  No asks
                </div>
              )}
            </div>

            {/* Divider with spread */}
            <div className="orderbook-divider">
              <span className="orderbook-spread-label">Spread</span>
              <span className="spread">{calculateSpread()}</span>
            </div>

            {/* Bids column */}
            <div className="orderbook-column">
              <div className="orderbook-column-header">
                <span>Price</span>
                <span className="right">Size</span>
                <span className="right">Count</span>
              </div>
              {bids.map((bid, i) => (
                <div key={`bid-${i}`} className="orderbook-row">
                  <span className="price-bid">{formatPrice(bid.price)}</span>
                  <span className="size right">{formatSize(bid.size)}</span>
                  <span className="count right">{bid.count}</span>
                </div>
              ))}
              {bids.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  No bids
                </div>
              )}
            </div>
          </div>

          <div className={`orderbook-status ${status}`}>
            ● Live — connected to {symbol} order book
            {orderBook?.timestamp && (
              <span style={{ marginLeft: 12 }}>
                | Updated: {new Date(parseInt(orderBook.timestamp)).toLocaleTimeString()}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
