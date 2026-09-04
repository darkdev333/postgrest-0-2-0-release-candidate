/**
 * Content Security Policy (CSP) Middleware
 *
 * Provides configurable CSP headers for Hono applications.
 * Supports environment-based configuration (stricter in production).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
 *
 * Retained for API compatibility from the MIT-licensed
 * @dotdo/postgres-shared@0.1.1 CSP module; see NOTICE.md.
 */
import type { MiddlewareHandler } from 'hono'

// ============================================================================
// Types
// ============================================================================

/**
 * CSP directive values
 */
export type CSPDirectiveValue = string | string[] | boolean

/**
 * CSP directives configuration
 */
export interface CSPDirectives {
  /** Fallback for other fetch directives */
  'default-src'?: CSPDirectiveValue
  /** Valid sources for JavaScript */
  'script-src'?: CSPDirectiveValue
  /** Valid sources for stylesheets */
  'style-src'?: CSPDirectiveValue
  /** Valid sources for fetch, XHR, WebSockets, EventSource */
  'connect-src'?: CSPDirectiveValue
  /** Valid sources for images */
  'img-src'?: CSPDirectiveValue
  /** Valid sources for fonts */
  'font-src'?: CSPDirectiveValue
  /** Valid sources for media (audio, video) */
  'media-src'?: CSPDirectiveValue
  /** Valid sources for <object>, <embed>, <applet> */
  'object-src'?: CSPDirectiveValue
  /** Valid sources for nested browsing contexts (frames) */
  'frame-src'?: CSPDirectiveValue
  /** Valid sources for workers and nested browsing contexts */
  'child-src'?: CSPDirectiveValue
  /** Valid sources for web workers */
  'worker-src'?: CSPDirectiveValue
  /** Valid parents that can embed this page in <frame>, <iframe>, etc. */
  'frame-ancestors'?: CSPDirectiveValue
  /** Valid sources for form submissions */
  'form-action'?: CSPDirectiveValue
  /** Valid sources for <base> element */
  'base-uri'?: CSPDirectiveValue
  /** Valid sources for manifest files */
  'manifest-src'?: CSPDirectiveValue
  /** Restricts URLs that can be loaded using script interfaces */
  'navigate-to'?: CSPDirectiveValue
  /** URI to report CSP violations */
  'report-uri'?: CSPDirectiveValue
  /** Reporting API endpoint name */
  'report-to'?: CSPDirectiveValue
  /** Require trusted types for DOM XSS sinks */
  'require-trusted-types-for'?: CSPDirectiveValue
  /** Trusted types policy names */
  'trusted-types'?: CSPDirectiveValue
  /** Block all mixed content */
  'block-all-mixed-content'?: boolean
  /** Upgrade insecure requests to HTTPS */
  'upgrade-insecure-requests'?: boolean
  /** Sandbox restrictions */
  'sandbox'?: CSPDirectiveValue
}

/**
 * Environment type for CSP configuration
 */
export type CSPEnvironment = 'development' | 'staging' | 'production'

/**
 * CSP middleware options
 */
export interface CSPOptions {
  /**
   * CSP directives to apply
   * Can be a static object or a function that returns directives based on environment
   */
  directives?: CSPDirectives | ((env: CSPEnvironment) => CSPDirectives)

  /**
   * Environment to use for configuration
   * Defaults to 'production'
   */
  environment?: CSPEnvironment

  /**
   * Use Content-Security-Policy-Report-Only header instead of enforcing
   * Useful for testing CSP changes before deployment
   * @default false
   */
  reportOnly?: boolean

  /**
   * Custom nonce generator for script/style nonces
   * If provided, adds nonces to script-src and style-src
   */
  generateNonce?: () => string

  /**
   * Context key to store the nonce in (for use in templates)
   * @default 'cspNonce'
   */
  nonceContextKey?: string

  /**
   * Whether to skip CSP for certain requests
   */
  skip?: (c: HonoContext) => boolean | Promise<boolean>
}

/**
 * Hono context interface (minimal)
 */
interface HonoContext {
  req: {
    header(name: string): string | undefined
    path: string
    method: string
  }
  header(name: string, value: string): void
  set(key: string, value: unknown): void
  get(key: string): unknown
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default CSP directives for API services (no browser rendering)
 * Very strict - blocks almost everything since APIs don't serve HTML
 */
export const API_CSP_DEFAULTS: CSPDirectives = {
  'default-src': "'none'",
  'frame-ancestors': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
}

/**
 * Strict CSP directives for production web applications
 */
export const STRICT_WEB_CSP: CSPDirectives = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': "'self'",
  'frame-ancestors': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'upgrade-insecure-requests': true,
}

