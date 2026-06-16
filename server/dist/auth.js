"use strict";
/**
 * Simple authentication module with hardcoded user store.
 * In production, this would use a database with hashed passwords.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
// Hardcoded user store as per requirements
const users = [
    { username: 'admin', password: 'admin123' },
    { username: 'trader', password: 'trader123' },
    { username: 'demo', password: 'demo123' },
];
/**
 * Authenticate a user with username and password.
 */
function authenticate(username, password) {
    if (!username || !password) {
        return { success: false, message: 'Username and password are required' };
    }
    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) {
        return { success: false, message: 'Invalid username or password' };
    }
    return { success: true, message: 'Authentication successful', username: user.username };
}
//# sourceMappingURL=auth.js.map