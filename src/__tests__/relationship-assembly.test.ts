import { describe, expect, it } from 'vitest'
import type { RelationshipInfo } from '../relationships.js'
import { addInverseRelationships, assembleViewAwareRelationships, discoverManyToManyRelationships } from '../relationship-assembly.js'
import type { ViewKeyDependency } from '../view-relationships.js'

const userFk: RelationshipInfo = {
  sourceTable: 'memberships', targetTable: 'users', constraintName: 'memberships_user_fkey',
  cardinality: 'many-to-one', columnPairs: [{ source: 'user_id', target: 'id' }], self: false,
}
const teamFk: RelationshipInfo = {
  sourceTable: 'memberships', targetTable: 'teams', constraintName: 'memberships_team_fkey',
  cardinality: 'many-to-one', columnPairs: [{ source: 'team_id', target: 'id' }], self: false,
}

describe('upstream relationship graph assembly ordering', () => {
  it('adds M2M when FK columns are only a subset of a wider primary key', () => {
    const relationships = discoverManyToManyRelationships(
      [userFk, teamFk],
      new Map([['memberships', ['id', 'user_id', 'team_id']]]),
    )
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTable: 'users', targetTable: 'teams', cardinality: 'many-to-many' }),
      expect.objectContaining({ sourceTable: 'teams', targetTable: 'users', cardinality: 'many-to-many' }),
    ]))
  })

  it('adds inverse O2M after direct M2O relationships', () => {
    expect(addInverseRelationships([userFk])).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTable: 'users', targetTable: 'memberships', cardinality: 'one-to-many' }),
    ]))
  })

  it('detects M2M through a view only after inheriting the base primary key', () => {
    const dependencies: ViewKeyDependency[] = [
      {
        tableName: 'memberships', viewName: 'memberships_view', constraintName: 'memberships_user_fkey', type: 'f',
        columns: [{ tableColumn: 'user_id', viewColumns: ['user_ref'] }],
      },
      {
        tableName: 'memberships', viewName: 'memberships_view', constraintName: 'memberships_team_fkey', type: 'f',
        columns: [{ tableColumn: 'team_id', viewColumns: ['team_ref'] }],
      },
      {
        tableName: 'memberships', viewName: 'memberships_view', constraintName: 'memberships_pkey', type: 'p',
        columns: [
          { tableColumn: 'user_id', viewColumns: ['user_ref'] },
          { tableColumn: 'team_id', viewColumns: ['team_ref'] },
        ],
      },
    ]
    const relationships = assembleViewAwareRelationships(
      [userFk, teamFk],
      new Map([['memberships', ['user_id', 'team_id']]]),
      dependencies,
    )
    const throughView = relationships.find(relationship =>
      relationship.sourceTable === 'users'
      && relationship.targetTable === 'teams'
      && relationship.cardinality === 'many-to-many'
      && relationship.junction?.table === 'memberships_view',
    )
    expect(throughView?.junction?.sourceColumns).toEqual([{ source: 'id', target: 'user_ref' }])
    expect(throughView?.junction?.targetColumns).toEqual([{ source: 'team_ref', target: 'id' }])
  })
})
