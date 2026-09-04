import { describe, expect, it } from 'vitest'
import { applyReadQueryParams, ReadQueryPathError, RelatedOrderError } from '../read-query.js'
import { buildReadSQL } from '../read-sql.js'
import type { ReadPlan } from '../read-plan.js'

function basePlan(cardinality: 'many-to-one' | 'one-to-many' = 'many-to-one', alias = 'clients'): ReadPlan {
  return {
    table: 'projects',
    fields: [{ kind: 'field', name: 'id' }],
    filters: [], order: [],
    embeds: [{
      relation: 'clients', outputName: alias, joinType: 'left', spread: false,
      relationship: {
        sourceTable: 'projects', targetTable: 'clients', constraintName: 'projects_client_id_fkey',
        cardinality, self: false, columnPairs: [{ source: 'client_id', target: 'id' }],
      },
      plan: { table: 'clients', fields: [{ kind: 'field', name: 'name' }], embeds: [], filters: [], order: [] },
    }],
  }
}

describe('upstream-related ordering', () => {
  it('parses to-one related order and preserves ordinary terms', () => {
    const out = applyReadQueryParams(basePlan(), new URLSearchParams('order=clients(name).desc.nullsfirst,id.asc'))
    expect(out.order).toEqual([
      { relation: 'clients', column: 'name', direction: 'desc', nullsFirst: true },
      { column: 'id', direction: 'asc' },
    ])
  })

  it('uses the selected alias, not the relationship target name', () => {
    const out = applyReadQueryParams(basePlan('many-to-one', 'client'), new URLSearchParams('order=client(name).asc'))
    expect(out.order?.[0]).toMatchObject({ relation: 'client', column: 'name' })
    expect(() => applyReadQueryParams(basePlan('many-to-one', 'client'), new URLSearchParams('order=clients(name).asc'))).toThrow(ReadQueryPathError)
  })

  it('rejects related ordering across a to-many relationship with PGRST118 state', () => {
    expect(() => applyReadQueryParams(basePlan('one-to-many'), new URLSearchParams('order=clients(name)'))).toThrow(RelatedOrderError)
    try { applyReadQueryParams(basePlan('one-to-many'), new URLSearchParams('order=clients(name)')) }
    catch (error) { expect(error).toMatchObject({ code: 'PGRST118', parent: 'projects', resource: 'clients' }) }
  })

  it('compiles related ordering against the lateral to-one alias', () => {
    const plan = applyReadQueryParams(basePlan(), new URLSearchParams('order=clients(name).desc.nullsfirst'))
    const built = buildReadSQL(plan, 'public')
    expect(built.sql).toMatch(/LEFT JOIN LATERAL/)
    expect(built.sql).toMatch(/ORDER BY "pgrst_e_\d+"\."name" DESC NULLS FIRST/)
  })

  it('compiles upstream json-path related ordering', () => {
    const plan = applyReadQueryParams(basePlan(), new URLSearchParams('order=clients(jsonb_col->key).asc'))
    const built = buildReadSQL(plan, 'public')
    expect(built.sql).toMatch(/ORDER BY "pgrst_e_\d+"\."jsonb_col"->'key' ASC/)
  })

  it('supports related ordering inside an embedded read plan', () => {
    const nested: ReadPlan = {
      table: 'users', fields: [{ kind: 'field', name: 'name' }], filters: [], order: [], embeds: [{
        relation: 'tasks', outputName: 'tasks', joinType: 'left', spread: false,
        relationship: { sourceTable: 'users', targetTable: 'tasks', constraintName: 'tasks_user_id_fkey', cardinality: 'one-to-many', self: false, columnPairs: [{ source: 'id', target: 'user_id' }] },
        plan: {
          table: 'tasks', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [], embeds: [{
            relation: 'projects', outputName: 'projects', joinType: 'left', spread: false,
            relationship: { sourceTable: 'tasks', targetTable: 'projects', constraintName: 'tasks_project_id_fkey', cardinality: 'many-to-one', self: false, columnPairs: [{ source: 'project_id', target: 'id' }] },
            plan: { table: 'projects', fields: [{ kind: 'field', name: 'id' }], embeds: [], filters: [], order: [] },
          }],
        },
      }],
    }
    const out = applyReadQueryParams(nested, new URLSearchParams('tasks.order=projects(id).desc'))
    expect(out.embeds[0]?.plan.order?.[0]).toMatchObject({ relation: 'projects', column: 'id', direction: 'desc' })
  })
})
