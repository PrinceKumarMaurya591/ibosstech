package com.marketdata.service;

import com.marketdata.model.OrderBookData;
import com.marketdata.model.OrderBookLevel;
import com.marketdata.model.TickerData;
import jakarta.websocket.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Service for interacting with Binance REST and WebSocket APIs.
 * Provides fallback data when OKX is unreachable.
 */
@Service
public class BinanceService implements DataSource, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(BinanceService.class);

    private static final String BINANCE_REST_BASE = "https://api.binance.com";
    private static final String BINANCE_WS_URL = "wss://stream.binance.com:9443/ws";

    private static final List<String> QUOTE_ASSETS = List.of("USDT", "USDC", "BUSD", "DAI", "TUSD", "FDUSD");

    private final org.springframework.web.client.RestTemplate restTemplate;
    private final Map<String, BinanceConnection> connections = new ConcurrentHashMap<>();

    public BinanceService() {
        this.restTemplate = new org.springframework.web.client.RestTemplate();
    }

    @Override
    public String getName() {
        return "binance";
    }

    /**
     * Convert Binance symbol format (BTCUSDT) to standard format (BTC-USDT).
     */
    String toStandardSymbol(String binanceSymbol) {
        for (String quote : QUOTE_ASSETS) {
            if (binanceSymbol.endsWith(quote) && binanceSymbol.length() > quote.length()) {
                return binanceSymbol.substring(0, binanceSymbol.length() - quote.length()) + "-" + quote;
            }
        }
        return binanceSymbol;
    }

    /**
     * Convert standard symbol (BTC-USDT) to Binance format (BTCUSDT).
     */
    String toBinanceSymbol(String standard) {
        return standard.replace("-", "");
    }

    @SuppressWarnings("unchecked")
    @Override
    public List<TickerData> fetchTop20Pairs() {
        String url = BINANCE_REST_BASE + "/api/v3/ticker/24hr";

        try {
            List<Map<String, Object>> response = restTemplate.getForObject(url, List.class);

            if (response == null || response.isEmpty()) {
                log.warn("No tickers returned from Binance");
                return Collections.emptyList();
            }

            // Filter for USDT pairs and sort by volume descending
            List<Map<String, Object>> usdtPairs = response.stream()
                    .filter(t -> {
                        String symbol = (String) t.get("symbol");
                        return symbol != null && symbol.endsWith("USDT");
                    })
                    .sorted((a, b) -> {
                        double volB = Double.parseDouble(safeString(b.get("quoteVolume"), "0"));
                        double volA = Double.parseDouble(safeString(a.get("quoteVolume"), "0"));
                        return Double.compare(volB, volA);
                    })
                    .limit(20)
                    .collect(Collectors.toList());

            return usdtPairs.stream().map(t -> new TickerData(
                    toStandardSymbol((String) t.get("symbol")),
                    safeString(t.get("lastPrice"), "0"),
                    safeString(t.get("priceChange"), "0"),
                    safeString(t.get("priceChangePercent"), "0"),
                    safeString(t.getOrDefault("quoteVolume", t.get("volume")), "0"),
                    safeString(t.get("highPrice"), "0"),
                    safeString(t.get("lowPrice"), "0")
            )).collect(Collectors.toList());

        } catch (Exception e) {
            log.error("Failed to fetch top 20 pairs from Binance: {}", e.getMessage());
            throw new RuntimeException("Failed to fetch market data from Binance: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    @Override
    public TickerData fetchTicker(String symbol) {
        String binanceSymbol = toBinanceSymbol(symbol);
        String url = BINANCE_REST_BASE + "/api/v3/ticker/24hr?symbol=" + binanceSymbol;

        try {
            Map<String, Object> response = restTemplate.getForObject(url, Map.class);

            if (response == null || response.containsKey("code")) {
                return null;
            }

            return new TickerData(
                    toStandardSymbol((String) response.get("symbol")),
                    safeString(response.get("lastPrice"), "0"),
                    safeString(response.get("priceChange"), "0"),
                    safeString(response.get("priceChangePercent"), "0"),
                    safeString(response.getOrDefault("quoteVolume", response.get("volume")), "0"),
                    safeString(response.get("highPrice"), "0"),
                    safeString(response.get("lowPrice"), "0")
            );
        } catch (Exception e) {
            log.error("Failed to fetch ticker for {} from Binance: {}", symbol, e.getMessage());
            return null;
        }
    }

    @Override
    public Runnable subscribeOrderBook(String symbol, Consumer<OrderBookData> callback) {
        BinanceConnection conn = connections.computeIfAbsent(symbol, k -> {
            BinanceConnection newConn = new BinanceConnection(symbol);
            newConn.connect();
            return newConn;
        });

        conn.addSubscriber(callback);

        return () -> {
            BinanceConnection existing = connections.get(symbol);
            if (existing != null) {
                existing.removeSubscriber(callback);
                if (existing.getSubscriberCount() == 0) {
                    connections.remove(symbol);
                    existing.disconnect();
                }
            }
        };
    }

    @Override
    public void destroy() {
        new ArrayList<>(connections.keySet()).forEach(symbol -> {
            BinanceConnection conn = connections.remove(symbol);
            if (conn != null) conn.disconnect();
        });
    }

    // ============================================================
    // Binance WebSocket connection management
    // ============================================================

    private class BinanceConnection {
        private final String symbol;
        private final Set<Consumer<OrderBookData>> subscribers = ConcurrentHashMap.newKeySet();
        private Session session;
        private Timer reconnectTimer;
        private volatile boolean intentionalClose = false;

        BinanceConnection(String symbol) {
            this.symbol = symbol;
        }

        void addSubscriber(Consumer<OrderBookData> cb) { subscribers.add(cb); }
        void removeSubscriber(Consumer<OrderBookData> cb) { subscribers.remove(cb); }
        int getSubscriberCount() { return subscribers.size(); }

        synchronized void connect() {
            intentionalClose = false;
            try {
                String binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
                String streamName = binanceSymbol + "@depth20@100ms";
                String wsUrl = BINANCE_WS_URL + "/" + streamName;

                WebSocketContainer container = ContainerProvider.getWebSocketContainer();
                session = container.connectToServer(new BinanceWebSocketEndpoint(this), new URI(wsUrl));
                log.info("[Binance WS] Connected for {}", symbol);
            } catch (Exception e) {
                log.error("[Binance WS] Failed to connect for {}: {}", symbol, e.getMessage());
                scheduleReconnect();
            }
        }

        synchronized void disconnect() {
            intentionalClose = true;
            cancelReconnect();
            if (session != null && session.isOpen()) {
                try {
                    session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, "No more subscribers"));
                } catch (IOException e) {
                    log.warn("[Binance WS] Error closing session for {}: {}", symbol, e.getMessage());
                }
            }
            session = null;
        }

        void onMessage(String message) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> msg = new com.fasterxml.jackson.databind.ObjectMapper()
                        .readValue(message, Map.class);

                if (msg.containsKey("bids") || msg.containsKey("asks")) {
                    @SuppressWarnings("unchecked")
                    List<List<Object>> rawBids = (List<List<Object>>) msg.get("bids");
                    @SuppressWarnings("unchecked")
                    List<List<Object>> rawAsks = (List<List<Object>>) msg.get("asks");

                    List<OrderBookLevel> bids = new ArrayList<>();
                    List<OrderBookLevel> asks = new ArrayList<>();

                    if (rawBids != null) {
                        for (List<Object> b : rawBids) {
                            bids.add(new OrderBookLevel(safeGet(b, 0), safeGet(b, 1), "1"));
                        }
                    }
                    if (rawAsks != null) {
                        for (List<Object> a : rawAsks) {
                            asks.add(new OrderBookLevel(safeGet(a, 0), safeGet(a, 1), "1"));
                        }
                    }

                    String ts = msg.get("E") != null ? msg.get("E").toString() : String.valueOf(System.currentTimeMillis());
                    OrderBookData orderBook = new OrderBookData(bids, asks, ts);

                    for (Consumer<OrderBookData> subscriber : subscribers) {
                        try { subscriber.accept(orderBook); }
                        catch (Exception e) { log.error("[Binance WS] Subscriber error: {}", e.getMessage()); }
                    }
                }
            } catch (Exception e) {
                log.error("[Binance WS] Failed to parse message: {}", e.getMessage());
            }
        }

        void onClose(CloseReason reason) {
            log.info("[Binance WS] Disconnected from {}: {} {}", symbol, reason.getCloseCode(), reason.getReasonPhrase());
            if (!intentionalClose && !subscribers.isEmpty()) {
                scheduleReconnect();
            }
        }

        void onError(Throwable error) {
            log.error("[Binance WS] Error for {}: {}", symbol, error.getMessage());
        }

        private synchronized void scheduleReconnect() {
            cancelReconnect();
            reconnectTimer = new Timer("binance-reconnect-" + symbol);
            reconnectTimer.schedule(new TimerTask() {
                @Override
                public void run() {
                    log.info("[Binance WS] Reconnecting for {}...", symbol);
                    connect();
                }
            }, 3000);
        }

        private void cancelReconnect() {
            if (reconnectTimer != null) {
                reconnectTimer.cancel();
                reconnectTimer = null;
            }
        }
    }

    @ClientEndpoint
    private static class BinanceWebSocketEndpoint {
        private final BinanceConnection connection;
        BinanceWebSocketEndpoint(BinanceConnection connection) { this.connection = connection; }
        @OnMessage public void onMessage(String message) { connection.onMessage(message); }
        @OnClose public void onClose(CloseReason reason) { connection.onClose(reason); }
        @OnError public void onError(Throwable error) { connection.onError(error); }
    }

    private String safeGet(List<Object> list, int index) {
        if (index < list.size() && list.get(index) != null) return list.get(index).toString();
        return "0";
    }

    private String safeString(Object value, String defaultValue) {
        return value != null ? value.toString() : defaultValue;
    }
}
