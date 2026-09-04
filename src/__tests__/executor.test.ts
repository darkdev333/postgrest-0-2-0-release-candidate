import { describe, expect, it, vi } from 'vitest';
import { hasTransactionCapability, withOptionalTransaction, type SQLExecutor } from '../executor.js';

describe('optional SQL transaction capability', () => {
  it('falls back to the callable executor when transaction is absent', async () => {
    const sql = vi.fn(async () => ({ rows: [{ id: 1 }] })) as unknown as SQLExecutor;
    const rows = await withOptionalTransaction(sql, async execute => (await execute('select 1')).rows, { schema: 'public' });
    expect(rows).toEqual([{ id: 1 }]);
    expect(sql).toHaveBeenCalledWith('select 1');
    expect(hasTransactionCapability(sql)).toBe(false);
  });

  it('uses transaction callback and passes request context when available', async () => {
    const sql = vi.fn(async () => ({ rows: [] })) as unknown as SQLExecutor;
    const txExecute = vi.fn(async () => ({ rows: [{ role: 'authenticated' }] }));
    sql.transaction = vi.fn(async (callback, context) => {
      expect(context).toEqual({ schema: 'api', role: 'authenticated', settings: { 'request.jwt.claims': '{"sub":"1"}' } });
      return callback(txExecute);
    });

    const result = await withOptionalTransaction(
      sql,
      async execute => (await execute('select current_user')).rows,
      { schema: 'api', role: 'authenticated', settings: { 'request.jwt.claims': '{"sub":"1"}' } },
    );

    expect(result).toEqual([{ role: 'authenticated' }]);
    expect(txExecute).toHaveBeenCalledWith('select current_user');
    expect(sql).not.toHaveBeenCalled();
    expect(hasTransactionCapability(sql)).toBe(true);
  });
});
