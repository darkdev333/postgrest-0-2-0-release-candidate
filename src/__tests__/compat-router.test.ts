import { describe, expect, it, vi } from 'vitest'
import { createPostgRESTRouter } from '../compat-router.js'
import type { SQLExecutor } from '../executor.js'

function column(table: string, name: string, pk = false) {
  return { table_name: table, column_name: name, data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: pk, is_unique: pk }
}

function executor(ambiguous = false) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const fn = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes('information_schema.columns')) {
      return { rows: [column('tickets', 'id', true), column('tickets', 'client_id'), column('clients', 'id', true), { ...column('clients', 'name'), data_type: 'text' }] }
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] }
    if (sql.includes('WITH fk_constraints')) {
      const rows = [{ source_schema: 'public', source_table: 'tickets', target_table: 'clients', constraint_name: 'tickets_client_id_fkey', source_columns: ['client_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['id'] }]
      if (ambiguous) rows.push({ source_schema: 'public', source_table: 'tickets', target_table: 'clients', constraint_name: 'tickets_billing_client_id_fkey', source_columns: ['client_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['id'] })
      return { rows }
    }
    if (sql.includes('SELECT COUNT(*) AS count FROM')) return { rows: [{ count: '1' }] }
    if (sql.includes('row_to_json')) return { rows: [{ id: 1, clients: { id: 2, name: 'Acme' } }] }
    return { rows: [{ id: 1 }] }
  }) as unknown as SQLExecutor & { calls: typeof calls }
  fn.calls = calls
  return fn
}

describe('compatibility router embedded migration path', () => {
  it('routes embedded GET through the relationship/read planner with child modifiers', async () => {
    const sql = executor()
    const app = createPostgRESTRouter(sql, { cors: false, defaultLimit: 100 })
    const res = await app.request('/tickets?select=id,clients(id,name)&clients.name=ilike.A*&order=id.desc&limit=5', { headers: { Prefer: 'count=exact' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1, clients: { id: 2, name: 'Acme' } }])
    const read = sql.calls.find(call => call.sql.includes('row_to_json') && !call.sql.includes('COUNT(*)'))
    expect(read?.sql).toContain('row_to_json')
    expect(read?.sql).toContain('"name" ILIKE $1')
    expect(read?.params).toContain('A%')
    expect(res.headers.get('content-range')).toBe('0-0/1')
  })

  it('expands spread star from ordered schema-cache columns before SQL compilation', async () => {
    const sql = executor()
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/tickets?select=client_id,...clients(*)')
    expect(res.status).toBe(200)

    const read = sql.calls.find(call => call.sql.startsWith('SELECT "pgrst_r_0"."client_id"'))
    expect(read?.sql).toMatch(/SELECT "pgrst_r_0"\."client_id", "pgrst_e_\d+"\."id" AS "id", "pgrst_e_\d+"\."name" AS "name"/)
    expect(read?.sql).not.toContain('row_to_json')
  })

  it('orders a root resource by a selected to-one relationship using the lateral alias', async () => {
    const sql = executor()
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/tickets?select=id,clients(name)&order=clients(name).desc.nullsfirst')
    expect(res.status).toBe(200)
    const read = sql.calls.find(call => call.sql.includes('row_to_json'))
    expect(read?.sql).toMatch(/ORDER BY "pgrst_e_\d+"\."name" DESC NULLS FIRST/)
  })

  it('returns upstream PGRST118 when related ordering targets a to-many embed', async () => {
    const app = createPostgRESTRouter(executor(), { cors: false })
    const res = await app.request('/clients?select=id,tickets(id)&order=tickets(id)')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      code: 'PGRST118',
      details: "'clients' and 'tickets' do not form a many-to-one or one-to-one relationship",
      hint: null,
      message: "A related order on 'tickets' is not possible",
    })
  })

  it('returns upstream-style PGRST201/300 rather than choosing the first FK', async () => {
    const app = createPostgRESTRouter(executor(true), { cors: false })
    const res = await app.request('/tickets?select=id,clients(*)')
    expect(res.status).toBe(300)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('PGRST201')
    expect(body.message).toBe("Could not embed because more than one relationship was found for 'tickets' and 'clients'")
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('returns PGRST108 when a modifier targets a relationship name that was aliased', async () => {
    const app = createPostgRESTRouter(executor(), { cors: false })
    const res = await app.request('/tickets?select=id,client:clients(*)&clients.id=eq.2')
    expect(res.status).toBe(400)
    expect((await res.json() as Record<string, unknown>).code).toBe('PGRST108')
  })

  it('delegates flat reads to the established router without relationship catalog work', async () => {
    const sql = executor()
    const app = createPostgRESTRouter(sql, { cors: false })
    const res = await app.request('/tickets?select=id')
    expect(res.status).toBe(200)
    expect(sql.calls.some(call => call.sql.includes('WITH fk_constraints'))).toBe(false)
  })
})
