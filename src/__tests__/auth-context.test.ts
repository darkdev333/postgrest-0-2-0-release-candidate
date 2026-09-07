import { describe, expect, it, vi } from 'vitest'
import { createPostgRESTRouter } from '../public-router.js'
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from '../executor.js'

function executorWithTransactions() {
  const contexts: Array<SQLTransactionContext | undefined> = []
  const direct = vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [
        { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true },
        { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null, character_maximum_length: null, numeric_precision: null, numeric_scale: null, is_primary_key: false, is_unique: false },
        { table_name: 'profiles', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true },
        { table_name: 'profiles', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: false, is_unique: false },
      ] }
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] }
    if (sql.includes('WITH fk_constraints')) return { rows: [{
      source_schema: 'public', source_table: 'profiles', target_schema: 'public', target_table: 'users',
      constraint_name: 'profiles_user_id_fkey', source_columns: ['user_id'], target_columns: ['id'],
      source_unique: false, source_primary_key: ['id'],
    }] }
    if (sql.includes('WITH RECURSIVE') || sql.includes('WITH all_relations')) return { rows: [] }
    if (sql.includes('FROM pg_catalog.pg_proc')) return { rows: [{
      oid: '1', proname: 'whoami', proretset: false, returns_void: false, result_type: 'json',
      proargnames: [], proargmodes: [], pronargs: 0, pronargdefaults: 0, arg_types: '',
    }] }
    return { rows: [] }
  }) as unknown as SQLExecutor & { contexts: typeof contexts }

  direct.transaction = async <T>(callback: (execute: SQLStatementExecutor) => Promise<T>, context?: SQLTransactionContext): Promise<T> => {
    contexts.push(context)
    const execute: SQLStatementExecutor = async (sql: string) => {
      if (/^\s*INSERT/i.test(sql)) return { rows: [{ id: 2, name: 'Ada' }], insertedCount: 1 }
      if (sql.includes('__pgrst_rpc')) return { rows: [{ __pgrst_rows: [{ value: 'user-123' }], __pgrst_count: 1, __pgrst_affected: 1 }] }
      if (sql.includes('row_to_json') || sql.includes('json_agg')) return { rows: [{ id: 1, profiles: [{ id: 10 }] }] }
      return { rows: [{ id: 1, name: 'Alice' }] }
    }
    return callback(execute)
  }
  direct.contexts = contexts
  return direct
}

describe('verified auth context -> PostgreSQL session boundary', () => {
  it('passes the raw request to transactionContext and forwards verified role/claims on reads and writes', async () => {
    const sql = executorWithTransactions()
    const seenAuthorization: string[] = []
    const claims = JSON.stringify({ sub: 'user-123', role: 'authenticated' })
    const app = createPostgRESTRouter(sql, {
      cors: false,
      transactionContext(request, schema) {
        seenAuthorization.push(request.headers.get('authorization') ?? '')
        return {
          schema,
          role: 'authenticated',
          settings: {
            'request.jwt.claims': claims,
            'request.headers': JSON.stringify({ authorization: request.headers.get('authorization') }),
          },
        }
      },
    })

    const headers = { Authorization: 'Bearer verified-session-token' }
    const read = await app.request('/users?id=eq.1', { headers })
    expect(read.status).toBe(200)

    const write = await app.request('/users', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ name: 'Ada' }),
    })
    expect(write.status).toBe(201)

    expect(seenAuthorization).toEqual(['Bearer verified-session-token', 'Bearer verified-session-token'])
    expect(sql.contexts).toHaveLength(2)
    for (const context of sql.contexts) {
      expect(context).toEqual({
        schema: 'public',
        role: 'authenticated',
        settings: {
          'request.jwt.claims': claims,
          'request.headers': JSON.stringify({ authorization: 'Bearer verified-session-token' }),
        },
      })
    }
  })

  it('propagates verified role/claims through the embedded-read planner transaction', async () => {
    const sql = executorWithTransactions()
    const claims = JSON.stringify({ sub: 'user-123', role: 'authenticated' })
    const app = createPostgRESTRouter(sql, {
      cors: false,
      transactionContext: (_request, schema) => ({
        schema,
        role: 'authenticated',
        settings: { 'request.jwt.claims': claims },
      }),
    })

    const res = await app.request('/users?select=id,profiles(id)', {
      headers: { Authorization: 'Bearer verified-session-token' },
    })
    expect(res.status).toBe(200)
    expect(sql.contexts).toEqual([{
      schema: 'public',
      role: 'authenticated',
      settings: { 'request.jwt.claims': claims },
    }])
  })

  it('propagates verified role/claims through RPC execution', async () => {
    const sql = executorWithTransactions()
    const claims = JSON.stringify({ sub: 'user-123', role: 'authenticated' })
    const app = createPostgRESTRouter(sql, {
      cors: false,
      transactionContext: (_request, schema) => ({
        schema,
        role: 'authenticated',
        settings: { 'request.jwt.claims': claims },
      }),
    })

    const res = await app.request('/rpc/whoami')
    expect(res.status).toBe(200)
    expect(sql.contexts).toEqual([{
      schema: 'public',
      role: 'authenticated',
      settings: { 'request.jwt.claims': claims },
    }])
  })
})
