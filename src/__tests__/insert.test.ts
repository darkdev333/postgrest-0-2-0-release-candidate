import { describe, expect, it } from 'vitest';
import { buildInsertStatement } from '../insert.js';

describe('PostgREST insert compiler', () => {
  it('uses NULL for missing keys by default', () => {
    const built = buildInsertStatement('items', [{ id: 1, name: 'one' }, { id: 2 }], { schema: 'public' });
    expect(built.sql).toContain('INSERT INTO "public"."items"');
    expect(built.sql).toContain('VALUES ($1, $2), ($3, $4)');
    expect(built.params).toEqual([1, 'one', 2, null]);
  });

  it('uses DEFAULT for missing keys only with missing=default', () => {
    const built = buildInsertStatement('items', [{ id: 1, name: 'one' }, { id: 2 }], { missing: 'default' });
    expect(built.sql).toContain('VALUES ($1, $2), ($3, DEFAULT)');
    expect(built.params).toEqual([1, 'one', 2]);
  });

  it('builds merge-duplicates against a compound conflict target', () => {
    const built = buildInsertStatement('items', { key1: 1, key2: 2, value: 'new' }, {
      resolution: 'merge-duplicates',
      conflictColumns: ['key1', 'key2'],
      returning: '*',
    });
    expect(built.sql).toContain('ON CONFLICT ("key1", "key2") DO UPDATE SET "value" = EXCLUDED."value"');
    expect(built.sql.endsWith(' RETURNING *')).toBe(true);
  });

  it('builds ignore-duplicates with or without a target', () => {
    expect(buildInsertStatement('items', { id: 1 }, { resolution: 'ignore-duplicates' }).sql)
      .toContain('ON CONFLICT DO NOTHING');
    expect(buildInsertStatement('items', { id: 1 }, { resolution: 'ignore-duplicates', conflictColumns: ['id'] }).sql)
      .toContain('ON CONFLICT ("id") DO NOTHING');
  });

  it('rejects merge-duplicates without a conflict target', () => {
    expect(() => buildInsertStatement('items', { value: 1 }, { resolution: 'merge-duplicates' }))
      .toThrow('merge-duplicates requires a conflict target');
  });
});
