/**
 * Comprehensive CORS Support Tests (RED phase TDD)
 *
 * Issue: postgres-e5pc.1
 *
 * Tests cover:
 * - Origin validation (single, multiple, wildcard, dynamic)
 * - Preflight OPTIONS request handling
 * - Allowed methods and headers configuration
 * - Credentials support (Access-Control-Allow-Credentials)
 * - Vary header for caching correctness
 * - Max-Age for preflight caching
 * - Edge cases and security scenarios
 *
 * These tests should FAIL because the features are not fully implemented yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createPostgRESTRouter, type SQLExecutor } from '../router.js'
import { setCORSHeaders, type CORSOptions } from '../headers.js'

// Mock SQL executor
const createMockSql = (): SQLExecutor => {
  return vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true, is_unique: true },
          { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'NO', is_primary_key: false, is_unique: true },
          { table_name: 'posts', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true, is_unique: true },
          { table_name: 'posts', column_name: 'title', data_type: 'text', is_nullable: 'NO', is_primary_key: false, is_unique: false },
        ],
      }
    }
    if (sql.includes('information_schema')) {
      return { rows: [] }
    }
    return { rows: [{ id: 1, name: 'Test' }] }
  })
}

describe('CORS Support (postgres-e5pc.1)', () => {
  let mockSql: SQLExecutor

  beforeEach(() => {
    mockSql = createMockSql()
  })

  describe('Origin Validation', () => {
    it('should allow request from a single configured origin', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    })

    it('should reject request from an origin not in the allowed list', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://evil.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should dynamically match the request origin against multiple allowed origins', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com', 'https://admin.example.com', 'https://docs.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res1 = await app.request('/api/users', {
        headers: { Origin: 'https://admin.example.com' },
      })
      expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.example.com')

      const res2 = await app.request('/api/users', {
        headers: { Origin: 'https://docs.example.com' },
      })
      expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://docs.example.com')
    })

    it('should allow wildcard origin only when explicitly configured as "*"', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://any-site.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('should NOT set Access-Control-Allow-Origin when cors is true but no origins configured', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        // No corsOrigins specified - restrictive default
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://unknown.com' },
      })

      // Secure default: no origin header
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should not set CORS headers when cors is false', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: false,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull()
    })

    it('should validate origin with port numbers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['http://localhost:3000', 'http://localhost:5173'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'http://localhost:3000' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')

      const res2 = await app.request('/api/users', {
        headers: { Origin: 'http://localhost:4000' },
      })
      expect(res2.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should handle origin validation with subdomains', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      // Subdomain should NOT match unless explicitly listed
      const res = await app.request('/api/users', {
        headers: { Origin: 'https://sub.app.example.com' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should support regex-based origin patterns for subdomain matching', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: /^https:\/\/.*\.example\.com$/,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://any-subdomain.example.com' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://any-subdomain.example.com')
    })

    it('should reject requests with no Origin header gracefully', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      // Requests without Origin header (same-origin or non-browser)
      const res = await app.request('/api/users')

      // Should still return data, just without CORS headers
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should prevent origin spoofing by not reflecting arbitrary origins', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      // Even if the attacker sends the request with a forged origin,
      // the server should only reflect allowed origins
      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com.evil.com' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })

  describe('Preflight OPTIONS Handling', () => {
    it('should respond with 204 No Content for OPTIONS preflight', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.status).toBe(204)
    })

    it('should include allowed origin in preflight response', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    })

    it('should reject preflight from non-allowed origin', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious.com',
          'Access-Control-Request-Method': 'DELETE',
        },
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should include Access-Control-Max-Age in preflight response', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
        corsMaxAge: 86400, // 24 hours
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    it('should handle preflight with Access-Control-Request-Headers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization, Prefer',
        },
      })

      const allowedHeaders = res.headers.get('Access-Control-Allow-Headers')
      expect(allowedHeaders).toContain('Content-Type')
      expect(allowedHeaders).toContain('Authorization')
      expect(allowedHeaders).toContain('Prefer')
    })

    it('should respond to preflight for all table routes', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      // Different paths should all respond to OPTIONS
      const paths = ['/api/users', '/api/posts', '/api/rpc/my_function']
      for (const path of paths) {
        const res = await app.request(path, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://app.example.com',
            'Access-Control-Request-Method': 'GET',
          },
        })
        expect(res.status).toBe(204)
      }
    })

    it('should not execute SQL queries for OPTIONS requests', async () => {
      const sqlFn = vi.fn().mockResolvedValue({ rows: [] })
      const router = createPostgRESTRouter(sqlFn, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      // SQL should not be called for preflight
      expect(sqlFn).not.toHaveBeenCalled()
    })
  })

  describe('Allowed Methods', () => {
    it('should include all standard PostgREST methods in Allow-Methods', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      const methods = res.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PATCH')
      expect(methods).toContain('PUT')
      expect(methods).toContain('DELETE')
      expect(methods).toContain('OPTIONS')
    })

    it('should include HEAD in allowed methods', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'HEAD',
        },
      })

      const methods = res.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('HEAD')
    })

    it('should support configuring custom allowed methods', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
        corsMethods: ['GET', 'POST', 'OPTIONS'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const methods = res.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).not.toContain('DELETE')
      expect(methods).not.toContain('PATCH')
    })
  })

  describe('Allowed Headers', () => {
    it('should expose PostgREST-specific request headers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
      expect(allowHeaders).toContain('Authorization')
      expect(allowHeaders).toContain('Content-Type')
      expect(allowHeaders).toContain('Prefer')
      expect(allowHeaders).toContain('Range')
      expect(allowHeaders).toContain('Accept-Profile')
      expect(allowHeaders).toContain('Content-Profile')
    })

    it('should expose PostgREST-specific response headers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      const exposeHeaders = res.headers.get('Access-Control-Expose-Headers')
      expect(exposeHeaders).toContain('Content-Range')
      expect(exposeHeaders).toContain('Location')
      expect(exposeHeaders).toContain('Preference-Applied')
      expect(exposeHeaders).toContain('Content-Profile')
    })

    it('should support configuring additional allowed headers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
        corsAllowHeaders: ['X-Custom-Header', 'X-Request-ID'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'X-Custom-Header',
        },
      })

      const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
      expect(allowHeaders).toContain('X-Custom-Header')
      expect(allowHeaders).toContain('X-Request-ID')
      // Should also still contain standard headers
      expect(allowHeaders).toContain('Authorization')
    })

    it('should support configuring additional exposed headers', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
        corsExposeHeaders: ['X-Total-Count', 'X-Request-ID'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      const exposeHeaders = res.headers.get('Access-Control-Expose-Headers')
      expect(exposeHeaders).toContain('X-Total-Count')
      expect(exposeHeaders).toContain('X-Request-ID')
      // Should also still contain standard exposed headers
      expect(exposeHeaders).toContain('Content-Range')
    })
  })

  describe('Credentials Support', () => {
    it('should set Access-Control-Allow-Credentials when corsCredentials is true', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
        corsCredentials: true,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })

    it('should NOT set credentials with wildcard origin (CORS spec violation)', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
        corsCredentials: true,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      // Per CORS spec: credentials cannot be used with wildcard
      expect(res.headers.get('Access-Control-Allow-Credentials')).not.toBe('true')
    })

    it('should set credentials in preflight response', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
        corsCredentials: true,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })

    it('should not set credentials when corsCredentials is false', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
        corsCredentials: false,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    })

    it('should not set credentials when corsCredentials is not specified', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    })

    it('should reflect specific origin (not wildcard) when credentials are enabled with multiple origins', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
        corsCredentials: true,
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      // With credentials, must reflect exact origin, not wildcard
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
      expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })
  })

  describe('Vary Header', () => {
    it('should set Vary: Origin when using dynamic origin checking', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.headers.get('Vary')).toContain('Origin')
    })

    it('should NOT set Vary: Origin when using wildcard origin', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: '*',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      // Wildcard doesn't need Vary since response is same for all origins
      const vary = res.headers.get('Vary')
      expect(vary === null || !vary.includes('Origin')).toBe(true)
    })

    it('should NOT set Vary: Origin when using single static origin', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'https://app.example.com' },
      })

      // Single origin doesn't need Vary since response is always the same
      const vary = res.headers.get('Vary')
      expect(vary === null || !vary.includes('Origin')).toBe(true)
    })
  })

  describe('CORS on All HTTP Methods', () => {
    const methods: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [
      { method: 'GET', path: '/api/users' },
      { method: 'POST', path: '/api/users', body: { name: 'Test' } },
      { method: 'PATCH', path: '/api/users?id=eq.1', body: { name: 'Updated' } },
      { method: 'DELETE', path: '/api/users?id=eq.1' },
    ]

    for (const { method, path, body } of methods) {
      it(`should include CORS headers in ${method} responses`, async () => {
        const router = createPostgRESTRouter(mockSql, {
          cors: true,
          corsOrigins: 'https://app.example.com',
        })
        const app = new Hono()
        app.route('/api', router)

        const init: RequestInit = {
          method,
          headers: {
            Origin: 'https://app.example.com',
            'Content-Type': 'application/json',
          },
        }
        if (body) {
          init.body = JSON.stringify(body)
        }

        const res = await app.request(`http://localhost${path}`, init)

        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
      })
    }
  })

  describe('setCORSHeaders unit tests', () => {
    it('should not set any origin header when called with no options', () => {
      const headers = new Headers()
      setCORSHeaders(headers)
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should set specific origin', () => {
      const headers = new Headers()
      setCORSHeaders(headers, { origin: 'https://example.com' })
      expect(headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })

    it('should set wildcard origin', () => {
      const headers = new Headers()
      setCORSHeaders(headers, { origin: '*' })
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('should match request origin against allowed list', () => {
      const headers = new Headers()
      setCORSHeaders(headers, {
        allowedOrigins: ['https://a.com', 'https://b.com'],
        requestOrigin: 'https://b.com',
      })
      expect(headers.get('Access-Control-Allow-Origin')).toBe('https://b.com')
    })

    it('should not set origin when request origin is not in allowed list', () => {
      const headers = new Headers()
      setCORSHeaders(headers, {
        allowedOrigins: ['https://a.com'],
        requestOrigin: 'https://evil.com',
      })
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should set Vary: Origin for dynamic origin checking', () => {
      const headers = new Headers()
      setCORSHeaders(headers, {
        allowedOrigins: ['https://a.com', 'https://b.com'],
        requestOrigin: 'https://a.com',
      })
      expect(headers.get('Vary')).toContain('Origin')
    })

    it('should set credentials header when credentials is true and origin is specific', () => {
      const headers = new Headers()
      setCORSHeaders(headers, {
        origin: 'https://example.com',
        credentials: true,
      })
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })

    it('should NOT set credentials header when origin is wildcard', () => {
      const headers = new Headers()
      setCORSHeaders(headers, {
        origin: '*',
        credentials: true,
      })
      expect(headers.get('Access-Control-Allow-Credentials')).not.toBe('true')
    })

    it('should set allowed methods header', () => {
      const headers = new Headers()
      setCORSHeaders(headers, { origin: '*' })
      const methods = headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PATCH')
      expect(methods).toContain('DELETE')
      expect(methods).toContain('OPTIONS')
    })

    it('should set allowed headers', () => {
      const headers = new Headers()
      setCORSHeaders(headers, { origin: '*' })
      const allowHeaders = headers.get('Access-Control-Allow-Headers')
      expect(allowHeaders).toContain('Authorization')
      expect(allowHeaders).toContain('Content-Type')
      expect(allowHeaders).toContain('Prefer')
      expect(allowHeaders).toContain('Range')
    })

    it('should set exposed headers', () => {
      const headers = new Headers()
      setCORSHeaders(headers, { origin: '*' })
      const exposeHeaders = headers.get('Access-Control-Expose-Headers')
      expect(exposeHeaders).toContain('Content-Range')
      expect(exposeHeaders).toContain('Location')
      expect(exposeHeaders).toContain('Preference-Applied')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null/undefined Origin header', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      // No Origin header at all
      const res = await app.request('/api/users')
      expect(res.status).toBe(200)
    })

    it('should handle empty string Origin header', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: '' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should handle malformed Origin header (not a valid URL)', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://app.example.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const res = await app.request('/api/users', {
        headers: { Origin: 'not-a-url' },
      })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should handle concurrent requests from different origins', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: ['https://a.com', 'https://b.com'],
      })
      const app = new Hono()
      app.route('/api', router)

      const [resA, resB] = await Promise.all([
        app.request('/api/users', { headers: { Origin: 'https://a.com' } }),
        app.request('/api/users', { headers: { Origin: 'https://b.com' } }),
      ])

      expect(resA.headers.get('Access-Control-Allow-Origin')).toBe('https://a.com')
      expect(resB.headers.get('Access-Control-Allow-Origin')).toBe('https://b.com')
    })

    it('should apply CORS headers to error responses', async () => {
      const router = createPostgRESTRouter(mockSql, {
        cors: true,
        corsOrigins: 'https://app.example.com',
        // Force an application validation error. Hyphens are valid in quoted
        // PostgreSQL identifiers and must not be rejected by the default.
        validateTable: (name) => !name.includes('-'),
      })
      const app = new Hono()
      app.route('/api', router)

      // Validation errors should still receive CORS headers.
      const res = await app.request('/api/invalid-table-name', {
        headers: { Origin: 'https://app.example.com' },
      })

      expect(res.status).toBe(400)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    })
  })
})
