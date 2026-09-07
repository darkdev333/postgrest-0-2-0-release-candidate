import { describe, expect, it } from 'vitest'
import {
  COMPUTED_RELATIONSHIPS_SQL,
  RELATIONSHIPS_SQL,
  RelationshipCache,
  applyComputedRelationshipOverrides,
  relationshipsFromCatalogAndViewRows,
  relationshipsFromCatalogRows,
  relationshipsFromComputedRows,
} from '../relationship-cache.js'
import type { RelationshipInfo } from '../relationships.js'

describe('upstream relationship schema filtering and computed overrides', () => {
  it('keeps catalog FK discovery schema-complete until upstream-style post-assembly filtering', () => {
    expect(RELATIONSHIPS_SQL).toContain('JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace')
    expect(RELATIONSHIPS_SQL).toContain('JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace')
    expect(RELATIONSHIPS_SQL).toContain('AND con.conparentid = 0')
    expect(RELATIONSHIPS_SQL).not.toContain('src_ns.nspname = $1')
    expect(RELATIONSHIPS_SQL).not.toContain('tgt_ns.nspname = $1')
  })

  it('drops direct catalog relationships whose source or target schema is not exposed', () => {
    const rows = [
      {
        source_schema: 'public', source_table: 'profiles', target_schema: 'auth', target_table: 'users',
        constraint_name: 'profiles_user_id_fkey', source_columns: ['user_id'], target_columns: ['id'],
        source_unique: false, source_primary_key: ['id'],
      },
      {
        source_schema: 'public', source_table: 'tickets', target_schema: 'public', target_table: 'clients',
        constraint_name: 'tickets_client_id_fkey', source_columns: ['client_id'], target_columns: ['id'],
        source_unique: false, source_primary_key: ['id'],
      },
    ]
    const relationships = relationshipsFromCatalogRows(rows, 'public')
    expect(relationships.some(rel => rel.sourceTable === 'profiles' && rel.targetTable === 'users')).toBe(false)
    expect(relationships.some(rel => rel.sourceTable === 'tickets' && rel.targetTable === 'clients')).toBe(true)
  })

  it('derives an exposed view-to-view relationship from a private underlying FK before removing internal relationships', () => {
    const fkRows = [{
      source_schema: 'private', source_table: 'personnages', target_schema: 'private', target_table: 'actors',
      constraint_name: 'personnages_role_id_fkey', source_columns: ['role_id'], target_columns: ['id'],
      source_unique: false, source_primary_key: ['id'],
    }]
    const viewRows = [
      {
        table_schema: 'private', table_name: 'personnages', view_schema: 'public', view_name: 'personnages_view',
        constraint_name: 'personnages_role_id_fkey', constraint_type: 'f',
        column_dependencies: [{ table_column: 'role_id', view_columns: ['roleId'] }],
      },
      {
        table_schema: 'private', table_name: 'actors', view_schema: 'public', view_name: 'actors_view',
        constraint_name: 'personnages_role_id_fkey', constraint_type: 'f_ref',
        column_dependencies: [{ table_column: 'id', view_columns: ['actorId'] }],
      },
    ]

    const relationships = relationshipsFromCatalogAndViewRows(fkRows, viewRows, 'public')
    const derived = relationships.find(rel => rel.sourceTable === 'personnages_view' && rel.targetTable === 'actors_view')
    expect(derived).toMatchObject({
      sourceSchema: 'public', targetSchema: 'public', cardinality: 'many-to-one',
      columnPairs: [{ source: 'roleId', target: 'actorId' }], sourceIsView: true, targetIsView: true,
    })
    expect(relationships.some(rel => rel.sourceSchema === 'private' || rel.targetSchema === 'private')).toBe(false)
  })

  it('does not cross-match view dependencies from a same-named table in another schema', () => {
    const fkRows = [{
      source_schema: 'private', source_table: 'personnages', target_schema: 'private', target_table: 'actors',
      constraint_name: 'personnages_role_id_fkey', source_columns: ['role_id'], target_columns: ['id'],
      source_unique: false, source_primary_key: ['id'],
    }]
    const viewRows = [{
      table_schema: 'other', table_name: 'personnages', view_schema: 'public', view_name: 'wrong_view',
      constraint_name: 'personnages_role_id_fkey', constraint_type: 'f',
      column_dependencies: [{ table_column: 'role_id', view_columns: ['roleId'] }],
    }]
    const relationships = relationshipsFromCatalogAndViewRows(fkRows, viewRows, 'public')
    expect(relationships.some(rel => rel.sourceTable === 'wrong_view')).toBe(false)
  })

  it('only discovers computed relationship functions in the active schema', () => {
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('AND fn_ns.nspname = $1')
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('AND arg_ns.nspname = $1')
    expect(COMPUTED_RELATIONSHIPS_SQL).toContain('AND ret_ns.nspname = $1')

    const relationships = relationshipsFromComputedRows([
      {
        function_schema: 'private', function_name: 'director',
        source_schema: 'public', source_table: 'films', target_schema: 'public', target_table: 'directors', single_row: true,
      },
      {
        function_schema: 'public', function_name: 'premieres',
        source_schema: 'public', source_table: 'films', target_schema: 'public', target_table: 'premieres', single_row: false,
      },
    ], 'public')
    expect(relationships.map(rel => rel.computed?.functionName)).toEqual(['premieres'])
  })

  it('replaces the whole detected source/target bucket when a computed relationship has the target name', () => {
    const detected: RelationshipInfo[] = [
      {
        sourceSchema: 'public', sourceTable: 'films', targetSchema: 'public', targetTable: 'directors', constraintName: 'films_director_id_fkey',
        cardinality: 'many-to-one', columnPairs: [{ source: 'director_id', target: 'id' }], self: false,
      },
      {
        sourceSchema: 'public', sourceTable: 'films', targetSchema: 'public', targetTable: 'directors', constraintName: 'films_alt_director_id_fkey',
        cardinality: 'many-to-one', columnPairs: [{ source: 'alt_director_id', target: 'id' }], self: false,
      },
      {
        sourceSchema: 'public', sourceTable: 'films', targetSchema: 'public', targetTable: 'actors', constraintName: 'films_actor_id_fkey',
        cardinality: 'many-to-one', columnPairs: [{ source: 'actor_id', target: 'id' }], self: false,
      },
    ]
    const computed = relationshipsFromComputedRows([{
      function_schema: 'public', function_name: 'directors',
      source_schema: 'public', source_table: 'films', target_schema: 'public', target_table: 'directors', single_row: false,
    }], 'public')

    const patched = applyComputedRelationshipOverrides(detected, computed)
    expect(patched.filter(rel => rel.sourceTable === 'films' && rel.targetTable === 'directors')).toEqual(computed)
    expect(patched.some(rel => rel.targetTable === 'actors')).toBe(true)
  })

  it('applies post-assembly schema filtering and computed override during cache refresh', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    const cache = new RelationshipCache({
      schema: 'public',
      queryFn: async (sql, params) => {
        calls.push({ sql, params })
        if (sql === RELATIONSHIPS_SQL) {
          return { rows: [
            {
              source_schema: 'public', source_table: 'films', target_schema: 'public', target_table: 'directors',
              constraint_name: 'films_director_id_fkey', source_columns: ['director_id'], target_columns: ['id'],
              source_unique: false, source_primary_key: ['id'],
            },
            {
              source_schema: 'public', source_table: 'profiles', target_schema: 'auth', target_table: 'users',
              constraint_name: 'profiles_user_id_fkey', source_columns: ['user_id'], target_columns: ['id'],
              source_unique: false, source_primary_key: ['id'],
            },
          ] }
        }
        if (sql === COMPUTED_RELATIONSHIPS_SQL) {
          return { rows: [{
            function_schema: 'public', function_name: 'directors',
            source_schema: 'public', source_table: 'films', target_schema: 'public', target_table: 'directors', single_row: true,
          }] }
        }
        return { rows: [] }
      },
    })

    const relationships = await cache.getRelationships()
    expect(calls.find(call => call.sql === RELATIONSHIPS_SQL)?.params).toBeUndefined()
    expect(relationships.some(rel => rel.sourceTable === 'profiles' && rel.targetTable === 'users')).toBe(false)
    expect(relationships.filter(rel => rel.sourceTable === 'films' && rel.targetTable === 'directors')).toHaveLength(1)
    expect(relationships.find(rel => rel.sourceTable === 'films' && rel.targetTable === 'directors')?.computed?.functionName).toBe('directors')
  })
})
