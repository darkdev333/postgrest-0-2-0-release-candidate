import { describe, expect, it, vi } from 'vitest'
import { createPostgRESTRouter, type SQLExecutor } from '../public-router.js'
import { buildContentRange, setResponseHeaders } from '../headers.js'

interface MockOptions {
  rows?: Record<string, unknown>[]
  error?: Error & { code?: string; detail?: string; hint?: string }
}

function createSqlMock(options: MockOptions = {}): SQLExecutor & { statements: string[] } {
  const statements: string[] = []
  const fn = vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO',
            column_default: null, character_maximum_length: null, numeric_precision: 32,
            numeric_scale: 0, is_primary_key: true, is_unique: true,
          },
          {
            table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES',
            column_default: null, character_maximum_length: null, numeric_precision: null,
            numeric_scale: null, is_primary_key: false, is_unique: false,
          },
        ],
      }
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] }
    statements.push(sql)
    if (options.error) throw options.error
    return { rows: options.rows ?? [{ id: 1, name: 'Alice' }] }
  }) as unknown as SQLExecutor & { statements: string[] }
  fn.statements = statements
  return fn
}

describe('PostgREST wire compatibility', () => {
  it('uses canonical Content-Range syntax plus Range-Unit', () => {
    expect(buildContentRange({ offset: 0, rowCount: 25, totalCount: 100 })).toBe('0-24/100')
    expect(buildContentRange({ rowCount: 0, totalCount: 0 })).toBe('*/0')

    const headers = new Headers()
    setResponseHeaders(headers, { offset: 10, rowCount: 2 })
    expect(headers.get('content-range')).toBe('10-11/*')
    expect(headers.get('range-unit')).toBe('items')
  })

  it('returns a bare object for application/vnd.pgrst.object+json', async () => {
    const sql = createSqlMock({ rows: [{ id: 1, name: 'Alice' }] })
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/users?id=eq.1', {
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1, name: 'Alice' })
    expect(res.headers.get('content-type')).toContain('application/vnd.pgrst.object+json')
  })

  it('returns PGRST116 when singular selection has the wrong cardinality', async () => {
    const sql = createSqlMock({ rows: [] })
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/users?id=eq.999', {
      headers: { Accept: 'application/vnd.pgrst.object' },
    })

    expect(res.status).toBe(406)
    expect(await res.json()).toEqual({
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      hint: null,
      message: 'Cannot coerce the result to a single JSON object',
    })
  })

  it('keeps default mutation representations plural even for a single input object', async () => {
    const sql = createSqlMock({ rows: [{ id: 7, name: 'Ada' }] })
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ name: 'Ada' }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual([{ id: 7, name: 'Ada' }])
  })

  it('permits unfiltered PATCH and DELETE like upstream PostgREST', async () => {
    const patchSql = createSqlMock({ rows: [] })
    const patchApp = createPostgRESTRouter(patchSql, { cors: false })
    const patch = await patchApp.request('/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'all' }),
    })
    expect(patch.status).toBe(204)
    expect(patchSql.statements.some(sql => /^UPDATE /i.test(sql))).toBe(true)

    const deleteSql = createSqlMock({ rows: [] })
    const deleteApp = createPostgRESTRouter(deleteSql, { cors: false })
    const del = await deleteApp.request('/users', { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect(deleteSql.statements.some(sql => /^DELETE /i.test(sql))).toBe(true)
  })

  it('preserves PostgreSQL code, details and hint in the PostgREST error body', async () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint "users_pkey"'), {
      code: '23505',
      detail: 'Key (id)=(1) already exists.',
      hint: 'Choose another id.',
    })
    const sql = createSqlMock({ error })
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/users')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_pkey"',
      details: 'Key (id)=(1) already exists.',
      hint: 'Choose another id.',
    })
  })

  it('omits Content-Type for minimal mutation responses', async () => {
    const sql = createSqlMock({ rows: [] })
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name: 'Nobody' }),
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('content-type')).toBeNull()
    expect(res.headers.get('preference-applied')).toContain('return=minimal')
  })
})
