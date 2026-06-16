import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

interface Session {
  sessionId: string;
  username: string;
  ws: WebSocket | null;
  createdAt: number;
}

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
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, string> = new Map(); // username -> sessionId

  /**
   * Create a new session for a user.
   * If the user already has an active session, the old one is terminated.
   * Returns the new session ID.
   */
  createSession(username: string, ws: WebSocket | null = null): string {
    // Terminate existing session for this user
    this.invalidateUserSession(username);

    const sessionId = uuidv4();
    const session: Session = {
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
  attachWebSocket(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // If there's already a WS for this session, close the old one
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close(1000, 'Session superseded by new connection');
    }

    session.ws = ws;
    return true;
  }

  /**
   * Validate a session ID and return the associated username.
   */
  validateSession(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session.username;
  }

  /**
   * Remove a session by ID.
   */
  removeSession(sessionId: string): void {
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
  private invalidateUserSession(username: string): void {
    const existingSessionId = this.userSessions.get(username);
    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId);
      if (existingSession && existingSession.ws) {
        try {
          existingSession.ws.close(1000, 'New session started elsewhere');
        } catch (e) {
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
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up stale sessions (older than the specified age in ms).
   */
  cleanupStaleSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > maxAgeMs) {
        this.removeSession(id);
      }
    }
  }
}

export const sessionManager = new SessionManager();
