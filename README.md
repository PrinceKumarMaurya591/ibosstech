# Market Data Service

A real-time market data service that fetches live data from **OKX** and streams it to a browser-based client UI. Built with a Node.js/TypeScript backend and React/Vite frontend.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│   Browser   │────▶│  Backend Service  │────▶│       OKX Exchange       │
│   (React)   │     │  (Node.js/WS)     │     │  (REST + WebSocket)      │
│             │◀────│                   │◀────│                          │
│  Login      │     │  REST: /api/*     │     │  /api/v5/market/tickers  │
│  Market     │     │  WS:  order book  │     │  ws://ws.okx.com:8443    │
│  Order Book │     │  Session Manager  │     │                          │
└─────────────┘     └──────────────────┘     └──────────────────────────┘
```

### Key Design Decisions

- **Backend as Proxy**: The client never calls OKX directly. All market data flows through the backend service, which acts as a proxy/aggregator.
- **Two Separate Servers**: REST API on port `3001`, WebSocket server on port `3002`. Clean separation of concerns.
- **Single-Session Enforcement**: Each username can only have one active session at a time. See [Session Management](#session-management) for details.
- **Shared OKX Connections**: Multiple clients watching the same symbol share a single WebSocket connection to OKX, reducing resource usage.
- **Auto-Reconnect**: Both the backend's OKX WebSocket client and the frontend's WebSocket client automatically reconnect on disconnection.

## Project Structure

```
├── server/                     # Backend service
│   ├── src/
│   │   ├── index.ts            # Main: Express REST API + WebSocket server
│   │   ├── auth.ts             # Hardcoded user store authentication
│   │   ├── sessionManager.ts   # Single-session-per-client enforcement
│   │   ├── okx.ts              # OKX REST client + WebSocket manager
│   │   └── binance.ts          # Binance REST client + WebSocket manager
│   ├── package.json
│   └── tsconfig.json
├── client/                     # Frontend application (Vite + React)
│   ├── src/
│   │   ├── App.tsx             # Main app with view routing
│   │   ├── App.css             # All component styles
│   │   ├── index.css           # Global styles
│   │   ├── api.ts              # REST client + WebSocket client
│   │   ├── Login.tsx           # Login view
│   │   ├── MarketOverview.tsx  # Top 20 pairs table
│   │   └── OrderBook.tsx       # Live order book stream
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## How to Run Locally

### Prerequisites

- **Node.js** v18+ and **npm**

### 1. Start the Backend

```bash
cd server
npm install
npm run build
npm start
```

The server starts on:
- REST API: **http://localhost:3001**
- WebSocket: **ws://localhost:3002**

For development with auto-reload:

```bash
npm run dev
```

#### Data Source Selection

By default, the service uses **OKX**. If OKX is unreachable from your network (e.g., due to geographic restrictions), you can switch to **Binance**:

```bash
DATA_SOURCE=binance npm start
# or for development:
DATA_SOURCE=binance npm run dev
```

This is controlled by the `DATA_SOURCE` environment variable (`okx` or `binance`). The adapter pattern in [`server/src/index.ts`](server/src/index.ts:33) makes it easy to add additional exchanges.

### 2. Start the Frontend

In a separate terminal:

```bash
cd client
npm install
npm run dev
```

The dev server runs on **http://localhost:5173** (or the next available port).

### 3. Open the Application

Navigate to **http://localhost:5173** in your browser.

### Demo Credentials

| Username | Password   |
|----------|------------|
| `admin`  | `admin123` |
| `trader` | `trader123`|
| `demo`   | `demo123`  |

## API Endpoints

### REST Endpoints

| Method | Path                  | Description                        |
|--------|-----------------------|------------------------------------|
| POST   | `/api/login`          | Authenticate and create a session  |
| POST   | `/api/logout`         | End a session                      |
| GET    | `/api/market/top20`   | Get top 20 spot pairs by volume    |
| GET    | `/api/market/ticker`  | Get ticker for a specific symbol   |
| GET    | `/api/health`         | Health check                       |

### WebSocket Protocol

Connect to `ws://localhost:3002`. Messages are JSON.

**Authentication:**
```json
{ "type": "auth", "sessionId": "your-session-id" }
```

**Subscribe to order book:**
```json
{ "type": "subscribe", "symbol": "BTC-USDT" }
```

**Server sends order book updates:**
```json
{
  "type": "orderbook",
  "symbol": "BTC-USDT",
  "data": {
    "bids": [["45000.0", "1.5", "3"], ...],
    "asks": [["45010.0", "2.0", "5"], ...],
    "timestamp": "1700000000000"
  }
}
```

## Session Management

The [`sessionManager.ts`](server/src/sessionManager.ts) enforces a **single-session-per-client** rule:

1. When a user logs in, a unique session ID is generated and stored in an in-memory `Map<sessionId, Session>`.
2. A secondary `Map<username, sessionId>` tracks which session belongs to which user.
3. If a user logs in again (from a different browser tab, window, or machine), the `createSession()` method:
   - Looks up any existing session for that username.
   - If found, closes the associated WebSocket connection with a `"New session started elsewhere"` reason.
   - Deletes the old session from both maps.
   - Creates and returns a new session ID.
4. All REST endpoints validate the `sessionId` query parameter against the session manager before returning data.
5. WebSocket connections must send an `auth` message with their `sessionId` before they can subscribe to order book data.
6. Stale sessions older than 24 hours are periodically cleaned up.

This approach ensures that each user can only have one active connection at any time — any attempt to start a new session transparently terminates the previous one.

## Assumptions & Limitations

### Assumptions

1. **OKX public endpoints** require no API key, which is correct as of June 2026.
2. The top 20 pairs by volume are returned by OKX's `/api/v5/market/tickers` endpoint, which already sorts by 24h volume descending.
3. Users are expected to close their browser tabs when done; sessions persist until explicit logout or cleanup.
4. The system is designed for local/demo use — no HTTPS, no password hashing, no database.

### Known Limitations

1. **No persistent storage**: Sessions and user data are held in memory. Restarting the server clears all sessions.
2. **Hardcoded users**: The user store is a static array in [`auth.ts`](server/src/auth.ts). Not suitable for production.
3. **Order book is initial snapshot only**: The OKX "books" channel provides snapshot + incremental updates, but this implementation processes each message as a full snapshot. A production system would maintain a local order book and apply incremental updates.
4. **No TLS/SSL**: WebSocket and HTTP connections are unencrypted. For production, add TLS.
5. **Single-server architecture**: Both REST and WebSocket servers run on the same Node.js process. For scale, these should be separated.
6. **No rate limiting**: There's no protection against abusive clients hammering the API.
7. **Order book depth**: Display is limited to top 15 levels on each side. The OKX feed can provide up to 400 levels.
8. **Market data caching**: The top 20 list is cached for 10 seconds to reduce load on OKX.
