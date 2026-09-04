import { describe, expect, it, vi } from 'vitest';
import { createPostgRESTRouter, type SQLExecutor } from '../router.js';

function sqlMock(total = 15): SQLExecutor {
  return vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ table_name: 'items', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, is_primary_key: true, is_unique: true }] };
    }
    if (sql.includes('information_schema.table_constraints')) return { rows: [] };
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ count: String(total) }] };
    const offset = Number(sql.match(/OFFSET\s+(\d+)/i)?.[1] ?? 0);
    const limit = Number(sql.match(/LIMIT\s+(\d+)/i)?.[1] ?? 100);
    const count = Math.max(0, Math.min(limit, total - offset));
    return { rows: Array.from({ length: count }, (_, i) => ({ id: offset + i + 1 })) };
  }) as unknown as SQLExecutor;
}

describe('router range and HEAD parity', () => {
  it('returns PGRST103/416 for descending Range headers', async () => {
    const app = createPostgRESTRouter(sqlMock(), { cors: false });
    const res = await app.request('/items', { headers: { Range: '1-0' } });
    expect(res.status).toBe(416);
    expect(await res.json()).toEqual({
      code: 'PGRST103',
      message: 'Requested range not satisfiable',
      details: 'The lower boundary must be lower than or equal to the upper boundary in the Range header.',
      hint: null,
    });
  });

  it('returns PGRST103/416 for negative limit', async () => {
    const app = createPostgRESTRouter(sqlMock(), { cors: false });
    const res = await app.request('/items?limit=-1');
    expect(res.status).toBe(416);
    expect((await res.json()).code).toBe('PGRST103');
  });

  it('returns 416 and */total when exact-count offset is past the collection', async () => {
    const app = createPostgRESTRouter(sqlMock(15), { cors: false });
    const res = await app.request('/items?offset=100', { headers: { Prefer: 'count=exact' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('*/15');
    expect((await res.json()).details).toBe('An offset of 100 was requested, but there are only 15 rows.');
  });

  it('uses 206 when an exact count proves the returned range is partial', async () => {
    const app = createPostgRESTRouter(sqlMock(100), { cors: false });
    const res = await app.request('/items?limit=25', { headers: { Prefer: 'count=exact' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('0-24/100');
  });

  it('HEAD mirrors GET range metadata without forcing count=exact', async () => {
    const app = createPostgRESTRouter(sqlMock(15), { cors: false });
    const res = await app.request('/items?limit=3&offset=2', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBe('2-4/*');
    expect(await res.text()).toBe('');
  });

  it('HEAD honors an explicit exact count and can return partial-content status', async () => {
    const app = createPostgRESTRouter(sqlMock(15), { cors: false });
    const res = await app.request('/items?limit=3&offset=2', { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('2-4/15');
    expect(res.headers.get('preference-applied')).toContain('count=exact');
  });
});
