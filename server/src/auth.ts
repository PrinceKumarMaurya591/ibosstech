/**
 * Simple authentication module with hardcoded user store.
 * In production, this would use a database with hashed passwords.
 */

interface User {
  username: string;
  password: string;
}

// Hardcoded user store as per requirements
const users: User[] = [
  { username: 'admin', password: 'admin123' },
  { username: 'trader', password: 'trader123' },
  { username: 'demo', password: 'demo123' },
];

export interface AuthResult {
  success: boolean;
  message: string;
  username?: string;
}

/**
 * Authenticate a user with username and password.
 */
export function authenticate(username: string, password: string): AuthResult {
  if (!username || !password) {
    return { success: false, message: 'Username and password are required' };
  }

  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    return { success: false, message: 'Invalid username or password' };
  }

  return { success: true, message: 'Authentication successful', username: user.username };
}
