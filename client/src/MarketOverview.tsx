import { useState, useEffect, useCallback } from 'react';
import type { TickerData } from './api';
import { fetchTop20 } from './api';

interface MarketOverviewProps {
  onSelectSymbol: (symbol: string) => void;
}

export default function MarketOverview({ onSelectSymbol }: MarketOverviewProps) {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await fetchTop20();
      setTickers(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch data on mount and auto-refresh every 10 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatVolume = (vol: string): string => {
    const num = parseFloat(vol);
    if (isNaN(num)) return vol;
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  const formatPrice = (price: string): string => {
    const num = parseFloat(price);
    if (isNaN(num)) return price;
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading market data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-view">
        <p>Error: {error}</p>
        <button className="btn-primary" onClick={fetchData} style={{ marginTop: 16, width: 'auto' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="market-overview">
      <h2>Market Overview</h2>
      <p className="subtitle">
        Top 20 spot pairs by 24h volume
        {lastUpdated && (
          <span style={{ marginLeft: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            Last updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </p>

      <div className="market-table-wrapper">
        <table className="market-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th style={{ textAlign: 'right' }}>Last Price</th>
              <th style={{ textAlign: 'right' }}>24h Change</th>
              <th style={{ textAlign: 'right' }}>24h %</th>
              <th style={{ textAlign: 'right' }}>24h Volume</th>
              <th style={{ textAlign: 'right' }}>Order Book</th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((ticker, index) => {
              const changePercent = parseFloat(ticker.change24hPercent);
              const isPositive = changePercent >= 0;

              return (
                <tr key={ticker.symbol}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{index + 1}</td>
                  <td className="symbol-cell">{ticker.symbol}</td>
                  <td style={{ textAlign: 'right' }}>{formatPrice(ticker.lastPrice)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: isPositive ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {isPositive ? '+' : ''}{formatPrice(ticker.change24h)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: isPositive ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                  </td>
                  <td className="volume-cell" style={{ textAlign: 'right' }}>
                    {formatVolume(ticker.volume24h)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="order-book-link"
                      onClick={() => onSelectSymbol(ticker.symbol)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        fontFamily: 'var(--sans)',
                        fontSize: 12,
                        padding: '4px 8px',
                        borderRadius: 4,
                      }}
                    >
                      View Book →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
