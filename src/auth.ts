/**
 * PostgREST Authentication Middleware
 *
 * Provides JWT and API key authentication for PostgREST endpoints.
 * Supports both HS256/HS384 (HMAC) and RS256 (RSA) JWT algorithms
 * using the Web Crypto API for Cloudflare Workers compatibility.
 *
 * @module postgrest-compat/auth
 */

import type { Context, MiddlewareHandler } from 'hono'
import { constantTimeCompare } from './crypto.js'

// --- Constants ---

/** Number of parts in a valid JWT (header.payload.signature) */
const JWT_PART_COUNT = 3;

/** Base64 padding character */
const BASE64_PAD_CHAR = '=';

/** Required padding alignment for base64 strings */
const BASE64_PAD_ALIGNMENT = 4;

/** Bearer token prefix in Authorization header */
const BEARER_PREFIX = 'Bearer ';

/** Length of the Bearer prefix string */
const BEARER_PREFIX_LENGTH = BEARER_PREFIX.length;

/** Milliseconds per second (for epoch timestamp conversion) */
const MS_PER_SECOND = 1000;

/** Default clock tolerance in seconds for JWT exp/nbf checks */
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 0;

/** Default API key header name */
const DEFAULT_API_KEY_HEADER = 'X-API-Key';

/** Default role for authenticated JWT users without explicit role claim */
const DEFAULT_JWT_ROLE = 'authenticated';

/** Default user ID for API key authentication without custom validation */
const DEFAULT_API_KEY_USER_ID = 'api-user';

/** Default role for API key authentication without custom validation */
const DEFAULT_API_KEY_ROLE = 'api-user';

/** PEM header for public keys */
const PEM_PUBLIC_KEY_HEADER = '-----BEGIN PUBLIC KEY-----';

/** PEM footer for public keys */
const PEM_PUBLIC_KEY_FOOTER = '-----END PUBLIC KEY-----';

/** WWW-Authenticate scheme for error responses */
const WWW_AUTHENTICATE_SCHEME = 'Bearer';

// --- Types ---

/**
 * JWT payload structure with standard and custom claims.
 */
export interface JWTPayload {
  /** Subject (user ID) */
  sub?: string
  /** Role/group */
  role?: string
  /** Issued at timestamp (seconds since epoch) */
  iat?: number
  /** Expiration timestamp (seconds since epoch) */
  exp?: number
  /** Not before timestamp (seconds since epoch) */
  nbf?: number
  /** Audience */
  aud?: string | string[]
  /** Additional custom claims */
  [key: string]: unknown
}

/**
 * JWT verification options controlling which algorithms are accepted
 * and how claims are validated.
 */
export interface JWTOptions {
  /** Secret key for HMAC algorithms (HS256, HS384) */
  secret?: string
  /** Public key for RSA algorithms in PEM format (RS256) */
  publicKey?: string
  /** Allowed algorithms (e.g., ['HS256'] or ['RS256']) */
  algorithms: string[]
  /** Clock tolerance in seconds for exp/nbf validation */
  clockTolerance?: number
  /** Claim names that must be present in the payload */
  requiredClaims?: string[]
  /** Custom claims validator (return false to reject) */
  validateClaims?: (claims: JWTPayload) => boolean | Promise<boolean>
}

/**
 * API key verification options supporting both static key lists
 * and custom validation functions.
 */
export interface ApiKeyOptions {
  /** Array of valid API keys (uses constant-time comparison) */
  keys?: string[]
  /** Custom validation function (e.g., for database lookups) */
  validateKey?: (key: string) => Promise<{ userId: string; role: string } | null>
  /** Header name to check (default: 'X-API-Key') */
  headerName?: string
  /** Prefix to strip from header value (e.g., 'ApiKey') */
  prefix?: string
}

/**
 * Authentication middleware configuration.
 */
export interface AuthConfig {
  /** JWT authentication configuration */
  jwt?: JWTOptions
  /** API key authentication configuration */
  apiKey?: ApiKeyOptions
  /** Allow anonymous access (auth becomes optional) */
  allowAnonymous?: boolean
  /** Custom error handler for authentication failures */
  onError?: (error: Error, c: Context) => Response | Promise<Response>
}

/**
 * Authentication result attached to the request context after successful auth.
 */
export interface AuthResult {
  /** User ID (from JWT sub claim or API key validation) */
  userId: string
  /** User role */
  role: string
  /** Which authentication method was used */
  method: 'jwt' | 'api-key'
  /** Raw JWT claims (only present for JWT auth) */
  claims?: JWTPayload
}

/**
 * Result of JWT token verification.
 */
export interface JWTVerificationResult {
  /** Whether the token is valid */
  valid: boolean
  /** Decoded payload (only present when valid) */
  payload?: JWTPayload
  /** Error message (only present when invalid) */
  error?: string
}