/**
 * Development-friendly CSP (more permissive)
 */
export const DEVELOPMENT_CSP: CSPDirectives = {
  'default-src': "'self'",
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
  'font-src': ["'self'", 'data:', 'https:'],
  'connect-src': ["'self'", 'ws:', 'wss:', 'http://localhost:*', 'https://localhost:*'],
  'frame-ancestors': "'self'",
  'base-uri': "'self'",
}

/**
 * Get default CSP directives based on environment
 */
export function getDefaultDirectives(environment: CSPEnvironment): CSPDirectives {
  switch (environment) {
    case 'development':
      return { ...DEVELOPMENT_CSP }
    case 'staging':
      return { ...STRICT_WEB_CSP }
    case 'production':
    default:
      return { ...STRICT_WEB_CSP }
  }
}

// ============================================================================
// CSP Builder
// ============================================================================

/**
 * Format a single CSP directive value
 */
function formatDirectiveValue(value: CSPDirectiveValue): string {
  if (typeof value === 'boolean') {
    return ''
  }
  if (Array.isArray(value)) {
    return value.join(' ')
  }
  return value
}

/**
 * Build a CSP header string from directives
 */
export function buildCSPHeader(directives: CSPDirectives, nonce?: string): string {
  const parts: string[] = []

  for (const [key, value] of Object.entries(directives)) {
    if (value === undefined || value === null) {
      continue
    }

    // Boolean directives (like upgrade-insecure-requests)
    if (typeof value === 'boolean') {
      if (value) {
        parts.push(key)
      }
      continue
    }

    // Add nonce to script-src and style-src if provided
    let finalValue = formatDirectiveValue(value)
    if (nonce && (key === 'script-src' || key === 'style-src')) {
      finalValue = `${finalValue} 'nonce-${nonce}'`
    }

    if (finalValue) {
      parts.push(`${key} ${finalValue}`)
    }
  }

  return parts.join('; ')
}

// ============================================================================
// Additional Security Headers
// ============================================================================

/**
 * Additional security headers configuration
 */
export interface SecurityHeadersOptions {
  /**
   * X-Content-Type-Options header
   * @default 'nosniff'
   */
  contentTypeOptions?: string | false

  /**
   * X-Frame-Options header (legacy, use frame-ancestors CSP instead)
   * @default 'DENY'
   */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false

  /**
   * X-XSS-Protection header (legacy, modern browsers use CSP)
   * @default '0' (disabled, as it can cause issues)
   */
  xssProtection?: string | false

  /**
   * Referrer-Policy header
   * @default 'strict-origin-when-cross-origin'
   */
  referrerPolicy?: string | false

  /**
   * Strict-Transport-Security header
   * @default 'max-age=31536000; includeSubDomains' in production
   */
  strictTransportSecurity?: string | false

  /**
   * Permissions-Policy header (replaces Feature-Policy)
   */
  permissionsPolicy?: string | false

  /**
   * Cross-Origin-Opener-Policy header
   * @default 'same-origin'
   */
  crossOriginOpenerPolicy?: string | false

  /**
   * Cross-Origin-Embedder-Policy header
   */
  crossOriginEmbedderPolicy?: string | false

  /**
   * Cross-Origin-Resource-Policy header
   * @default 'same-origin'
   */
  crossOriginResourcePolicy?: string | false
}

/**
 * Default security headers for production
 */
export const DEFAULT_SECURITY_HEADERS: SecurityHeadersOptions = {
  contentTypeOptions: 'nosniff',
  frameOptions: 'DENY',
  xssProtection: '0',
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
}

/**
 * Apply security headers to response
 */
