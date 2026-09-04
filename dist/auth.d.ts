/**
 * PostgREST Authentication Middleware
 *
 * Provides JWT and API key authentication for PostgREST endpoints.
 * Supports both HS256/HS384 (HMAC) and RS256 (RSA) JWT algorithms
 * using the Web Crypto API for Cloudflare Workers compatibility.
 *
 * @module postgrest-compat/auth
 */
import type { Context, MiddlewareHandler } from 'hono';
/**
 * JWT payload structure with standard and custom claims.
 */
export interface JWTPayload {
    /** Subject (user ID) */
    sub?: string;
    /** Role/group */
    role?: string;
    /** Issued at timestamp (seconds since epoch) */
    iat?: number;
    /** Expiration timestamp (seconds since epoch) */
    exp?: number;
    /** Not before timestamp (seconds since epoch) */
    nbf?: number;
    /** Audience */
    aud?: string | string[];
    /** Additional custom claims */
    [key: string]: unknown;
}
/**
 * JWT verification options controlling which algorithms are accepted
 * and how claims are validated.
 */
export interface JWTOptions {
    /** Secret key for HMAC algorithms (HS256, HS384) */
    secret?: string;
    /** Public key for RSA algorithms in PEM format (RS256) */
    publicKey?: string;
    /** Allowed algorithms (e.g., ['HS256'] or ['RS256']) */
    algorithms: string[];
    /** Clock tolerance in seconds for exp/nbf validation */
    clockTolerance?: number;
    /** Claim names that must be present in the payload */
    requiredClaims?: string[];
    /** Custom claims validator (return false to reject) */
    validateClaims?: (claims: JWTPayload) => boolean | Promise<boolean>;
}
/**
 * API key verification options supporting both static key lists
 * and custom validation functions.
 */
export interface ApiKeyOptions {
    /** Array of valid API keys (uses constant-time comparison) */
    keys?: string[];
    /** Custom validation function (e.g., for database lookups) */
    validateKey?: (key: string) => Promise<{
        userId: string;
        role: string;
    } | null>;
    /** Header name to check (default: 'X-API-Key') */
    headerName?: string;
    /** Prefix to strip from header value (e.g., 'ApiKey') */
    prefix?: string;
}
/**
 * Authentication middleware configuration.
 */
export interface AuthConfig {
    /** JWT authentication configuration */
    jwt?: JWTOptions;
    /** API key authentication configuration */
    apiKey?: ApiKeyOptions;
    /** Allow anonymous access (auth becomes optional) */
    allowAnonymous?: boolean;
    /** Custom error handler for authentication failures */
    onError?: (error: Error, c: Context) => Response | Promise<Response>;
}
/**
 * Authentication result attached to the request context after successful auth.
 */
export interface AuthResult {
    /** User ID (from JWT sub claim or API key validation) */
    userId: string;
    /** User role */
    role: string;
    /** Which authentication method was used */
    method: 'jwt' | 'api-key';
    /** Raw JWT claims (only present for JWT auth) */
    claims?: JWTPayload;
}
/**
 * Result of JWT token verification.
 */
export interface JWTVerificationResult {
    /** Whether the token is valid */
    valid: boolean;
    /** Decoded payload (only present when valid) */
    payload?: JWTPayload;
    /** Error message (only present when invalid) */
    error?: string;
}
/**
 * Result of API key verification.
 */
export interface ApiKeyVerificationResult {
    /** Whether the key is valid */
    valid: boolean;
    /** User ID from custom validation */
    userId?: string;
    /** Role from custom validation */
    role?: string;
    /** Error message (only present when invalid) */
    error?: string;
}
/**
 * Verify a JWT token's structure, signature, and claims.
 *
 * Performs the following checks in order:
 * 1. Token structure (3 parts separated by dots)
 * 2. Algorithm validation (blocks "none", checks allowlist)
 * 3. Signature verification (HMAC or RSA via Web Crypto)
 * 4. Required claims presence
 * 5. Expiration (exp) with clock tolerance
 * 6. Not-before (nbf) with clock tolerance
 * 7. Custom claims validation (if configured)
 *
 * @param token - The raw JWT token string
 * @param options - Verification configuration
 * @returns Verification result with payload on success, error message on failure
 */
export declare function verifyJWT(token: string, options: JWTOptions): Promise<JWTVerificationResult>;
/**
 * Verify an API key using either a static key list or custom validator.
 *
 * When using a static key list, constant-time comparison is used to prevent
 * timing attacks.
 *
 * @param key - The API key to verify
 * @param options - Verification configuration
 * @returns Verification result with optional user info
 */
export declare function verifyApiKey(key: string, options: ApiKeyOptions): Promise<ApiKeyVerificationResult>;
/**
 * Create a Hono authentication middleware.
 *
 * Checks authentication in the following order:
 * 1. JWT Bearer token in Authorization header
 * 2. API key in configured header (default: X-API-Key)
 * 3. Anonymous access (if allowed)
 *
 * On success, attaches an AuthResult to the context via `c.set('auth', result)`.
 *
 * @param config - Authentication configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * const auth = createAuthMiddleware({
 *   jwt: { secret: 'my-secret', algorithms: ['HS256'] },
 *   allowAnonymous: false,
 * })
 * app.use('/api/*', auth)
 * ```
 */
export declare function createAuthMiddleware(config: AuthConfig): MiddlewareHandler;
//# sourceMappingURL=auth.d.ts.map