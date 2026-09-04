import { describe, expect, it, vi } from 'vitest';
import { createPostgRESTRouter, type SQLExecutor } from '../router.js';

function profileSqlMock() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true }] };
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] };
    return { rows: [{ id: 1 }] };
  }) as unknown as SQLExecutor & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe('router schema profiles', () => {
  it('uses Accept-Profile for reads and isolates schema cache metadata', async () => {
    const sql = profileSqlMock();
    const app = createPostgRESTRouter(sql, { cors: false, schemas: ['public', 'tenant2'] });
    const res = await app.request('/items', { headers: { 'Accept-Profile': 'tenant2' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-profile')).toBe('tenant2');
    expect(sql.calls.some(call => call.sql.includes('information_schema.columns') && call.params[0] === 'tenant2')).toBe(true);
    expect(sql.calls.some(call => /FROM\s+"tenant2"\."items"/i.test(call.sql))).toBe(true);
  });

  it('uses Content-Profile for writes', async () => {
    const sql = profileSqlMock();
    const app = createPostgRESTRouter(sql, { cors: false, schemas: ['public', 'tenant2'] });
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Profile': 'tenant2', Prefer: 'return=representation' },
      body: JSON.stringify({ id: 1 }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-profile')).toBe('tenant2');
    expect(sql.calls.some(call => /INSERT\s+INTO\s+"tenant2"\."items"/i.test(call.sql))).toBe(true);
  });

  it('rejects schemas outside the exposed list with PGRST106', async () => {
    const sql = profileSqlMock();
    const app = createPostgRESTRouter(sql, { cors: false, schemas: ['public', 'tenant2'] });
    const res = await app.request('/items', { headers: { 'Accept-Profile': 'private' } });
    expect(res.status).toBe(406);
    expect(await res.json()).toEqual({
      code: 'PGRST106',
      details: null,
      hint: null,
      message: 'The schema must be one of the following: public, tenant2',
    });
  });
});
