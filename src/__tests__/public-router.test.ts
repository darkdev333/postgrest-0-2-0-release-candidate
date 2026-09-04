import { describe, expect, it, vi } from 'vitest'
import { createPostgRESTRouter, type SQLExecutor } from '../public-router.js'
import { SINGULAR_MEDIA_TYPE } from '../media.js'

function sqlMock(): SQLExecutor {
  return vi.fn(async (statement: string) => {
    if (statement.includes('information_schema.columns')) {
      return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_primary_key: true, is_unique: true }] }
    }
    if (statement.includes('information_schema.table_constraints')) return { rows: [] }
    return { rows: [{ id: 1 }] }
  }) as unknown as SQLExecutor
}

describe('public PostgREST router boundary', () => {
  it('preserves PostgreSQL $N placeholders at the SQLExecutor boundary', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const sql = vi.fn(async (statement: string, params: unknown[] = []) => {
      calls.push({ sql: statement, params })
      if (statement.includes('information_schema.columns')) {
        return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_primary_key: true, is_unique: true }] }
      }
      if (statement.includes('information_schema.table_constraints')) return { rows: [] }
      return { rows: [{ id: 1 }] }
    }) as unknown as SQLExecutor

    const app = createPostgRESTRouter(sql, { cors: false })
    const response = await app.request('http://local/items?id=eq.1')
    expect(response.status).toBe(200)
    const read = calls.find(call => call.params.length === 1 && call.params[0] === 1)
    expect(read?.sql).toContain('= $1')
    expect(read?.sql).not.toContain('= 1')
    expect(read?.params).toEqual([1])
  })

  it('returns the upstream singular media type for successful singular reads', async () => {
    const app = createPostgRESTRouter(sqlMock(), { cors: false })
    const response = await app.request('http://local/items?id=eq.1', {
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(SINGULAR_MEDIA_TYPE)
    expect(await response.json()).toEqual({ id: 1 })
  })

  it('does not relabel PostgREST error responses as singular media', async () => {
    const sql = vi.fn(async (statement: string) => {
      if (statement.includes('information_schema.columns')) {
        return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_primary_key: true, is_unique: true }] }
      }
      if (statement.includes('information_schema.table_constraints')) return { rows: [] }
      return { rows: [] }
    }) as unknown as SQLExecutor
    const app = createPostgRESTRouter(sql, { cors: false })
    const response = await app.request('http://local/items?id=eq.999', {
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    })
    expect(response.status).toBe(406)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
