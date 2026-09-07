import { describe, expect, it } from 'vitest'
import {
  COMPUTED_RELATIONSHIPS_SQL,
  RelationshipCache,
  RELATIONSHIPS_SQL,
  VIEW_KEY_DEPENDENCIES_SQL,
  relationshipsFromCatalogRows,
  relationshipsFromComputedRows,
} from '../relationship-cache.js'

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

  it('preserves recursive many-to-many relationships from catalog rows', () => {
    const relationships = relationshipsFromCatalogRows([
      { source_table: 'subscriptions', target_table: 'posters', constraint_name: 'subscriptions_subscriber_fkey', source_columns: ['subscriber'], target_columns: ['id'], source_unique: false, source_primary_key: ['subscriber', 'subscribed'] },
      { source_table: 'subscriptions', target_table: 'posters', constraint_name: 'subscriptions_subscribed_fkey', source_columns: ['subscribed'], target_columns: ['id'], source_unique: false, source_primary_key: ['subscriber', 'subscribed'] },
    ])
    const recursive = relationships.filter(rel => rel.cardinality === 'many-to-many' && rel.sourceTable === 'posters' && rel.targetTable === 'posters')
    expect(recursive).toHaveLength(2)
    expect(recursive.every(rel => rel.self)).toBe(true)
    expect(new Set(recursive.map(rel => rel.junction?.sourceConstraint))).toEqual(new Set(['subscriptions_subscriber_fkey', 'subscriptions_subscribed_fkey']))
  })

  it('maps ROWS 1 computed relationships as to-one', () => {
    const [relationship] = relationshipsFromComputedRows([{
      function_schema: 'api', function_name: 'manager', source_table: 'employees', target_table: 'employees', single_row: true,
    }])
    expect(relationship?.cardinality).toBe('one-to-one')
    expect(relationship?.self).toBe(true)
    expect(relationship?.computed).toEqual({ functionName: 'manager', functionSchema: 'api' })
  })

  it('maps SETOF computed relationships without ROWS 1 as to-many', () => {
    const [relationship] = relationshipsFromComputedRows([{
      function_schema: 'api', function_name: 'reports', source_table: 'employees', target_table: 'employees', single_row: false,
    }])
    expect(relationship?.cardinality).toBe('one-to-many')
    expect(relationship?.computed?.functionName).toBe('reports')
  })

  it('restricts computed relationship types to PostgreSQL relation row types', () => {
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain("relkind IN ('v','r','m','f','p')")
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('p.proargtypes[0] IN (SELECT reltype FROM all_relations)')
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('p.prorettype IN (SELECT reltype FROM all_relations)')
    expect(COMPUTED_RELATIONSHIPS_SQL).not.toContain('typrelid <> 0')
  })

  it('uses upstream computed cardinality semantics', () => {
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('(NOT p.proretset OR p.prorows = 1) AS single_row')
  })

  it('queries FK, view-dependency and computed catalogs once per cached refresh', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    const cache = new RelationshipCache({ schema: 'api', cacheTTL: 60_000, queryFn: async (sql, params) => {
      calls.push({ sql, params }); return { rows: [] }
    } })
    await cache.getRelationships()
    await cache.getRelationships()
    expect(calls).toHaveLength(3)
    expect(calls.find(call => call.sql === RELATIONSHIPS_SQL)?.params).toBeUndefined()
    expect(calls.find(call => call.sql === VIEW_KEY_DEPENDENCIES_SQL)?.params).toEqual([['api'], []])
    expect(calls.find(call => call.sql === COMPUTED_RELATIONSHIPS_SQL)?.params).toEqual(['api'])
    expect(calls.some(call => call.sql === RELATIONSHIPS_SQL)).toBe(true)
    expect(calls.some(call => call.sql === VIEW_KEY_DEPENDENCIES_SQL)).toBe(true)
    expect(calls.some(call => call.sql === COMPUTED_RELATIONSHIPS_SQL)).toBe(true)
    expect(RELATIONSHIPS_SQL).toContain('pg_constraint')
    expect(RELATIONSHIPS_SQL).toContain('unnest(con.conkey, con.confkey)')
  })
})
