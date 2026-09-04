import { describe, expect, it } from 'vitest'
import type { ColumnInfo, ForeignKeyInfo, TableSchema } from '../schema.js'
import { buildRelationships, findRelationshipCandidates, isToOneRelationship } from '../relationships.js'

function columns(names: Array<[string, Partial<ColumnInfo>?]>): Map<string, ColumnInfo> {
  return new Map(names.map(([name, extra]) => [name, {
    name,
    type: 'integer',
    nullable: false,
    isPrimaryKey: false,
    isUnique: false,
    ...extra,
  }]))
}

function table(name: string, primaryKey: string[], foreignKeys: ForeignKeyInfo[], cols: Map<string, ColumnInfo>): TableSchema {
  return { name, schema: 'public', columns: cols, primaryKey, foreignKeys, indexes: [] }
}

describe('PostgREST relationship graph', () => {
  it('preserves multiple FK candidates instead of selecting the first one', () => {
    const tickets = table('tickets', ['id'], [
      { name: 'tickets_client_id_fkey', column: 'client_id', referencedTable: 'clients', referencedColumn: 'id' },
      { name: 'tickets_billing_client_id_fkey', column: 'billing_client_id', referencedTable: 'clients', referencedColumn: 'id' },
    ], columns([['id', { isPrimaryKey: true }], ['client_id'], ['billing_client_id']]))
    const clients = table('clients', ['id'], [], columns([['id', { isPrimaryKey: true }]]))

    const relationships = buildRelationships(new Map([['tickets', tickets], ['clients', clients]]))
    expect(findRelationshipCandidates(relationships, 'tickets', 'clients')).toHaveLength(2)
    expect(findRelationshipCandidates(relationships, 'tickets', 'clients', 'tickets_client_id_fkey')).toHaveLength(1)
    expect(findRelationshipCandidates(relationships, 'tickets', 'clients', 'billing_client_id')).toHaveLength(1)
  })

  it('groups composite FK rows into one relationship with ordered column pairs', () => {
    const child = table('child', ['id'], [
      { name: 'child_parent_fkey', column: 'tenant_id', referencedTable: 'parent', referencedColumn: 'tenant_id' },
      { name: 'child_parent_fkey', column: 'parent_id', referencedTable: 'parent', referencedColumn: 'id' },
    ], columns([['id', { isPrimaryKey: true }], ['tenant_id'], ['parent_id']]))
    const parent = table('parent', ['tenant_id', 'id'], [], columns([
      ['tenant_id', { isPrimaryKey: true }],
      ['id', { isPrimaryKey: true }],
    ]))

    const direct = findRelationshipCandidates(buildRelationships(new Map([['child', child], ['parent', parent]])), 'child', 'parent')
    expect(direct).toHaveLength(1)
    expect(direct[0]?.columnPairs).toEqual([
      { source: 'tenant_id', target: 'tenant_id' },
      { source: 'parent_id', target: 'id' },
    ])
  })

  it('distinguishes to-one from inverse to-many relationships', () => {
    const tickets = table('tickets', ['id'], [
      { name: 'tickets_client_id_fkey', column: 'client_id', referencedTable: 'clients', referencedColumn: 'id' },
    ], columns([['id', { isPrimaryKey: true }], ['client_id']]))
    const clients = table('clients', ['id'], [], columns([['id', { isPrimaryKey: true }]]))
    const relationships = buildRelationships(new Map([['tickets', tickets], ['clients', clients]]))

    const toClient = findRelationshipCandidates(relationships, 'tickets', 'clients')[0]!
    const toTickets = findRelationshipCandidates(relationships, 'clients', 'tickets')[0]!
    expect(toClient.cardinality).toBe('many-to-one')
    expect(isToOneRelationship(toClient)).toBe(true)
    expect(toTickets.cardinality).toBe('one-to-many')
    expect(isToOneRelationship(toTickets)).toBe(false)
  })

  it('discovers a conservative many-to-many relationship through a junction primary key', () => {
    const users = table('users', ['id'], [], columns([['id', { isPrimaryKey: true }]]))
    const teams = table('teams', ['id'], [], columns([['id', { isPrimaryKey: true }]]))
    const memberships = table('memberships', ['user_id', 'team_id'], [
      { name: 'memberships_user_id_fkey', column: 'user_id', referencedTable: 'users', referencedColumn: 'id' },
      { name: 'memberships_team_id_fkey', column: 'team_id', referencedTable: 'teams', referencedColumn: 'id' },
    ], columns([
      ['user_id', { isPrimaryKey: true }],
      ['team_id', { isPrimaryKey: true }],
    ]))

    const relationships = buildRelationships(new Map([
      ['users', users], ['teams', teams], ['memberships', memberships],
    ]))
    const userTeams = findRelationshipCandidates(relationships, 'users', 'teams')

    expect(userTeams).toHaveLength(1)
    expect(userTeams[0]?.cardinality).toBe('many-to-many')
    expect(userTeams[0]?.junction?.table).toBe('memberships')
  })
})
