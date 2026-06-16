package com.marketdata.controller;

import com.marketdata.service.SessionManager;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Health check endpoint.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private final SessionManager sessionManager;

    public HealthController(SessionManager sessionManager) {
        this.sessionManager = sessionManager;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "ok",
                "activeSessions", sessionManager.getActiveSessionCount()
        ));
    }
}