/**
 * Result of API key verification.
 */
export interface ApiKeyVerificationResult {
  /** Whether the key is valid */
  valid: boolean
  /** User ID from custom validation */
  userId?: string
  /** Role from custom validation */
  role?: string
  /** Error message (only present when invalid) */
  error?: string
}

// --- Internal Helpers ---

/**
 * Decode a base64url-encoded string to a regular string.
 * Handles URL-safe character replacement and missing padding.
 */
function base64UrlDecode(input: string): string {
  let str = input.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % BASE64_PAD_ALIGNMENT) {
    str += BASE64_PAD_CHAR
  }
  return atob(str)
}

/**
 * Convert a binary string to a Uint8Array.
 */
function binaryStringToBytes(binaryStr: string): ArrayBuffer {
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes.buffer as ArrayBuffer
}

/**
 * Parse a JWT token into its header and payload without verifying the signature.
 * Returns null if the token structure is invalid.
 */
function parseJWT(token: string): { header: Record<string, unknown>; payload: JWTPayload } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== JWT_PART_COUNT) {
      return null
    }

    const [headerB64, payloadB64] = parts
    if (!headerB64 || !payloadB64) {
      return null
    }

    const header = JSON.parse(base64UrlDecode(headerB64)) as Record<string, unknown>
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as JWTPayload

    return { header, payload }
  } catch {
    return null
  }
}

/**
 * Import an HMAC key for signature verification.
 */
async function importHmacKey(secret: string, hashAlgorithm: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: hashAlgorithm },
    false,
    ['verify']
  )
}

/**
 * Import an RSA public key from PEM format for signature verification.
 */
async function importRsaPublicKey(pemKey: string): Promise<CryptoKey> {
  const pemContents = pemKey
    .replace(PEM_PUBLIC_KEY_HEADER, '')
    .replace(PEM_PUBLIC_KEY_FOOTER, '')
    .replace(/\s/g, '')

  const derBuffer = binaryStringToBytes(atob(pemContents))

  return crypto.subtle.importKey(
    'spki',
    derBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
}

/**
 * Verify a JWT signature using the Web Crypto API.
 *
 * Supports HS256, HS384 (HMAC) and RS256 (RSA) algorithms.
 * Returns false for unsupported algorithms or verification failures.
 */
async function verifySignature(
  token: string,
  algorithm: string,
  key: string
): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== JWT_PART_COUNT) {
      return false
    }

    const [headerB64, payloadB64, signatureB64] = parts
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return false
    }

    const encoder = new TextEncoder()
    const messageBuffer = encoder.encode(`${headerB64}.${payloadB64}`).buffer as ArrayBuffer
    const signatureBuffer = binaryStringToBytes(base64UrlDecode(signatureB64))

    if (algorithm === 'HS256') {
      const cryptoKey = await importHmacKey(key, 'SHA-256')
      return await crypto.subtle.verify('HMAC', cryptoKey, signatureBuffer, messageBuffer)
    }

    if (algorithm === 'HS384') {
      const cryptoKey = await importHmacKey(key, 'SHA-384')
      return await crypto.subtle.verify('HMAC', cryptoKey, signatureBuffer, messageBuffer)
    }

    if (algorithm === 'RS256') {
      const cryptoKey = await importRsaPublicKey(key)
      return await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        signatureBuffer,
        messageBuffer
      )
    }

    return false
  } catch {
    return false
  }
}

/**
 * Get the current time as a Unix timestamp in seconds.
 */
function currentTimestampSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND)
}

