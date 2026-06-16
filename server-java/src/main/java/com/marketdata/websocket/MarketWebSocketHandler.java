package com.marketdata.websocket;

import com.marketdata.model.OrderBookData;
import com.marketdata.service.DataSource;
import com.marketdata.service.SessionManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Handles WebSocket connections from browser clients.
 * <p>
 * Protocol:
 * - Client sends: { "type": "auth", "sessionId": "..." }
 * - Server responds: { "type": "auth_ok", "message": "Authenticated" }
 * - Client sends: { "type": "subscribe", "symbol": "BTC-USDT" }
 * - Server responds with order book updates:
 *   { "type": "orderbook", "symbol": "BTC-USDT", "data": { ... } }
 * - Client sends: { "type": "unsubscribe" }
 * - Server responds: { "type": "unsubscribed" }
 */
@Component
public class MarketWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(MarketWebSocketHandler.class);

    private final SessionManager sessionManager;
    private final DataSource dataSource;

    // Client session -> subscription info
    private final Map<WebSocketSession, ClientSubscription> subscriptions = new ConcurrentHashMap<>();

    public MarketWebSocketHandler(SessionManager sessionManager, DataSource dataSource) {
        this.sessionManager = sessionManager;
        this.dataSource = dataSource;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("[WS] New client connection: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(message.getPayload(), Map.class);

            String type = (String) data.get("type");
            if (type == null) {
                sendError(session, "Missing message type");
                return;
            }

            switch (type) {
                case "auth" -> handleAuth(session, data);
                case "subscribe" -> handleSubscribe(session, data);
                case "unsubscribe" -> handleUnsubscribe(session);
                default -> sendError(session, "Unknown message type: " + type);
            }
        } catch (Exception e) {
            log.error("[WS] Failed to parse message from {}: {}", session.getId(), e.getMessage());
            sendError(session, "Invalid JSON");
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("[WS] Client disconnected: {} (status: {})", session.getId(), status);

        // Clean up subscription
        ClientSubscription sub = subscriptions.remove(session);
        if (sub != null && sub.unsubscribe != null) {
            sub.unsubscribe.run();
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("[WS] Transport error for {}: {}", session.getId(), exception.getMessage());
    }

    /**
     * Handle authentication message.
     * Expected: { "type": "auth", "sessionId": "..." }
     */
    private void handleAuth(WebSocketSession session, Map<String, Object> data) {
        String sessionId = (String) data.get("sessionId");
        if (sessionId == null || sessionId.isBlank()) {
            sendError(session, "sessionId is required", "AUTH_REQUIRED");
            return;
        }

        String username = sessionManager.validateSession(sessionId);
        if (username == null) {
            sendError(session, "Invalid or expired session", "AUTH_FAILED");
            return;
        }

        // Associate this WebSocket with the session
        sessionManager.attachWebSocket(sessionId, session);

        sendToClient(session, Map.of("type", "auth_ok", "message", "Authenticated"));
        log.info("[WS] Client authenticated: {} (session: {})", username, sessionId);
    }

    /**
     * Handle order book subscription.
     * Expected: { "type": "subscribe", "symbol": "BTC-USDT" }
     */
    private void handleSubscribe(WebSocketSession session, Map<String, Object> data) {
        String symbol = ((String) data.get("symbol")).toUpperCase();
        if (symbol == null || symbol.isBlank()) {
            sendError(session, "Symbol is required");
            return;
        }

        // Unsubscribe from previous subscription if any
        ClientSubscription existing = subscriptions.get(session);
        if (existing != null) {
            existing.unsubscribe.run();
        }

        // Subscribe to order book via the active data source
        Runnable unsubscribe = dataSource.subscribeOrderBook(symbol, (OrderBookData orderBook) -> {
            sendToClient(session, Map.of(
                    "type", "orderbook",
                    "symbol", symbol,
                    "data", orderBook
            ));
        });

        subscriptions.put(session, new ClientSubscription(symbol, unsubscribe));
        sendToClient(session, Map.of("type", "subscribed", "symbol", symbol));
        log.info("[WS] Client subscribed to {}", symbol);
    }

    /**
     * Handle unsubscription.
     */
    private void handleUnsubscribe(WebSocketSession session) {
        ClientSubscription sub = subscriptions.remove(session);
        if (sub != null) {
            sub.unsubscribe.run();
            sendToClient(session, Map.of("type", "unsubscribed"));
            log.info("[WS] Client unsubscribed");
        }
    }

    /**
     * Send a JSON message to a WebSocket client.
     */
    private void sendToClient(WebSocketSession session, Object data) {
        if (session.isOpen()) {
            try {
                String json = new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(data);
                session.sendMessage(new TextMessage(json));
            } catch (IOException e) {
                log.error("[WS] Failed to send message to {}: {}", session.getId(), e.getMessage());
            }
        }
    }

    /**
     * Send an error message to a WebSocket client.
     */
    private void sendError(WebSocketSession session, String message) {
        sendError(session, message, "ERROR");
    }

    private void sendError(WebSocketSession session, String message, String code) {
        sendToClient(session, Map.of("type", "error", "code", code, "message", message));
    }

    /**
     * Holds subscription info for a client.
     */
    private record ClientSubscription(String symbol, Runnable unsubscribe) {}
}
