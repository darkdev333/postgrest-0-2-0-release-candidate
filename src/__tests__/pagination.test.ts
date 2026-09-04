import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createPostgRESTRouter, type SQLExecutor } from '../router.js'
import { buildContentRange, parsePreferHeader, parseRangeHeader, setResponseHeaders } from '../headers.js'
import { QueryBuilder } from '../builder.js'
import type { ParsedQuery } from '../parser.js'

function paginationSql(totalRows = 100): SQLExecutor & { captured: string[] } {
  const captured: string[] = []
  const fn = vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [
        { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true },
        { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null, character_maximum_length: null, numeric_precision: null, numeric_scale: null, is_primary_key: false, is_unique: false },
      ] }
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] }
    captured.push(sql)
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ count: String(totalRows) }] }
    const limit = Number(sql.match(/LIMIT\s+(\d+)/i)?.[1] ?? 25)
    const offset = Number(sql.match(/OFFSET\s+(\d+)/i)?.[1] ?? 0)
    const count = Math.min(limit, Math.max(0, totalRows - offset))
    return { rows: Array.from({ length: count }, (_, i) => ({ id: offset + i + 1, name: `User ${offset + i + 1}` })) }
  }) as unknown as SQLExecutor & { captured: string[] }
  fn.captured = captured
  return fn
}

function appFor(totalRows = 100, options: Parameters<typeof createPostgRESTRouter>[1] = {}) {
  const sql = paginationSql(totalRows)
  const router = createPostgRESTRouter(sql, { cors: false, defaultLimit: 25, maxLimit: 100, ...options })
  const app = new Hono()
  app.route('/api', router)
  return { app, sql }
}

describe('pagination and count compatibility', () => {
  describe('Range parsing', () => {
    it('accepts PostgREST item ranges', () => {
      expect(parseRangeHeader('items=0-24')).toEqual({ offset: 0, limit: 25 })
      expect(parseRangeHeader('items=25-49')).toEqual({ offset: 25, limit: 25 })
      expect(parseRangeHeader('0-0')).toEqual({ offset: 0, limit: 1 })
    })

    it('rejects malformed and reversed ranges', () => {
      expect(parseRangeHeader(null)).toBeNull()
      expect(parseRangeHeader('bytes=0-24')).toBeNull()
      expect(parseRangeHeader('items=50-25')).toBeNull()
      expect(parseRangeHeader('items=0-')).toBeNull()
    })
  })

  describe('Content-Range', () => {
    it('uses a separate Range-Unit header', () => {
      expect(buildContentRange({ offset: 0, rowCount: 25, totalCount: 100 })).toBe('0-24/100')
      expect(buildContentRange({ offset: 50, rowCount: 25, totalCount: 100 })).toBe('50-74/100')
      expect(buildContentRange({ offset: 0, rowCount: 25 })).toBe('0-24/*')
      expect(buildContentRange({ rowCount: 0, totalCount: 0 })).toBe('*/0')
      expect(buildContentRange({ rowCount: 0 })).toBe('*/*')

      const headers = new Headers()
      setResponseHeaders(headers, { offset: 10, rowCount: 2, totalCount: 12 })
      expect(headers.get('content-range')).toBe('10-11/12')
      expect(headers.get('range-unit')).toBe('items')
    })
  })

  describe('Prefer count parsing', () => {
    it.each(['exact', 'planned', 'estimated', 'none'] as const)('parses count=%s', count => {
      expect(parsePreferHeader(`count=${count}`).count).toBe(count)
    })

    it('combines return and count preferences', () => {
      expect(parsePreferHeader('return=representation, count=exact')).toMatchObject({ return: 'representation', count: 'exact' })
    })
  })

  describe('QueryBuilder limit/offset', () => {
    const base: ParsedQuery = { columns: '*', embedded: [], filters: [], order: [] }

    it('applies defaultLimit', () => {
      const built = new QueryBuilder({ defaultLimit: 25, maxLimit: 100 }).buildSelect('users', base)
      expect(built.sql).toContain('LIMIT 25')
    })

    it('applies explicit limit and offset', () => {
      const built = new QueryBuilder({ defaultLimit: 25, maxLimit: 100 }).buildSelect('users', { ...base, limit: 10, offset: 20 })
      expect(built.sql).toContain('LIMIT 10')
      expect(built.sql).toContain('OFFSET 20')
    })

    it('caps limit at maxLimit', () => {
      const built = new QueryBuilder({ defaultLimit: 25, maxLimit: 100 }).buildSelect('users', { ...base, limit: 5000 })
      expect(built.sql).toContain('LIMIT 100')
    })

    it('builds a filtered count query without limit/offset', () => {
      const built = new QueryBuilder({ defaultLimit: 25 }).buildSelect('users', {
        ...base,
        filters: [{ column: 'id', operator: 'gt', value: '10' }],
        limit: 5,
        offset: 20,
        count: 'exact',
      })
      expect(built.countSql).toContain('COUNT(*)')
      expect(built.countSql).toContain('WHERE')
      expect(built.countSql).not.toContain('LIMIT')
      expect(built.countSql).not.toContain('OFFSET')
    })
  })

  describe('HTTP integration', () => {
    it('applies query limit/offset and emits canonical Content-Range', async () => {
      const { app, sql } = appFor(100)
      const res = await app.request('http://local/api/users?limit=10&offset=20', { headers: { Prefer: 'count=exact' } })
      // Upstream RangeSpec: a known total proving 20-29 is a partial representation is HTTP 206.
      expect(res.status).toBe(206)
      expect((await res.json()) as unknown[]).toHaveLength(10)
      expect(res.headers.get('content-range')).toBe('20-29/100')
      expect(res.headers.get('range-unit')).toBe('items')
      expect(res.headers.get('preference-applied')).toContain('count=exact')
      expect(sql.captured.some(q => q.includes('LIMIT 10') && q.includes('OFFSET 20'))).toBe(true)
      expect(sql.captured.some(q => /COUNT\(\*\)/i.test(q))).toBe(true)
    })

    it('lets Range override limit/offset query parameters', async () => {
      const { app, sql } = appFor(100)
      const res = await app.request('http://local/api/users?limit=5&offset=0', {
        headers: { Range: 'items=50-74', Prefer: 'count=exact' },
      })
      expect(res.headers.get('content-range')).toBe('50-74/100')
      expect(sql.captured.some(q => q.includes('LIMIT 25') && q.includes('OFFSET 50'))).toBe(true)
    })

    it('uses an unknown denominator when count is not requested', async () => {
      const { app, sql } = appFor(100)
      const res = await app.request('http://local/api/users?limit=10')
      expect(res.headers.get('content-range')).toBe('0-9/*')
      expect(sql.captured.some(q => /COUNT\(\*\)/i.test(q))).toBe(false)
    })

    it('returns */0 for empty exact-count results', async () => {
      const { app } = appFor(0)
      const res = await app.request('http://local/api/users?limit=10', { headers: { Prefer: 'count=exact' } })
      expect(await res.json()).toEqual([])
      expect(res.headers.get('content-range')).toBe('*/0')
    })

    it('uses the configured default limit', async () => {
      const { app, sql } = appFor(100, { defaultLimit: 7 })
      await app.request('http://local/api/users')
      expect(sql.captured.some(q => q.includes('LIMIT 7'))).toBe(true)
    })
  })
})
