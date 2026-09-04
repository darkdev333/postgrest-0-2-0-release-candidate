import { describe, expect, it } from 'vitest'
import { buildReadSQL } from '../read-sql.js'
import type { ReadPlan } from '../read-plan.js'

const manyToOne = {
  sourceTable: 'projects', targetTable: 'clients', constraintName: 'projects_client_id_fkey',
  cardinality: 'many-to-one' as const, self: false,
  columnPairs: [{ source: 'client_id', target: 'id' }],
}
const oneToMany = {
  sourceTable: 'factories', targetTable: 'processes', constraintName: 'processes_factory_id_fkey',
  cardinality: 'one-to-many' as const, self: false,
  columnPairs: [{ source: 'id', target: 'factory_id' }],
}

function child(table: string, fields: any[], embeds: any[] = []): ReadPlan {
  return { table, fields, embeds, filters: [], order: [], logic: [], embedNullFilters: [] }
}

describe('upstream spread SQL semantics', () => {
  it('flattens a to-one field and honors its alias', () => {
    const plan: ReadPlan = {
      table: 'projects', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [],
      embeds: [{
        relation: 'clients', outputName: 'clients', joinType: 'left', spread: true, relationship: manyToOne,
        plan: child('clients', [{ kind: 'field', name: 'name', alias: 'client_name' }]),
      }],
    }
    const sql = buildReadSQL(plan).sql
    expect(sql).toContain('"pgrst_e_2"."client_name" AS "client_name"')
    expect(sql).not.toContain('AS "clients"')
  })

  it('aggregates each to-many spread field into its own JSON array', () => {
    const plan: ReadPlan = {
      table: 'factories', fields: [{ kind: 'field', name: 'name', alias: 'factory' }], filters: [], order: [],
      embeds: [{
        relation: 'processes', outputName: 'processes', joinType: 'left', spread: true, relationship: oneToMany,
        plan: child('processes', [{ kind: 'field', name: 'name' }, { kind: 'field', name: 'category_id', alias: 'categories' }]),
      }],
    }
    const sql = buildReadSQL(plan).sql
    expect(sql).toContain('json_agg("pgrst_a_3"."name")::jsonb AS "name"')
    expect(sql).toContain('json_agg("pgrst_a_3"."categories")::jsonb AS "categories"')
    expect(sql).toContain('COALESCE("pgrst_e_2"."name", \'[]\'::jsonb) AS "name"')
    expect(sql).toContain('COALESCE("pgrst_e_2"."categories", \'[]\'::jsonb) AS "categories"')
  })

  it('includes nested non-spread embed outputs as array elements when the parent is spread to-many', () => {
    const oneToOne = {
      sourceTable: 'processes', targetTable: 'process_costs', constraintName: 'cost_fk',
      cardinality: 'one-to-one' as const, self: false,
      columnPairs: [{ source: 'id', target: 'process_id' }],
    }
    const nested = {
      relation: 'process_costs', outputName: 'process_costs', joinType: 'left' as const, spread: false, relationship: oneToOne,
      plan: child('process_costs', [{ kind: 'field', name: 'cost' }]),
    }
    const plan: ReadPlan = {
      table: 'factories', fields: [{ kind: 'field', name: 'name' }], filters: [], order: [],
      embeds: [{
        relation: 'processes', outputName: 'processes', joinType: 'left', spread: true, relationship: oneToMany,
        plan: child('processes', [{ kind: 'field', name: 'name', alias: 'process' }], [nested]),
      }],
    }
    const sql = buildReadSQL(plan).sql
    expect(sql).toMatch(/json_agg\("pgrst_a_\d+"\."process_costs"\)::jsonb AS "process_costs"/)
  })

  it('rejects spread star until schema-backed column expansion exists', () => {
    const plan: ReadPlan = {
      table: 'projects', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [],
      embeds: [{
        relation: 'clients', outputName: 'clients', joinType: 'left', spread: true, relationship: manyToOne,
        plan: child('clients', [{ kind: 'field', name: '*' }]),
      }],
    }
    expect(() => buildReadSQL(plan)).toThrow('schema-backed field expansion')
  })
})