// --- Public API ---

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
export async function verifyJWT(
  token: string,
  options: JWTOptions
): Promise<JWTVerificationResult> {
  try {
    const parsed = parseJWT(token)
    if (!parsed) {
      return { valid: false, error: 'Invalid token structure' }
    }

    const { header, payload } = parsed

    // Validate algorithm
    const algorithm = header.alg as string
    if (!algorithm) {
      return { valid: false, error: 'Missing algorithm in token header' }
    }

    if (algorithm.toLowerCase() === 'none') {
      return { valid: false, error: 'Algorithm "none" is not allowed' }
    }

    if (!options.algorithms.includes(algorithm)) {
      return { valid: false, error: `Unsupported algorithm: ${algorithm}` }
    }

    // Determine the verification key
    let key: string
    if (algorithm.startsWith('HS')) {
      if (!options.secret) {
        return { valid: false, error: 'Secret key required for HMAC algorithms' }
      }
      key = options.secret
    } else if (algorithm.startsWith('RS')) {
      if (!options.publicKey) {
        return { valid: false, error: 'Public key required for RSA algorithms' }
      }
      key = options.publicKey
    } else {
      return { valid: false, error: `Unsupported algorithm: ${algorithm}` }
    }

    // Verify cryptographic signature
    const signatureValid = await verifySignature(token, algorithm, key)
    if (!signatureValid) {
      return { valid: false, error: 'Token signature is invalid' }
    }

    // Validate required claims
    if (options.requiredClaims) {
      for (const claim of options.requiredClaims) {
        if (!(claim in payload)) {
          return { valid: false, error: `Token is missing required claim: ${claim}` }
        }
      }
    }

    // Validate temporal claims with clock tolerance
    const now = currentTimestampSeconds()
    const clockTolerance = options.clockTolerance || DEFAULT_CLOCK_TOLERANCE_SECONDS

    if (payload.exp !== undefined && now > payload.exp + clockTolerance) {
      return { valid: false, error: 'Token has expired' }
    }

    if (payload.nbf !== undefined && now < payload.nbf - clockTolerance) {
      return { valid: false, error: 'Token is not yet valid' }
    }

    // Run custom validation
    if (options.validateClaims) {
      try {
        const customValid = await options.validateClaims(payload)
        if (!customValid) {
          return { valid: false, error: 'Custom validation failed' }
        }
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : 'Custom validation error',
        }
      }
    }

    return { valid: true, payload }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    }
  }
}

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
export async function verifyApiKey(
  key: string,
  options: ApiKeyOptions
): Promise<ApiKeyVerificationResult> {
  try {
    // Custom validator takes precedence
    if (options.validateKey) {
      const result = await options.validateKey(key)
      if (result) {
        return { valid: true, userId: result.userId, role: result.role }
      }
      return { valid: false, error: 'Invalid API key' }
    }

    // Static key list with constant-time comparison
    if (options.keys) {
      const valid = options.keys.some((validKey) => constantTimeCompare(key, validKey))
      if (valid) {
        return { valid: true }
      }
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: 'No validation method configured' }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    }
  }
}

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
export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')

    // Attempt JWT Bearer token authentication
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const token = authHeader.slice(BEARER_PREFIX_LENGTH).trim()

      if (!token) {
        return handleAuthError(
          new Error('Empty Bearer token'),
          c,
          config,
          false
        )
      }

      if (config.jwt) {
        const result = await verifyJWT(token, config.jwt)

        if (result.valid && result.payload) {
          const authResult: AuthResult = {
            userId: result.payload.sub || '',
            role: (result.payload.role as string) || DEFAULT_JWT_ROLE,
            method: 'jwt',
            claims: result.payload,
          }
          c.set('auth', authResult)
          return next()
        }

        return handleAuthError(
          new Error(result.error || 'Invalid token'),
          c,
          config,
          false
        )
      }
    }

    // Attempt API key authentication
    if (config.apiKey) {
      const headerName = config.apiKey.headerName || DEFAULT_API_KEY_HEADER
      let apiKey = c.req.header(headerName)

      // Strip prefix if configured
      if (apiKey && config.apiKey.prefix) {
        const prefixWithSpace = `${config.apiKey.prefix} `
        if (apiKey.startsWith(prefixWithSpace)) {
          apiKey = apiKey.slice(prefixWithSpace.length).trim()
        } else if (headerName === 'Authorization') {
          // Authorization header requires the prefix
          apiKey = undefined
        }
      }

      if (apiKey) {
        const result = await verifyApiKey(apiKey, config.apiKey)

        if (result.valid) {
          const authResult: AuthResult = {
            userId: result.userId || DEFAULT_API_KEY_USER_ID,
            role: result.role || DEFAULT_API_KEY_ROLE,
            method: 'api-key',
          }
          c.set('auth', authResult)
          return next()
        }

        return handleAuthError(
          new Error(result.error || 'Invalid API key'),
          c,
          config,
          false
        )
      }
    }

    // Allow anonymous access if configured
    if (config.allowAnonymous) {
      return next()
    }

    // No valid authentication found
    return handleAuthError(
      new Error('No authentication provided - authentication required'),
      c,
      config,
      true
    )
  }
}

/**
 * Handle authentication errors with appropriate HTTP response.
 *
 * Uses the custom error handler if configured, otherwise returns
 * a 401 response with error details and WWW-Authenticate header.
 */
function handleAuthError(
  error: Error,
  c: Context,
  config: AuthConfig,
  isNoAuth: boolean
): Response | Promise<Response> {
  if (config.onError) {
    return config.onError(error, c)
  }

  // For "no auth provided" case, use generic label; otherwise use specific error
  const errorField = isNoAuth ? 'Unauthorized' : error.message

  return c.json(
    {
      error: errorField,
      message: error.message,
    },
    401,
    {
      'WWW-Authenticate': WWW_AUTHENTICATE_SCHEME,
    }
  )
}
