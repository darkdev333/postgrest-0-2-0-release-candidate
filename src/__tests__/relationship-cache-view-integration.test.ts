import { describe, expect, it } from 'vitest'
import {
  COMPUTED_RELATIONSHIPS_SQL,
  RelationshipCache,
  RELATIONSHIPS_SQL,
  VIEW_KEY_DEPENDENCIES_SQL,
  relationshipsFromCatalogAndViewRows,
} from '../relationship-cache.js'

describe('view-aware relationship cache integration', () => {
  const fkRows = [
    { source_table: 'memberships', target_table: 'users', constraint_name: 'memberships_user_fkey', source_columns: ['user_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'team_id'] },
    { source_table: 'memberships', target_table: 'teams', constraint_name: 'memberships_team_fkey', source_columns: ['team_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'team_id'] },
  ]
  const viewRows = [
    { table_name: 'memberships', view_name: 'memberships_view', constraint_name: 'memberships_user_fkey', constraint_type: 'f', column_dependencies: [{ table_column: 'user_id', view_columns: ['user_ref'] }] },
    { table_name: 'memberships', view_name: 'memberships_view', constraint_name: 'memberships_team_fkey', constraint_type: 'f', column_dependencies: [{ table_column: 'team_id', view_columns: ['team_ref'] }] },
    { table_name: 'memberships', view_name: 'memberships_view', constraint_name: 'memberships_pkey', constraint_type: 'p', column_dependencies: [
      { table_column: 'user_id', view_columns: ['user_ref'] },
      { table_column: 'team_id', view_columns: ['team_ref'] },
    ] },
  ]

  it('assembles derived view relationships and M2M-through-view from catalog rows', () => {
    const relationships = relationshipsFromCatalogAndViewRows(fkRows, viewRows)
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTable: 'memberships_view', targetTable: 'users', cardinality: 'many-to-one' }),
      expect.objectContaining({ sourceTable: 'users', targetTable: 'memberships_view', cardinality: 'one-to-many' }),
      expect.objectContaining({ sourceTable: 'users', targetTable: 'teams', cardinality: 'many-to-many', junction: expect.objectContaining({ table: 'memberships_view' }) }),
    ]))
  })

  it('refreshes FK, view-dependency and computed catalogs once and caches the combined graph', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    const cache = new RelationshipCache({
      schema: 'api', extraSearchPath: ['extensions'], cacheTTL: 60_000,
      queryFn: async (sql, params) => {
        calls.push({ sql, params })
        if (sql === RELATIONSHIPS_SQL) return { rows: fkRows }
        if (sql === VIEW_KEY_DEPENDENCIES_SQL) return { rows: viewRows }
        if (sql === COMPUTED_RELATIONSHIPS_SQL) return { rows: [] }
        throw new Error('unexpected catalog query')
      },
    })
    const first = await cache.getRelationships()
    const second = await cache.getRelationships()
    expect(first).toEqual(second)
    expect(calls).toHaveLength(3)
    expect(calls.find(call => call.sql === RELATIONSHIPS_SQL)?.params).toBeUndefined()
    expect(calls.find(call => call.sql === VIEW_KEY_DEPENDENCIES_SQL)?.params).toEqual([['api'], ['extensions']])
    expect(calls.find(call => call.sql === COMPUTED_RELATIONSHIPS_SQL)?.params).toEqual(['api'])
  })
})
