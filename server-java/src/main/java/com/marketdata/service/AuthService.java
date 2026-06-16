package com.marketdata.service;

import org.springframework.stereotype.Service;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Simple authentication service with hardcoded user store.
 * In production, this would use a database with hashed passwords.
 */
@Service
public class AuthService {

    /**
     * Internal user record.
     */
    private static class User {
        final String username;
        final String password;

        User(String username, String password) {
            this.username = username;
            this.password = password;
        }
    }

    // Hardcoded user store as per requirements
    private static final Map<String, User> USERS = new ConcurrentHashMap<>();

    static {
        for (User user : new User[]{
                new User("admin", "admin123"),
                new User("trader", "trader123"),
                new User("demo", "demo123")
        }) {
            USERS.put(user.username, user);
        }
    }

    /**
     * Authenticate a user with username and password.
     *
     * @param username the username
     * @param password the password
     * @return AuthResult indicating success or failure
     */
    public AuthResult authenticate(String username, String password) {
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            return new AuthResult(false, "Username and password are required", null);
        }

        User user = USERS.get(username);
        if (user == null || !user.password.equals(password)) {
            return new AuthResult(false, "Invalid username or password", null);
        }

        return new AuthResult(true, "Authentication successful", user.username);
    }

    /**
     * Result of an authentication attempt.
     */
    public static class AuthResult {
        private final boolean success;
        private final String message;
        private final String username;

        public AuthResult(boolean success, String message, String username) {
            this.success = success;
            this.message = message;
            this.username = username;
        }

        public boolean isSuccess() { return success; }
        public String getMessage() { return message; }
        public String getUsername() { return username; }
    }
}
