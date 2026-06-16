package com.marketdata.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SessionManager enforces a single-session-per-client rule.
 * <p>
 * Each username can only have one active session at a time.
 * When a new session is created for a user, any existing session
 * for that user is invalidated (the old WebSocket is closed with
 * a reason message).
 * <p>
 * This prevents the same user from having multiple simultaneous
 * connections, which would waste resources and potentially cause
 * data inconsistency issues.
 */
@Service
public class SessionManager {

    private static final Logger log = LoggerFactory.getLogger(SessionManager.class);

    /**
     * Internal session representation.
     */
    public static class Session {
        final String sessionId;
        final String username;
        WebSocketSession wsSession;
        final long createdAt;

        Session(String sessionId, String username, WebSocketSession wsSession) {
            this.sessionId = sessionId;
            this.username = username;
            this.wsSession = wsSession;
            this.createdAt = System.currentTimeMillis();
        }
    }

    // sessionId -> Session
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    // username -> sessionId
    private final Map<String, String> userSessions = new ConcurrentHashMap<>();

    /**
     * Create a new session for a user.
     * If the user already has an active session, the old one is terminated.
     *
     * @param username the user to create a session for
     * @return the new session ID
     */
    public String createSession(String username) {
        return createSession(username, null);
    }

    /**
     * Create a new session for a user with an optional WebSocket session.
     * If the user already has an active session, the old one is terminated.
     *
     * @param username  the user to create a session for
     * @param wsSession optional WebSocket session to associate
     * @return the new session ID
     */
    public String createSession(String username, WebSocketSession wsSession) {
        // Terminate existing session for this user
        invalidateUserSession(username);

        String sessionId = UUID.randomUUID().toString();
        Session session = new Session(sessionId, username, wsSession);

        sessions.put(sessionId, session);
        userSessions.put(username, sessionId);

        log.info("[SessionManager] Session created: {} for user {}", sessionId, username);
        return sessionId;
    }

    /**
     * Associate a WebSocket session with an existing REST session ID.
     *
     * @param sessionId the REST session ID
     * @param wsSession the WebSocket session to attach
     * @return true if the session was found and updated
     */
    public boolean attachWebSocket(String sessionId, WebSocketSession wsSession) {
        Session session = sessions.get(sessionId);
        if (session == null) {
            return false;
        }

        // If there's already a WS for this session, close the old one
        if (session.wsSession != null && session.wsSession.isOpen()) {
            try {
                session.wsSession.close(
                        org.springframework.web.socket.CloseStatus.POLICY_VIOLATION
                                .withReason("Session superseded by new connection")
                );
            } catch (IOException e) {
                log.warn("[SessionManager] Error closing old WS: {}", e.getMessage());
            }
        }

        session.wsSession = wsSession;
        return true;
    }

    /**
     * Validate a session ID and return the associated username.
     *
     * @param sessionId the session ID to validate
     * @return the username, or null if the session is invalid/expired
     */
    public String validateSession(String sessionId) {
        Session session = sessions.get(sessionId);
        if (session == null) {
            return null;
        }
        return session.username;
    }

    /**
     * Remove a session by ID.
     *
     * @param sessionId the session ID to remove
     */
    public void removeSession(String sessionId) {
        Session session = sessions.remove(sessionId);
        if (session != null) {
            userSessions.remove(session.username);
            log.info("[SessionManager] Session removed: {} for user {}", sessionId, session.username);
        }
    }

    /**
     * Invalidate any existing session for a user.
     */
    private void invalidateUserSession(String username) {
        String existingSessionId = userSessions.get(username);
        if (existingSessionId != null) {
            Session existingSession = sessions.get(existingSessionId);
            if (existingSession != null && existingSession.wsSession != null
                    && existingSession.wsSession.isOpen()) {
                try {
                    existingSession.wsSession.close(
                            org.springframework.web.socket.CloseStatus.POLICY_VIOLATION
                                    .withReason("New session started elsewhere")
                    );
                } catch (IOException e) {
                    log.warn("[SessionManager] Error closing old WS: {}", e.getMessage());
                }
            }
            sessions.remove(existingSessionId);
            userSessions.remove(username);
            log.info("[SessionManager] Invalidated old session for user {}", username);
        }
    }

    /**
     * Get the count of active sessions.
     */
    public int getActiveSessionCount() {
        return sessions.size();
    }
}
