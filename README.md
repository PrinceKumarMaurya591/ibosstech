# Market Data Service

A real-time market data service that fetches live data from **OKX** and streams it to a browser-based client UI. Built with a **Spring Boot (Java 21)** backend and **React/Vite** frontend.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│   Browser   │────▶│  Backend Service  │────▶│       OKX Exchange       │
│   (React)   │     │  (Spring Boot)    │     │  (REST + WebSocket)      │
│             │◀────│                   │◀────│                          │
│  Login      │     │  REST: /api/*     │     │  /api/v5/market/tickers  │
│  Market     │     │  WS:  /ws/market  │     │  wss://ws.okx.com:8443   │
│  Order Book │     │  Session Manager  │     │                          │
└─────────────┘     └──────────────────┘     └──────────────────────────┘
```

### Key Design Decisions

- **Backend as Proxy**: The client never calls OKX directly. All market data flows through the backend service, which acts as a proxy/aggregator.
- **Single-Port Architecture**: Both REST API and WebSocket server run on the same port (`3001`), unlike the original Node.js version which used separate ports. This simplifies deployment.
- **Single-Session Enforcement**: Each username can only have one active session at a time. See [Session Management](#session-management) for details.
- **Shared OKX Connections**: Multiple clients watching the same symbol share a single WebSocket connection to OKX, reducing resource usage.
- **Auto-Reconnect**: Both the backend's OKX WebSocket client and the frontend's WebSocket client automatically reconnect on disconnection.

## Project Structure

```
├── server-java/                 # Backend service (Spring Boot)
│   ├── src/main/java/com/marketdata/
│   │   ├── MarketDataApplication.java    # Main entry point
│   │   ├── config/
│   │   │   ├── CorsConfig.java           # CORS configuration
│   │   │   └── WebSocketConfig.java      # WebSocket endpoint registration
│   │   ├── controller/
│   │   │   ├── AuthController.java       # POST /api/login, /api/logout
│   │   │   ├── MarketController.java     # GET /api/market/top20, /ticker
│   │   │   └── HealthController.java     # GET /api/health
│   │   ├── model/
│   │   │   ├── TickerData.java           # Ticker data DTO
│   │   │   ├── OrderBookData.java        # Order book snapshot DTO
│   │   │   ├── OrderBookLevel.java       # Single bid/ask level
│   │   │   ├── LoginRequest.java         # Login request DTO
│   │   │   ├── LoginResponse.java        # Login response DTO
│   │   │   └── ApiResponse.java          # Generic API response wrapper
│   │   ├── service/
│   │   │   ├── AuthService.java          # Hardcoded user store auth
│   │   │   ├── SessionManager.java       # Single-session-per-client
│   │   │   ├── OkxService.java           # OKX REST API client
│   │   │   └── OrderBookService.java     # OKX WebSocket client
│   │   └── websocket/
│   │       └── MarketWebSocketHandler.java   # Client WS handler
│   ├── src/main/resources/
│   │   └── application.yml               # Spring Boot configuration
│   ├── pom.xml                           # Maven build file
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

- **Java 21+** and **Maven 3.8+**
- **Node.js** v18+ and **npm** (for frontend only)

### 1. Start the Backend

```bash
cd server-java
mvn clean package -DskipTests
java -jar target/market-data-service-1.0.0.jar
```

Or run directly with Maven:

```bash
cd server-java
mvn spring-boot:run
```

The server starts on:
- REST API: **http://localhost:3001**
- WebSocket: **ws://localhost:3001/ws/market**

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

Connect to `ws://localhost:3001/ws/market`. Messages are JSON.

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
    "bids": [{"price": "45000.0", "size": "1.5", "count": "3"}, ...],
    "asks": [{"price": "45010.0", "size": "2.0", "count": "5"}, ...],
    "timestamp": "1700000000000"
  }
}
```

## Session Management

The [`SessionManager.java`](server-java/src/main/java/com/marketdata/service/SessionManager.java) enforces a **single-session-per-client** rule:

1. When a user logs in, a unique session ID (UUID) is generated and stored in an in-memory `ConcurrentHashMap<sessionId, Session>`.
2. A secondary `ConcurrentHashMap<username, sessionId>` tracks which session belongs to which user.
3. If a user logs in again (from a different browser tab, window, or machine), the `createSession()` method:
   - Looks up any existing session for that username.
   - If found, closes the associated WebSocket connection with a `"New session started elsewhere"` reason.
   - Deletes the old session from both maps.
   - Creates and returns a new session ID.
4. All REST endpoints validate the `sessionId` query parameter against the session manager before returning data.
5. WebSocket connections must send an `auth` message with their `sessionId` before they can subscribe to order book data.
6. Stale sessions older than 24 hours would be cleaned up by a scheduled task (configurable).

This approach ensures that each user can only have one active connection at any time — any attempt to start a new session transparently terminates the previous one.

The single-session enforcement is critical for resource management. Without it, a single user could open many browser tabs, each creating a session and potentially subscribing to order book streams. Since each subscription consumes a WebSocket connection to OKX (even if shared), limiting to one session per user prevents resource exhaustion and ensures fair resource allocation across users.

## Assumptions & Limitations

### Assumptions

1. **OKX public endpoints** require no API key, which is correct as of June 2026.
2. The top 20 pairs by volume are returned by OKX's `/api/v5/market/tickers` endpoint, which already sorts by 24h volume descending.
3. Users are expected to close their browser tabs when done; sessions persist until explicit logout or server restart.
4. The system is designed for local/demo use — no HTTPS, no password hashing, no database.

### Known Limitations

1. **No persistent storage**: Sessions and user data are held in memory. Restarting the server clears all sessions.
2. **Hardcoded users**: The user store is a static map in [`AuthService.java`](server-java/src/main/java/com/marketdata/service/AuthService.java). Not suitable for production.
3. **Order book is initial snapshot only**: The OKX "books" channel provides snapshot + incremental updates, but this implementation processes each message as a full snapshot. A production system would maintain a local order book and apply incremental updates.
4. **No TLS/SSL**: WebSocket and HTTP connections are unencrypted. For production, add TLS.
5. **No rate limiting**: There's no protection against abusive clients hammering the API.
6. **Order book depth**: Display is limited to top 15 levels on each side. The OKX feed can provide up to 400 levels.
7. **Market data caching**: The top 20 list is cached for 10 seconds to reduce load on OKX.
