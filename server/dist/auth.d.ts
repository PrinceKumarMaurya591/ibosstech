/**
 * Simple authentication module with hardcoded user store.
 * In production, this would use a database with hashed passwords.
 */
export interface AuthResult {
    success: boolean;
    message: string;
    username?: string;
}
/**
 * Authenticate a user with username and password.
 */
export declare function authenticate(username: string, password: string): AuthResult;
//# sourceMappingURL=auth.d.ts.map