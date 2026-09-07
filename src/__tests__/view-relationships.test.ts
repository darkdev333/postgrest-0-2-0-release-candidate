import { describe, expect, it } from 'vitest'
import type { RelationshipInfo } from '../relationships.js'
import { deriveViewRelationships, expandViewColumnDependencies, viewPrimaryKeys } from '../view-relationships.js'

const base: RelationshipInfo = {
  sourceTable: 'personnages',
  targetTable: 'actors',
  constraintName: 'personnages_role_id_fkey',
  cardinality: 'many-to-one',
  columnPairs: [{ source: 'role_id', target: 'id' }],
  self: false,
}

const dependencies = [
  {
    tableName: 'personnages', viewName: 'personnages_view',
    constraintName: 'personnages_role_id_fkey', type: 'f' as const,
    columns: [{ tableColumn: 'role_id', viewColumns: ['roleId'] }],
  },
  {
    tableName: 'actors', viewName: 'actors_view',
    constraintName: 'personnages_role_id_fkey', type: 'f_ref' as const,
    columns: [{ tableColumn: 'id', viewColumns: ['actorId'] }],
  },
]

describe('upstream view relationship derivation', () => {
  it('creates view->table, table->view and view->view relationships', () => {
    expect(deriveViewRelationships([base], dependencies)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTable: 'personnages_view', targetTable: 'actors',
        columnPairs: [{ source: 'roleId', target: 'id' }],
      }),
      expect.objectContaining({
        sourceTable: 'personnages', targetTable: 'actors_view',
        columnPairs: [{ source: 'role_id', target: 'actorId' }],
      }),
      expect.objectContaining({
        sourceTable: 'personnages_view', targetTable: 'actors_view',
        columnPairs: [{ source: 'roleId', target: 'actorId' }],
      }),
    ]))
  })

  it('preserves one-to-one cardinality for derived view relationships', () => {
    const oneToOne = { ...base, cardinality: 'one-to-one' as const }
    expect(deriveViewRelationships([oneToOne], dependencies).every(rel => rel.cardinality === 'one-to-one')).toBe(true)
  })

  it('expands repeated references as a Cartesian product like upstream traverse', () => {
    expect(expandViewColumnDependencies([
      { tableColumn: 'tenant_id', viewColumns: ['tenant_a', 'tenant_b'] },
      { tableColumn: 'project_id', viewColumns: ['project_a', 'project_b'] },
    ])).toEqual([
      [{ source: 'tenant_id', target: 'tenant_a' }, { source: 'project_id', target: 'project_a' }],
      [{ source: 'tenant_id', target: 'tenant_a' }, { source: 'project_id', target: 'project_b' }],
      [{ source: 'tenant_id', target: 'tenant_b' }, { source: 'project_id', target: 'project_a' }],
      [{ source: 'tenant_id', target: 'tenant_b' }, { source: 'project_id', target: 'project_b' }],
    ])
  })

  it('chooses the first projected reference for each inherited view PK column', () => {
    const keys = viewPrimaryKeys([{
      tableName: 'projects', viewName: 'projects_view', constraintName: 'projects_pkey', type: 'p',
      columns: [
        { tableColumn: 'tenant_id', viewColumns: ['tenant_alias_1', 'tenant_alias_2'] },
        { tableColumn: 'id', viewColumns: ['project_id'] },
      ],
    }])
    expect(keys.get('projects_view')).toEqual(['tenant_alias_1', 'project_id'])
  })
})
