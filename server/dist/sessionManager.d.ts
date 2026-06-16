import WebSocket from 'ws';
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
declare class SessionManager {
    private sessions;
    private userSessions;
    /**
     * Create a new session for a user.
     * If the user already has an active session, the old one is terminated.
     * Returns the new session ID.
     */
    createSession(username: string, ws?: WebSocket | null): string;
    /**
     * Associate a WebSocket connection with an existing session.
     */
    attachWebSocket(sessionId: string, ws: WebSocket): boolean;
    /**
     * Validate a session ID and return the associated username.
     */
    validateSession(sessionId: string): string | null;
    /**
     * Remove a session by ID.
     */
    removeSession(sessionId: string): void;
    /**
     * Invalidate any existing session for a user.
     */
    private invalidateUserSession;
    /**
     * Get the count of active sessions.
     */
    getActiveSessionCount(): number;
    /**
     * Clean up stale sessions (older than the specified age in ms).
     */
    cleanupStaleSessions(maxAgeMs?: number): void;
}
export declare const sessionManager: SessionManager;
export {};
//# sourceMappingURL=sessionManager.d.ts.map