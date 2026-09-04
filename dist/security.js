// ============================================================================
// Default Configurations
// ============================================================================
/**
 * Default CSP directives for API services (no browser rendering)
 * Very strict - blocks almost everything since APIs don't serve HTML
 */
export const API_CSP_DEFAULTS = {
    'default-src': "'none'",
    'frame-ancestors': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
};
/**
 * Strict CSP directives for production web applications
 */
export const STRICT_WEB_CSP = {
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
};
/**
 * Development-friendly CSP (more permissive)
 */
export const DEVELOPMENT_CSP = {
    'default-src': "'self'",
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
    'font-src': ["'self'", 'data:', 'https:'],
    'connect-src': ["'self'", 'ws:', 'wss:', 'http://localhost:*', 'https://localhost:*'],
    'frame-ancestors': "'self'",
    'base-uri': "'self'",
};
/**
 * Get default CSP directives based on environment
 */
export function getDefaultDirectives(environment) {
    switch (environment) {
        case 'development':
            return { ...DEVELOPMENT_CSP };
        case 'staging':
            return { ...STRICT_WEB_CSP };
        case 'production':
        default:
            return { ...STRICT_WEB_CSP };
    }
}
// ============================================================================
// CSP Builder
// ============================================================================
/**
 * Format a single CSP directive value
 */
function formatDirectiveValue(value) {
    if (typeof value === 'boolean') {
        return '';
    }
    if (Array.isArray(value)) {
        return value.join(' ');
    }
    return value;
}
/**
 * Build a CSP header string from directives
 */
export function buildCSPHeader(directives, nonce) {
    const parts = [];
    for (const [key, value] of Object.entries(directives)) {
        if (value === undefined || value === null) {
            continue;
        }
        // Boolean directives (like upgrade-insecure-requests)
        if (typeof value === 'boolean') {
            if (value) {
                parts.push(key);
            }
            continue;
        }
        // Add nonce to script-src and style-src if provided
        let finalValue = formatDirectiveValue(value);
        if (nonce && (key === 'script-src' || key === 'style-src')) {
            finalValue = `${finalValue} 'nonce-${nonce}'`;
        }
        if (finalValue) {
            parts.push(`${key} ${finalValue}`);
        }
    }
    return parts.join('; ');
}
/**
 * Default security headers for production
 */
export const DEFAULT_SECURITY_HEADERS = {
    contentTypeOptions: 'nosniff',
    frameOptions: 'DENY',
    xssProtection: '0',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
};
/**
 * Apply security headers to response
 */
function applySecurityHeaders(c, options, environment) {
    if (options.contentTypeOptions !== false) {
        c.header('X-Content-Type-Options', options.contentTypeOptions || 'nosniff');
    }
    if (options.frameOptions !== false) {
        c.header('X-Frame-Options', options.frameOptions || 'DENY');
    }
    if (options.xssProtection !== false) {
        c.header('X-XSS-Protection', options.xssProtection || '0');
    }
    if (options.referrerPolicy !== false) {
        c.header('Referrer-Policy', options.referrerPolicy || 'strict-origin-when-cross-origin');
    }
    // Only set HSTS in production/staging (not development with HTTP)
    if (options.strictTransportSecurity !== false && environment !== 'development') {
        c.header('Strict-Transport-Security', options.strictTransportSecurity || 'max-age=31536000; includeSubDomains');
    }
    if (options.permissionsPolicy) {
        c.header('Permissions-Policy', options.permissionsPolicy);
    }
    if (options.crossOriginOpenerPolicy !== false) {
        c.header('Cross-Origin-Opener-Policy', options.crossOriginOpenerPolicy || 'same-origin');
    }
    if (options.crossOriginEmbedderPolicy) {
        c.header('Cross-Origin-Embedder-Policy', options.crossOriginEmbedderPolicy);
    }
    if (options.crossOriginResourcePolicy !== false) {
        c.header('Cross-Origin-Resource-Policy', options.crossOriginResourcePolicy || 'same-origin');
    }
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
export function csp(options = {}) {
    const { environment = 'production', reportOnly = false, generateNonce, nonceContextKey = 'cspNonce', skip, securityHeaders = DEFAULT_SECURITY_HEADERS, } = options;
    // Resolve directives based on environment
    const resolveDirectives = () => {
        if (typeof options.directives === 'function') {
            return options.directives(environment);
        }
        if (options.directives) {
            return options.directives;
        }
        return API_CSP_DEFAULTS;
    };
    return async (c, next) => {
        // Check if should skip
        if (skip) {
            const shouldSkip = await skip(c);
            if (shouldSkip) {
                return next();
            }
        }
        // Generate nonce if configured
        let nonce;
        if (generateNonce) {
            nonce = generateNonce();
            c.set(nonceContextKey, nonce);
        }
        // Build CSP header
        const directives = resolveDirectives();
        const cspHeader = buildCSPHeader(directives, nonce);
        // Set CSP header
        const headerName = reportOnly
            ? 'Content-Security-Policy-Report-Only'
            : 'Content-Security-Policy';
        c.header(headerName, cspHeader);
        // Apply additional security headers
        if (securityHeaders !== false) {
            applySecurityHeaders(c, securityHeaders, environment);
        }
        return next();
    };
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
export function securityHeaders(options = {}) {
    const { environment = 'production', headers = DEFAULT_SECURITY_HEADERS, skip, } = options;
    return async (c, next) => {
        if (skip) {
            const shouldSkip = await skip(c);
            if (shouldSkip) {
                return next();
            }
        }
        applySecurityHeaders(c, headers, environment);
        return next();
    };
}
/**
 * Generate a cryptographically secure nonce
 */
export function generateSecureNonce() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
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
};
//# sourceMappingURL=security.js.map