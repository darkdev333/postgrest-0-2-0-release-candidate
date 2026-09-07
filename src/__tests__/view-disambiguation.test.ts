import { describe, expect, it } from 'vitest'
import { findRelationshipCandidates, type RelationshipInfo } from '../relationships.js'

const tableToView: RelationshipInfo = {
  sourceTable: 'projects', targetTable: 'clients_view', constraintName: 'projects_client_id_fkey',
  cardinality: 'many-to-one', columnPairs: [{ source: 'client_id', target: 'id' }], self: false,
  sourceIsView: false, targetIsView: true,
}

describe('upstream view relationship disambiguation', () => {
  it('allows a view relationship by its target view name', () => {
    expect(findRelationshipCandidates([tableToView], 'projects', 'clients_view')).toEqual([tableToView])
  })

  it('does not allow deprecated constraint-as-target or FK-column-as-target when the foreign relation is a view', () => {
    expect(findRelationshipCandidates([tableToView], 'projects', 'projects_client_id_fkey')).toEqual([])
    expect(findRelationshipCandidates([tableToView], 'projects', 'client_id')).toEqual([])
  })

  it('still allows explicit !constraint and !column hints when the foreign relation is a view', () => {
    expect(findRelationshipCandidates([tableToView], 'projects', 'clients_view', 'projects_client_id_fkey')).toEqual([tableToView])
    expect(findRelationshipCandidates([tableToView], 'projects', 'clients_view', 'client_id')).toEqual([tableToView])
    expect(findRelationshipCandidates([tableToView], 'projects', 'clients_view', 'id')).toEqual([tableToView])
  })
})
