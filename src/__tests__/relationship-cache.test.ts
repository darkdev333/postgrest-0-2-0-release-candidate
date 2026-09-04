import { describe, expect, it } from 'vitest'
import { RelationshipCache, RELATIONSHIPS_SQL, relationshipsFromCatalogRows } from '../relationship-cache.js'

describe('catalog-backed relationship cache', () => {
  it('preserves ordered composite FK column pairs', () => {
    const relationships = relationshipsFromCatalogRows([{
      source_table: 'child', target_table: 'parent', constraint_name: 'child_parent_fkey',
      source_columns: ['tenant_id', 'parent_id'], target_columns: ['tenant_id', 'id'],
      source_unique: false, source_primary_key: ['id'],
    }])
    const direct = relationships.find(rel => rel.sourceTable === 'child' && rel.targetTable === 'parent')!
    expect(direct.columnPairs).toEqual([
      { source: 'tenant_id', target: 'tenant_id' },
      { source: 'parent_id', target: 'id' },
    ])
  })

  it('classifies a unique FK as one-to-one in both directions', () => {
    const relationships = relationshipsFromCatalogRows([{
      source_table: 'profiles', target_table: 'users', constraint_name: 'profiles_user_id_fkey',
      source_columns: '{user_id}', target_columns: '{id}', source_unique: true, source_primary_key: '{user_id}',
    }])
    expect(relationships.find(rel => rel.sourceTable === 'profiles')?.cardinality).toBe('one-to-one')
    expect(relationships.find(rel => rel.sourceTable === 'users')?.cardinality).toBe('one-to-one')
  })

  it('discovers many-to-many through a junction primary key', () => {
    const relationships = relationshipsFromCatalogRows([
      { source_table: 'memberships', target_table: 'users', constraint_name: 'memberships_user_fkey', source_columns: ['user_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'team_id'] },
      { source_table: 'memberships', target_table: 'teams', constraint_name: 'memberships_team_fkey', source_columns: ['team_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'team_id'] },
    ])
    const m2m = relationships.find(rel => rel.sourceTable === 'users' && rel.targetTable === 'teams')
    expect(m2m?.cardinality).toBe('many-to-many')
    expect(m2m?.junction?.table).toBe('memberships')
  })

  it('uses pg_constraint catalog SQL and caches by TTL', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    const cache = new RelationshipCache({ schema: 'api', cacheTTL: 60_000, queryFn: async (sql, params) => {
      calls.push({ sql, params }); return { rows: [] }
    } })
    await cache.getRelationships()
    await cache.getRelationships()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params).toEqual(['api'])
    expect(RELATIONSHIPS_SQL).toContain('pg_constraint')
    expect(RELATIONSHIPS_SQL).toContain('unnest(con.conkey, con.confkey)')
  })
})
