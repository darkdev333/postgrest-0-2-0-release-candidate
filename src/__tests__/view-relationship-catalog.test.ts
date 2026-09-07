import { describe, expect, it } from 'vitest'
import { VIEW_KEY_DEPENDENCIES_SQL, viewDependenciesFromCatalogRows } from '../view-relationship-catalog.js'

describe('upstream view key dependency catalog port', () => {
  it('retains recursive pg_rewrite dependency traversal and complete-key gating', () => {
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('WITH RECURSIVE')
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('pg_rewrite')
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('tab.resorigtbl = ANY(path)')
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('HAVING pks_fks.ncol = count(*)')
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain("concat(contype, '_ref')")
  })

  it('uses exposed schemas as recursion roots while allowing extra-search-path views in traversal', () => {
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('n.nspname = ANY($1::text[] || $2::text[])')
    expect(VIEW_KEY_DEPENDENCIES_SQL).toContain('view_schema = ANY($1::text[])')
  })

  it('decodes JSON dependency rows into the pure derivation model', () => {
    expect(viewDependenciesFromCatalogRows([{
      table_schema: 'private', table_name: 'personnages',
      view_schema: 'test', view_name: 'personnages_view',
      constraint_name: 'personnages_role_id_fkey', constraint_type: 'f',
      column_dependencies: [{ table_column: 'role_id', view_columns: ['roleId', 'roleIdAgain'] }],
    }])).toEqual([{
      tableSchema: 'private', tableName: 'personnages',
      viewSchema: 'test', viewName: 'personnages_view',
      constraintName: 'personnages_role_id_fkey', type: 'f',
      columns: [{ tableColumn: 'role_id', viewColumns: ['roleId', 'roleIdAgain'] }],
    }])
  })

  it('accepts JSON text returned by executors that do not decode JSON columns', () => {
    const [dependency] = viewDependenciesFromCatalogRows([{
      table_name: 'actors', view_name: 'actors_view',
      constraint_name: 'personnages_role_id_fkey', constraint_type: 'f_ref',
      column_dependencies: JSON.stringify([{ table_column: 'id', view_columns: ['actorId'] }]),
    }])
    expect(dependency?.columns).toEqual([{ tableColumn: 'id', viewColumns: ['actorId'] }])
  })
})
