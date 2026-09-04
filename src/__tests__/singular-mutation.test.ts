import { describe, expect, it, vi } from 'vitest';
import { createPostgRESTRouter } from '../router.js';
import type { SQLExecutor } from '../executor.js';

function transactionalMock(rows: Record<string, unknown>[]) {
  let rolledBack = false;
  let mutationCalls = 0;
  const sql = vi.fn(async (statement: string) => {
    if (statement.includes('information_schema.columns')) {
      return { rows: [
        { table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true },
        { table_name: 'items', column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null, character_maximum_length: null, numeric_precision: null, numeric_scale: null, is_primary_key: false, is_unique: false },
      ] };
    }
    if (statement.includes('information_schema.table_constraints')) return { rows: [] };
    return { rows: [] };
  }) as unknown as SQLExecutor;

  sql.transaction = vi.fn(async callback => {
    const execute = vi.fn(async (statement: string) => {
      if (/^(INSERT|UPDATE|DELETE)/i.test(statement)) mutationCalls++;
      return { rows };
    });
    try {
      return await callback(execute);
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  });

  return { sql, get rolledBack() { return rolledBack; }, get mutationCalls() { return mutationCalls; } };
}

describe('atomic singular mutations', () => {
  it('returns PGRST116 and rolls back a multi-row singular PATCH', async () => {
    const mock = transactionalMock([{ id: 1 }, { id: 2 }]);
    const app = createPostgRESTRouter(mock.sql, { cors: false });
    const res = await app.request('/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.pgrst.object+json' },
      body: JSON.stringify({ name: 'changed' }),
    });
    expect(res.status).toBe(406);
    expect(await res.json()).toMatchObject({ code: 'PGRST116', details: 'The result contains 2 rows' });
    expect(mock.rolledBack).toBe(true);
    expect(mock.mutationCalls).toBe(1);
  });

  it('allows one-row singular minimal mutation while using RETURNING for validation', async () => {
    const mock = transactionalMock([{ id: 1, name: 'changed' }]);
    const app = createPostgRESTRouter(mock.sql, { cors: false });
    const res = await app.request('/items?id=eq.1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.pgrst.object+json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name: 'changed' }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(mock.rolledBack).toBe(false);
  });

  it('refuses singular writes before mutation when transaction capability is absent', async () => {
    let mutationCalls = 0;
    const sql = vi.fn(async (statement: string) => {
      if (statement.includes('information_schema.columns')) return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true }] };
      if (statement.includes('information_schema.table_constraints')) return { rows: [] };
      if (/^(INSERT|UPDATE|DELETE)/i.test(statement)) mutationCalls++;
      return { rows: [] };
    }) as unknown as SQLExecutor;
    const app = createPostgRESTRouter(sql, { cors: false });
    const res = await app.request('/items?id=eq.1', { method: 'DELETE', headers: { Accept: 'application/vnd.pgrst.object+json' } });
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: 'PGRST501' });
    expect(mutationCalls).toBe(0);
  });
});
