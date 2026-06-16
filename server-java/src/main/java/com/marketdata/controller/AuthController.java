package com.marketdata.controller;

import com.marketdata.model.LoginRequest;
import com.marketdata.model.LoginResponse;
import com.marketdata.service.AuthService;
import com.marketdata.service.SessionManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST controller for authentication endpoints.
 */
@RestController
@RequestMapping("/api")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthService authService;
    private final SessionManager sessionManager;

    public AuthController(AuthService authService, SessionManager sessionManager) {
        this.authService = authService;
        this.sessionManager = sessionManager;
    }

    /**
     * POST /api/login
     * Authenticate user and create a session.
     * Enforces single-session-per-client: if the user already
     * has an active session, it will be invalidated.
     */
    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
        AuthService.AuthResult result = authService.authenticate(
                request.getUsername(), request.getPassword()
        );

        if (!result.isSuccess()) {
            return ResponseEntity.status(401)
                    .body(new LoginResponse(false, result.getMessage()));
        }

        // Create session (invalidates any existing session for this user)
        String sessionId = sessionManager.createSession(result.getUsername());

        log.info("[Auth] User '{}' logged in, session: {}", result.getUsername(), sessionId);

        return ResponseEntity.ok(new LoginResponse(
                true, "Login successful", sessionId, result.getUsername()
        ));
    }

    /**
     * POST /api/logout
     * End a session.
     */
    @PostMapping("/logout")
    public ResponseEntity<LoginResponse> logout(@RequestBody(required = false) LoginRequest body,
                                                 @RequestParam(required = false) String sessionId) {
        String sid = (body != null) ? null : sessionId;
        // Support both body and query param for flexibility
        if (sid != null) {
            sessionManager.removeSession(sid);
        }
        return ResponseEntity.ok(new LoginResponse(true, "Logged out"));
    }
}
