import { useState, useCallback } from 'react';
import { isAuthenticated, getUsername, logout } from './api';
import Login from './Login';
import MarketOverview from './MarketOverview';
import OrderBook from './OrderBook';
import './App.css';

type View = 'market' | 'orderbook';

function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [currentView, setCurrentView] = useState<View>('market');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');

  const handleLoginSuccess = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuthenticated(false);
    setCurrentView('market');
  }, []);

  const handleSelectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setCurrentView('orderbook');
  }, []);

  const handleBackToMarket = useCallback(() => {
    setCurrentView('market');
  }, []);

  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Market <span>Data</span> Service
        </h1>
        <div className="user-info">
          <span className="username">{getUsername()}</span>
          <button className="btn-logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={currentView === 'market' ? 'active' : ''}
          onClick={() => setCurrentView('market')}
        >
          Market Overview
        </button>
        <button
          className={currentView === 'orderbook' ? 'active' : ''}
          disabled={!selectedSymbol}
          onClick={() => setCurrentView('orderbook')}
        >
          Order Book {selectedSymbol ? `(${selectedSymbol})` : ''}
        </button>
      </nav>

      <main className="app-content">
        {currentView === 'market' && (
          <MarketOverview onSelectSymbol={handleSelectSymbol} />
        )}
        {currentView === 'orderbook' && selectedSymbol && (
          <OrderBook symbol={selectedSymbol} onBack={handleBackToMarket} />
        )}
      </main>
    </div>
  );
}

export default App;
