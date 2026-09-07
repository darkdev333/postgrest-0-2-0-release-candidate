import { describe, expect, it, vi } from 'vitest'
import { createPostgRESTRouter } from '../public-router.js'
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from '../executor.js'
import type { PostgRESTTelemetryEvent } from '../telemetry.js'

function sqlMock(): SQLExecutor {
  return vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true }] }
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] }
    return { rows: [{ id: 1 }] }
  }) as unknown as SQLExecutor
}

describe('public observability hook', () => {
  it('emits request, SQL and response events while redacting authorization by default', async () => {
    const events: PostgRESTTelemetryEvent[] = []
    const app = createPostgRESTRouter(sqlMock(), {
      cors: false,
      observer: event => events.push(event),
      observerOptions: { includeHeaders: true },
    })

    const res = await app.request('/users?id=eq.1', {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(res.status).toBe(200)

    const received = events.find(event => event.type === 'request.received')
    expect(received?.type).toBe('request.received')
    if (received?.type === 'request.received') expect(received.headers?.authorization).toBe('[REDACTED]')
    expect(events.some(event => event.type === 'request.parsed')).toBe(true)
    expect(events.some(event => event.type === 'sql.generated')).toBe(true)
    expect(events.some(event => event.type === 'sql.execute.start')).toBe(true)
    expect(events.some(event => event.type === 'sql.execute.end')).toBe(true)
    expect(events.some(event => event.type === 'response.created' && event.status === 200)).toBe(true)
    const generated = events.find(event => event.type === 'sql.generated')
    if (generated?.type === 'sql.generated') expect(generated.params).toBeUndefined()
  })

  it('can opt in to bound parameter visibility and never lets observer failures affect requests', async () => {
    const events: PostgRESTTelemetryEvent[] = []
    const app = createPostgRESTRouter(sqlMock(), {
      cors: false,
      observerOptions: { includeParams: true },
      observer(event) {
        events.push(event)
        if (event.type === 'request.received') throw new Error('observer failure')
      },
    })

    const res = await app.request('/users?id=eq.42')
    expect(res.status).toBe(200)
    const generated = events.find(event => event.type === 'sql.generated' && event.params?.includes(42))
    expect(generated?.type).toBe('sql.generated')
    expect(events.some(event => event.type === 'response.created')).toBe(true)
  })

  it('exposes schema/role context without leaking JWT settings unless explicitly requested', async () => {
    const events: PostgRESTTelemetryEvent[] = []
    const sql = sqlMock()
    sql.transaction = async <T>(callback: (execute: SQLStatementExecutor) => Promise<T>, _context?: SQLTransactionContext): Promise<T> =>
      callback(async () => ({ rows: [{ id: 1 }] }))
    const app = createPostgRESTRouter(sql, {
      cors: false,
      observer: event => events.push(event),
      observerOptions: { includeSettings: true },
      transactionContext: (_request, schema) => ({
        schema,
        role: 'authenticated',
        settings: {
          'request.jwt.claims': '{"sub":"secret-user"}',
          'app.trace_id': 'trace-123',
        },
      }),
    })

    const res = await app.request('/users?id=eq.1')
    expect(res.status).toBe(200)
    const generated = events.find(event => event.type === 'sql.generated' && event.context?.role === 'authenticated')
    expect(generated?.type).toBe('sql.generated')
    if (generated?.type === 'sql.generated') {
      expect(generated.context?.schema).toBe('public')
      expect(generated.context?.settings?.['request.jwt.claims']).toBe('[REDACTED]')
      expect(generated.context?.settings?.['app.trace_id']).toBe('trace-123')
    }
  })
})
