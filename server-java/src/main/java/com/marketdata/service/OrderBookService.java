package com.marketdata.service;

import com.marketdata.model.OrderBookData;
import com.marketdata.model.OrderBookLevel;
import jakarta.websocket.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Manages WebSocket connections to OKX for order book data.
 * Only one connection per symbol is maintained and shared across clients.
 * Implements auto-reconnect on disconnection.
 */
@Service
public class OrderBookService implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(OrderBookService.class);

    private final String okxWsUrl;

    // symbol -> connection info
    private final Map<String, OkxConnection> connections = new ConcurrentHashMap<>();

    public OrderBookService(@Value("${market.data.okx-ws-url}") String okxWsUrl) {
        this.okxWsUrl = okxWsUrl;
    }

    /**
     * Subscribe to order book updates for a symbol.
     *
     * @param symbol   the trading pair (e.g., "BTC-USDT")
     * @param callback callback to receive order book data
     * @return a Runnable that unsubscribes when called
     */
    public Runnable subscribeOrderBook(String symbol, Consumer<OrderBookData> callback) {
        OkxConnection conn = connections.computeIfAbsent(symbol, k -> {
            OkxConnection newConn = new OkxConnection(symbol);
            newConn.connect();
            return newConn;
        });

        conn.addSubscriber(callback);

        return () -> {
            OkxConnection existing = connections.get(symbol);
            if (existing != null) {
                existing.removeSubscriber(callback);
                if (existing.getSubscriberCount() == 0) {
                    connections.remove(symbol);
                    existing.disconnect();
                    log.info("[OKX WS] Disconnected {} - no more subscribers", symbol);
                }
            }
        };
    }

    @Override
    public void destroy() {
        log.info("[OrderBookService] Shutting down all OKX WebSocket connections");
        new ArrayList<>(connections.keySet()).forEach(symbol -> {
            OkxConnection conn = connections.remove(symbol);
            if (conn != null) {
                conn.disconnect();
            }
        });
    }

    /**
     * Represents a single WebSocket connection to OKX for a specific symbol.
     */
    private class OkxConnection {
        private final String symbol;
        private final Set<Consumer<OrderBookData>> subscribers = ConcurrentHashMap.newKeySet();
        private Session session;
        private Timer reconnectTimer;
        private volatile boolean intentionalClose = false;

        OkxConnection(String symbol) {
            this.symbol = symbol;
        }

        void addSubscriber(Consumer<OrderBookData> callback) {
            subscribers.add(callback);
        }

        void removeSubscriber(Consumer<OrderBookData> callback) {
            subscribers.remove(callback);
        }

        int getSubscriberCount() {
            return subscribers.size();
        }

        synchronized void connect() {
            intentionalClose = false;
            try {
                WebSocketContainer container = ContainerProvider.getWebSocketContainer();
                session = container.connectToServer(new OkxWebSocketEndpoint(this),
                        new URI(okxWsUrl));
                log.info("[OKX WS] Connected for {}", symbol);
            } catch (DeploymentException | IOException | URISyntaxException e) {
                log.error("[OKX WS] Failed to connect for {}: {}", symbol, e.getMessage());
                scheduleReconnect();
            }
        }

        synchronized void disconnect() {
            intentionalClose = true;
            cancelReconnect();
            if (session != null && session.isOpen()) {
                try {
                    session.close(new CloseReason(
                            CloseReason.CloseCodes.NORMAL_CLOSURE,
                            "No more subscribers"
                    ));
                } catch (IOException e) {
                    log.warn("[OKX WS] Error closing session for {}: {}", symbol, e.getMessage());
                }
            }
            session = null;
        }

        synchronized void onOpen(Session newSession) {
            this.session = newSession;
            cancelReconnect();

            // Subscribe to order book channel
            String subscribeMsg = String.format(
                    "{\"op\":\"subscribe\",\"args\":[{\"channel\":\"books\",\"instId\":\"%s\"}]}",
                    symbol
            );
            try {
                newSession.getBasicRemote().sendText(subscribeMsg);
                log.info("[OKX WS] Sent subscribe request for {}", symbol);
            } catch (IOException e) {
                log.error("[OKX WS] Failed to send subscribe for {}: {}", symbol, e.getMessage());
            }
        }

        void onMessage(String message) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> msg = new com.fasterxml.jackson.databind.ObjectMapper()
                        .readValue(message, Map.class);

                // Handle subscription response
                if ("subscribe".equals(msg.get("event")) || "error".equals(msg.get("event"))) {
                    log.info("[OKX WS] Event for {}: {} - {}", symbol, msg.get("event"), msg.get("msg"));
                    return;
                }

                // Handle order book data
                if (msg.containsKey("arg")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> arg = (Map<String, Object>) msg.get("arg");
                    if ("books".equals(arg.get("channel")) && msg.containsKey("data")) {
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> dataList = (List<Map<String, Object>>) msg.get("data");
                        if (dataList != null && !dataList.isEmpty()) {
                            OrderBookData orderBook = parseOrderBook(dataList.get(0));
                            // Notify all subscribers
                            for (Consumer<OrderBookData> subscriber : subscribers) {
                                try {
                                    subscriber.accept(orderBook);
                                } catch (Exception e) {
                                    log.error("[OKX WS] Subscriber error for {}: {}", symbol, e.getMessage());
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                log.error("[OKX WS] Failed to parse message for {}: {}", symbol, e.getMessage());
            }
        }

        void onClose(CloseReason closeReason) {
            log.info("[OKX WS] Disconnected from {}: {} {}", symbol,
                    closeReason.getCloseCode(), closeReason.getReasonPhrase());

            if (!intentionalClose && !subscribers.isEmpty()) {
                scheduleReconnect();
            }
        }

        void onError(Throwable error) {
            log.error("[OKX WS] Error for {}: {}", symbol, error.getMessage());
        }

        private synchronized void scheduleReconnect() {
            cancelReconnect();
            reconnectTimer = new Timer("okx-reconnect-" + symbol);
            reconnectTimer.schedule(new TimerTask() {
                @Override
                public void run() {
                    log.info("[OKX WS] Reconnecting for {}...", symbol);
                    connect();
                }
            }, 3000); // Reconnect after 3 seconds
        }

        private void cancelReconnect() {
            if (reconnectTimer != null) {
                reconnectTimer.cancel();
                reconnectTimer = null;
            }
        }
    }

    /**
     * Parse OKX order book data into OrderBookData.
     */
    @SuppressWarnings("unchecked")
    private OrderBookData parseOrderBook(Map<String, Object> raw) {
        List<OrderBookLevel> bids = new ArrayList<>();
        List<OrderBookLevel> asks = new ArrayList<>();

        List<List<Object>> rawBids = (List<List<Object>>) raw.get("bids");
        List<List<Object>> rawAsks = (List<List<Object>>) raw.get("asks");

        if (rawBids != null) {
            for (List<Object> b : rawBids) {
                bids.add(new OrderBookLevel(
                        safeGet(b, 0),
                        safeGet(b, 1),
                        b.size() > 3 ? safeGet(b, 3) : "0"
                ));
            }
        }

        if (rawAsks != null) {
            for (List<Object> a : rawAsks) {
                asks.add(new OrderBookLevel(
                        safeGet(a, 0),
                        safeGet(a, 1),
                        a.size() > 3 ? safeGet(a, 3) : "0"
                ));
            }
        }

        String ts = raw.get("ts") != null ? raw.get("ts").toString() : String.valueOf(System.currentTimeMillis());
        return new OrderBookData(bids, asks, ts);
    }

    private String safeGet(List<Object> list, int index) {
        if (index < list.size() && list.get(index) != null) {
            return list.get(index).toString();
        }
        return "0";
    }

    /**
     * Jakarta WebSocket endpoint that delegates to OkxConnection.
     */
    @ClientEndpoint
    private static class OkxWebSocketEndpoint {
        private final OkxConnection connection;

        OkxWebSocketEndpoint(OkxConnection connection) {
            this.connection = connection;
        }

        @OnOpen
        public void onOpen(Session session) {
            connection.onOpen(session);
        }

        @OnMessage
        public void onMessage(String message) {
            connection.onMessage(message);
        }

        @OnClose
        public void onClose(CloseReason closeReason) {
            connection.onClose(closeReason);
        }

        @OnError
        public void onError(Throwable error) {
            connection.onError(error);
        }
    }
}