function applySecurityHeaders(
  c: HonoContext,
  options: SecurityHeadersOptions,
  environment: CSPEnvironment
): void {
  if (options.contentTypeOptions !== false) {
    c.header('X-Content-Type-Options', options.contentTypeOptions || 'nosniff')
  }

  if (options.frameOptions !== false) {
    c.header('X-Frame-Options', options.frameOptions || 'DENY')
  }

  if (options.xssProtection !== false) {
    c.header('X-XSS-Protection', options.xssProtection || '0')
  }

  if (options.referrerPolicy !== false) {
    c.header('Referrer-Policy', options.referrerPolicy || 'strict-origin-when-cross-origin')
  }

  // Only set HSTS in production/staging (not development with HTTP)
  if (options.strictTransportSecurity !== false && environment !== 'development') {
    c.header(
      'Strict-Transport-Security',
      options.strictTransportSecurity || 'max-age=31536000; includeSubDomains'
    )
  }

  if (options.permissionsPolicy) {
    c.header('Permissions-Policy', options.permissionsPolicy)
  }

  if (options.crossOriginOpenerPolicy !== false) {
    c.header('Cross-Origin-Opener-Policy', options.crossOriginOpenerPolicy || 'same-origin')
  }

  if (options.crossOriginEmbedderPolicy) {
    c.header('Cross-Origin-Embedder-Policy', options.crossOriginEmbedderPolicy)
  }

  if (options.crossOriginResourcePolicy !== false) {
    c.header('Cross-Origin-Resource-Policy', options.crossOriginResourcePolicy || 'same-origin')
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Combined CSP and security headers options
 */
export interface SecurityMiddlewareOptions extends CSPOptions {
  /**
   * Additional security headers to include
   */
  securityHeaders?: SecurityHeadersOptions | false
}

/**
 * Create CSP middleware for Hono
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { csp, API_CSP_DEFAULTS } from 'postgrest-compat'
 *
 * const app = new Hono()
 *
 * // For API services (strictest, no browser content)
 * app.use('*', csp({
 *   directives: API_CSP_DEFAULTS,
 * }))
 *
 * // For web applications with environment-based config
 * app.use('*', csp({
 *   environment: 'production',
 *   directives: (env) => ({
 *     'default-src': "'self'",
 *     'connect-src': env === 'production'
 *       ? ['https://api.example.com']
 *       : ['http://localhost:3000', 'ws://localhost:3000'],
 *   }),
 * }))
 * ```
 */
export function csp(options: SecurityMiddlewareOptions = {}): MiddlewareHandler {
  const {
    environment = 'production',
    reportOnly = false,
    generateNonce,
    nonceContextKey = 'cspNonce',
    skip,
    securityHeaders = DEFAULT_SECURITY_HEADERS,
  } = options

  // Resolve directives based on environment
  const resolveDirectives = (): CSPDirectives => {
    if (typeof options.directives === 'function') {
      return options.directives(environment)
    }
    if (options.directives) {
      return options.directives
    }
    return API_CSP_DEFAULTS
  }

  return async (c, next) => {
    // Check if should skip
    if (skip) {
      const shouldSkip = await skip(c as HonoContext)
      if (shouldSkip) {
        return next()
      }
    }

    // Generate nonce if configured
    let nonce: string | undefined
    if (generateNonce) {
      nonce = generateNonce()
      c.set(nonceContextKey, nonce)
    }

    // Build CSP header
    const directives = resolveDirectives()
    const cspHeader = buildCSPHeader(directives, nonce)

    // Set CSP header
    const headerName = reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy'
    c.header(headerName, cspHeader)

    // Apply additional security headers
    if (securityHeaders !== false) {
      applySecurityHeaders(c as HonoContext, securityHeaders, environment)
    }

    return next()
  }
}

/**
 * Create security headers middleware (without CSP)
 *
 * Use this if you need security headers but want to configure CSP separately.
 *
 * @example
 * ```typescript
 * import { securityHeaders } from 'postgrest-compat'
 *
 * app.use('*', securityHeaders({
 *   environment: 'production',
 * }))
 * ```
 */
export function securityHeaders(
  options: {
    environment?: CSPEnvironment
    headers?: SecurityHeadersOptions
    skip?: (c: HonoContext) => boolean | Promise<boolean>
  } = {}
): MiddlewareHandler {
  const {
    environment = 'production',
    headers = DEFAULT_SECURITY_HEADERS,
    skip,
  } = options

  return async (c, next) => {
    if (skip) {
      const shouldSkip = await skip(c as HonoContext)
      if (shouldSkip) {
        return next()
      }
    }

    applySecurityHeaders(c as HonoContext, headers, environment)
    return next()
  }
}

/**
 * Generate a cryptographically secure nonce
 */
export function generateSecureNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
}

/**
 * Preset configurations for common use cases
 */
export const CSP_PRESETS = {
  /**
   * API service preset - strictest possible CSP
   * Use for JSON APIs that don't serve HTML
   */
  api: {
    directives: API_CSP_DEFAULTS,
    securityHeaders: DEFAULT_SECURITY_HEADERS,
  },

  /**
   * Web application preset - strict but usable
   * Use for web applications serving HTML
   */
  web: {
    directives: STRICT_WEB_CSP,
    securityHeaders: DEFAULT_SECURITY_HEADERS,
  },

  /**
   * Development preset - permissive for local development
   */
  development: {
    directives: DEVELOPMENT_CSP,
    securityHeaders: {
      ...DEFAULT_SECURITY_HEADERS,
      strictTransportSecurity: false,
    },
  },
} as const
