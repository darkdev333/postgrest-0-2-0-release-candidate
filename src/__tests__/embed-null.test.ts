import { describe, expect, it } from 'vitest'
import { applyReadQueryParams } from '../read-query.js'
import { buildReadCountSQL, buildReadSQL } from '../read-sql.js'
import type { ReadPlan } from '../read-plan.js'

function plan(cardinality: 'many-to-one' | 'one-to-many' | 'many-to-many' = 'many-to-one', alias = 'clients'): ReadPlan {
  const relationship: any = {
    sourceTable: 'projects', targetTable: 'clients', constraintName: 'projects_client_id_fkey',
    cardinality, self: false, columnPairs: [{ source: 'client_id', target: 'id' }],
  }
  if (cardinality === 'many-to-many') relationship.junction = {
    table: 'project_clients', sourceConstraint: 'pc_project_fkey', targetConstraint: 'pc_client_fkey',
    sourceColumns: [{ source: 'id', target: 'project_id' }],
    targetColumns: [{ source: 'client_id', target: 'id' }],
  }
  return {
    table: 'projects', fields: [{ kind: 'field', name: 'name' }], filters: [], order: [], embedNullFilters: [],
    embeds: [{ relation: 'clients', outputName: alias, joinType: 'left', spread: false, relationship,
      plan: { table: 'clients', fields: [], embeds: [], filters: [], order: [], embedNullFilters: [] } }],
  }
}

describe('upstream embed null existence filters', () => {
  it('rewrites selected embed not.is.null to lateral existence predicate', () => {
    const out = applyReadQueryParams(plan(), new URLSearchParams('clients=not.is.null'))
    expect(out.embedNullFilters).toEqual([{ resource: 'clients', negate: true }])
    expect(out.filters).toEqual([])
    expect(buildReadSQL(out, 'public').sql).toMatch(/"pgrst_e_\d+" IS DISTINCT FROM NULL/)
  })

  it('rewrites selected embed is.null to lateral non-existence predicate', () => {
    const out = applyReadQueryParams(plan('one-to-many'), new URLSearchParams('clients=is.null'))
    expect(out.embedNullFilters).toEqual([{ resource: 'clients', negate: false }])
    expect(buildReadSQL(out, 'public').sql).toMatch(/"pgrst_e_\d+" IS NOT DISTINCT FROM NULL/)
  })

  it('uses aliases for embed null predicates', () => {
    const out = applyReadQueryParams(plan('many-to-one', 'client'), new URLSearchParams('client=not.is.null'))
    expect(out.embedNullFilters).toEqual([{ resource: 'client', negate: true }])
  })

  it('does not reinterpret a same-name ordinary non-null filter', () => {
    const out = applyReadQueryParams(plan(), new URLSearchParams('clients=eq.3'))
    expect(out.embedNullFilters).toEqual([])
    expect(out.filters?.[0]).toMatchObject({ column: 'clients', operator: 'eq', value: 3 })
  })

  it('supports nested embed existence predicates', () => {
    const root = plan('one-to-many')
    root.embeds[0]!.plan.embeds.push({
      relation: 'contacts', outputName: 'contacts', joinType: 'left', spread: false,
      relationship: { sourceTable: 'clients', targetTable: 'contacts', constraintName: 'contacts_client_fkey', cardinality: 'one-to-many', self: false, columnPairs: [{ source: 'id', target: 'client_id' }] },
      plan: { table: 'contacts', fields: [], embeds: [], filters: [], order: [], embedNullFilters: [] },
    })
    const out = applyReadQueryParams(root, new URLSearchParams('clients.contacts=not.is.null&clients=not.is.null'))
    expect(out.embedNullFilters).toEqual([{ resource: 'clients', negate: true }])
    expect(out.embeds[0]!.plan.embedNullFilters).toEqual([{ resource: 'contacts', negate: true }])
    const sql = buildReadSQL(out, 'public').sql
    expect((sql.match(/IS DISTINCT FROM NULL/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('preserves embed existence filtering in exact count SQL', () => {
    const out = applyReadQueryParams(plan('many-to-many'), new URLSearchParams('clients=not.is.null'))
    expect(buildReadCountSQL(out, 'public').sql).toMatch(/IS DISTINCT FROM NULL/)
  })
})
