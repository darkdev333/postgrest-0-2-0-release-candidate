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
import type { MiddlewareHandler } from 'hono';
/**
 * CSP directive values
 */
export type CSPDirectiveValue = string | string[] | boolean;
/**
 * CSP directives configuration
 */
export interface CSPDirectives {
    /** Fallback for other fetch directives */
    'default-src'?: CSPDirectiveValue;
    /** Valid sources for JavaScript */
    'script-src'?: CSPDirectiveValue;
    /** Valid sources for stylesheets */
    'style-src'?: CSPDirectiveValue;
    /** Valid sources for fetch, XHR, WebSockets, EventSource */
    'connect-src'?: CSPDirectiveValue;
    /** Valid sources for images */
    'img-src'?: CSPDirectiveValue;
    /** Valid sources for fonts */
    'font-src'?: CSPDirectiveValue;
    /** Valid sources for media (audio, video) */
    'media-src'?: CSPDirectiveValue;
    /** Valid sources for <object>, <embed>, <applet> */
    'object-src'?: CSPDirectiveValue;
    /** Valid sources for nested browsing contexts (frames) */
    'frame-src'?: CSPDirectiveValue;
    /** Valid sources for workers and nested browsing contexts */
    'child-src'?: CSPDirectiveValue;
    /** Valid sources for web workers */
    'worker-src'?: CSPDirectiveValue;
    /** Valid parents that can embed this page in <frame>, <iframe>, etc. */
    'frame-ancestors'?: CSPDirectiveValue;
    /** Valid sources for form submissions */
    'form-action'?: CSPDirectiveValue;
    /** Valid sources for <base> element */
    'base-uri'?: CSPDirectiveValue;
    /** Valid sources for manifest files */
    'manifest-src'?: CSPDirectiveValue;
    /** Restricts URLs that can be loaded using script interfaces */
    'navigate-to'?: CSPDirectiveValue;
    /** URI to report CSP violations */
    'report-uri'?: CSPDirectiveValue;
    /** Reporting API endpoint name */
    'report-to'?: CSPDirectiveValue;
    /** Require trusted types for DOM XSS sinks */
    'require-trusted-types-for'?: CSPDirectiveValue;
    /** Trusted types policy names */
    'trusted-types'?: CSPDirectiveValue;
    /** Block all mixed content */
    'block-all-mixed-content'?: boolean;
    /** Upgrade insecure requests to HTTPS */
    'upgrade-insecure-requests'?: boolean;
    /** Sandbox restrictions */
    'sandbox'?: CSPDirectiveValue;
}
/**
 * Environment type for CSP configuration
 */
export type CSPEnvironment = 'development' | 'staging' | 'production';
/**
 * CSP middleware options
 */
export interface CSPOptions {
    /**
     * CSP directives to apply
     * Can be a static object or a function that returns directives based on environment
     */
    directives?: CSPDirectives | ((env: CSPEnvironment) => CSPDirectives);
    /**
     * Environment to use for configuration
     * Defaults to 'production'
     */
    environment?: CSPEnvironment;
    /**
     * Use Content-Security-Policy-Report-Only header instead of enforcing
     * Useful for testing CSP changes before deployment
     * @default false
     */
    reportOnly?: boolean;
    /**
     * Custom nonce generator for script/style nonces
     * If provided, adds nonces to script-src and style-src
     */
    generateNonce?: () => string;
    /**
     * Context key to store the nonce in (for use in templates)
     * @default 'cspNonce'
     */
    nonceContextKey?: string;
    /**
     * Whether to skip CSP for certain requests
     */
    skip?: (c: HonoContext) => boolean | Promise<boolean>;
}
/**
 * Hono context interface (minimal)
 */
interface HonoContext {
    req: {
        header(name: string): string | undefined;
        path: string;
        method: string;
    };
    header(name: string, value: string): void;
    set(key: string, value: unknown): void;
    get(key: string): unknown;
}
/**
 * Default CSP directives for API services (no browser rendering)
 * Very strict - blocks almost everything since APIs don't serve HTML
 */
