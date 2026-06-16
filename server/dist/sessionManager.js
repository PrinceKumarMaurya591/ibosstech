"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = void 0;
const uuid_1 = require("uuid");
const ws_1 = __importDefault(require("ws"));
/**
 * SessionManager enforces a single-session-per-client rule.
 * Each username can only have one active session at a time.
 * When a new session is created for a user, any existing session
 * for that user is invalidated (the old WebSocket is closed with
 * a reason code).
 *
 * This prevents the same user from having multiple simultaneous
 * connections, which would waste resources and potentially cause
 * data inconsistency issues.
 */
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.userSessions = new Map(); // username -> sessionId
    }
    /**
     * Create a new session for a user.
     * If the user already has an active session, the old one is terminated.
     * Returns the new session ID.
     */
    createSession(username, ws = null) {
        // Terminate existing session for this user
        this.invalidateUserSession(username);
        const sessionId = (0, uuid_1.v4)();
        const session = {
            sessionId,
            username,
            ws,
            createdAt: Date.now(),
        };
        this.sessions.set(sessionId, session);
        this.userSessions.set(username, sessionId);
        console.log(`[SessionManager] Session created: ${sessionId} for user ${username}`);
        return sessionId;
    }
    /**
     * Associate a WebSocket connection with an existing session.
     */
    attachWebSocket(sessionId, ws) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        // If there's already a WS for this session, close the old one
        if (session.ws && session.ws.readyState === ws_1.default.OPEN) {
            session.ws.close(1000, 'Session superseded by new connection');
        }
        session.ws = ws;
        return true;
    }
    /**
     * Validate a session ID and return the associated username.
     */
    validateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return session.username;
    }
    /**
     * Remove a session by ID.
     */
    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.userSessions.delete(session.username);
            this.sessions.delete(sessionId);
            console.log(`[SessionManager] Session removed: ${sessionId} for user ${session.username}`);
        }
    }
    /**
     * Invalidate any existing session for a user.
     */
    invalidateUserSession(username) {
        const existingSessionId = this.userSessions.get(username);
        if (existingSessionId) {
            const existingSession = this.sessions.get(existingSessionId);
            if (existingSession && existingSession.ws) {
                try {
                    existingSession.ws.close(1000, 'New session started elsewhere');
                }
                catch (e) {
                    // Ignore errors on close
                }
            }
            this.sessions.delete(existingSessionId);
            this.userSessions.delete(username);
            console.log(`[SessionManager] Invalidated old session for user ${username}`);
        }
    }
    /**
     * Get the count of active sessions.
     */
    getActiveSessionCount() {
        return this.sessions.size;
    }
    /**
     * Clean up stale sessions (older than the specified age in ms).
     */
    cleanupStaleSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.createdAt > maxAgeMs) {
                this.removeSession(id);
            }
        }
    }
}
exports.sessionManager = new SessionManager();
//# sourceMappingURL=sessionManager.js.map