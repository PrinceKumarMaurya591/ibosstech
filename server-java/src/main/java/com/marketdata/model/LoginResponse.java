package com.marketdata.model;

/**
 * Login response DTO.
 */
public class LoginResponse {
    private boolean success;
    private String message;
    private String sessionId;
    private String username;

    public LoginResponse() {}

    public LoginResponse(boolean success, String message) {
        this.success = success;
        this.message = message;
    }

    public LoginResponse(boolean success, String message, String sessionId, String username) {
        this.success = success;
        this.message = message;
        this.sessionId = sessionId;
        this.username = username;
    }

    public boolean isSuccess() { return success; }
    public void setSuccess(boolean success) { this.success = success; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
}