export declare const API_CSP_DEFAULTS: CSPDirectives;
/**
 * Strict CSP directives for production web applications
 */
export declare const STRICT_WEB_CSP: CSPDirectives;
/**
 * Development-friendly CSP (more permissive)
 */
export declare const DEVELOPMENT_CSP: CSPDirectives;
/**
 * Get default CSP directives based on environment
 */
export declare function getDefaultDirectives(environment: CSPEnvironment): CSPDirectives;
/**
 * Build a CSP header string from directives
 */
export declare function buildCSPHeader(directives: CSPDirectives, nonce?: string): string;
/**
 * Additional security headers configuration
 */
export interface SecurityHeadersOptions {
    /**
     * X-Content-Type-Options header
     * @default 'nosniff'
     */
    contentTypeOptions?: string | false;
    /**
     * X-Frame-Options header (legacy, use frame-ancestors CSP instead)
     * @default 'DENY'
     */
    frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
    /**
     * X-XSS-Protection header (legacy, modern browsers use CSP)
     * @default '0' (disabled, as it can cause issues)
     */
    xssProtection?: string | false;
    /**
     * Referrer-Policy header
     * @default 'strict-origin-when-cross-origin'
     */
    referrerPolicy?: string | false;
    /**
     * Strict-Transport-Security header
     * @default 'max-age=31536000; includeSubDomains' in production
     */
    strictTransportSecurity?: string | false;
    /**
     * Permissions-Policy header (replaces Feature-Policy)
     */
    permissionsPolicy?: string | false;
    /**
     * Cross-Origin-Opener-Policy header
     * @default 'same-origin'
     */
    crossOriginOpenerPolicy?: string | false;
    /**
     * Cross-Origin-Embedder-Policy header
     */
    crossOriginEmbedderPolicy?: string | false;
    /**
     * Cross-Origin-Resource-Policy header
     * @default 'same-origin'
     */
    crossOriginResourcePolicy?: string | false;
}
/**
 * Default security headers for production
 */
export declare const DEFAULT_SECURITY_HEADERS: SecurityHeadersOptions;
/**
 * Combined CSP and security headers options
 */
export interface SecurityMiddlewareOptions extends CSPOptions {
    /**
     * Additional security headers to include
     */
    securityHeaders?: SecurityHeadersOptions | false;
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
export declare function csp(options?: SecurityMiddlewareOptions): MiddlewareHandler;
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
export declare function securityHeaders(options?: {
    environment?: CSPEnvironment;
    headers?: SecurityHeadersOptions;
    skip?: (c: HonoContext) => boolean | Promise<boolean>;
}): MiddlewareHandler;
/**
 * Generate a cryptographically secure nonce
 */
export declare function generateSecureNonce(): string;
/**
 * Preset configurations for common use cases
 */
export declare const CSP_PRESETS: {
    /**
     * API service preset - strictest possible CSP
     * Use for JSON APIs that don't serve HTML
     */
    readonly api: {
        readonly directives: CSPDirectives;
        readonly securityHeaders: SecurityHeadersOptions;
    };
    /**
     * Web application preset - strict but usable
     * Use for web applications serving HTML
     */
    readonly web: {
        readonly directives: CSPDirectives;
        readonly securityHeaders: SecurityHeadersOptions;
    };
    /**
     * Development preset - permissive for local development
     */
    readonly development: {
        readonly directives: CSPDirectives;
        readonly securityHeaders: {
            readonly strictTransportSecurity: false;
            readonly contentTypeOptions?: string | false | undefined;
            readonly frameOptions?: false | "DENY" | "SAMEORIGIN" | undefined;
            readonly xssProtection?: string | false | undefined;
            readonly referrerPolicy?: string | false | undefined;
            readonly permissionsPolicy?: string | false | undefined;
            readonly crossOriginOpenerPolicy?: string | false | undefined;
            readonly crossOriginEmbedderPolicy?: string | false | undefined;
            readonly crossOriginResourcePolicy?: string | false | undefined;
        };
    };
};
export {};
//# sourceMappingURL=security.d.ts.map