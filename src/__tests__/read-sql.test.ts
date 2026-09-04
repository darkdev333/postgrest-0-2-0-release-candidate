import { describe, expect, it } from 'vitest'
import { buildReadCountSQL, buildReadSQL } from '../read-sql.js'
import type { ReadPlan } from '../read-plan.js'

const baseRel = {
  sourceTable: 'tickets', targetTable: 'clients', constraintName: 'tickets_client_id_fkey',
  cardinality: 'many-to-one' as const, self: false,
  columnPairs: [{ source: 'client_id', target: 'id' }],
}

describe('embedded read SQL', () => {
  it('shapes many-to-one embeds as JSON objects through a lateral join', () => {
    const plan: ReadPlan = {
      table: 'tickets', fields: [{ kind: 'field', name: '*' }], filters: [], order: [],
      embeds: [{ relation: 'clients', outputName: 'clients', joinType: 'left', spread: false, relationship: baseRel,
        plan: { table: 'clients', fields: [{ kind: 'field', name: '*' }], embeds: [], filters: [], order: [] } }],
    }
    const sql = buildReadSQL(plan, 'public').sql
    expect(sql).toContain('LEFT JOIN LATERAL')
    expect(sql).toContain('row_to_json')
    expect(sql).toContain('"pgrst_r_0"."client_id" = "pgrst_r_1"."id"')
    expect(sql).toContain('AS "clients"')
  })

  it('shapes one-to-many embeds as JSON arrays', () => {
    const plan: ReadPlan = {
      table: 'clients', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [],
      embeds: [{ relation: 'tickets', outputName: 'tickets', joinType: 'left', spread: false,
        relationship: { sourceTable: 'clients', targetTable: 'tickets', constraintName: 'tickets_client_id_fkey', cardinality: 'one-to-many', self: false, columnPairs: [{ source: 'id', target: 'client_id' }] },
        plan: { table: 'tickets', fields: [{ kind: 'field', name: 'id' }], embeds: [], filters: [], order: [] } }],
    }
    const sql = buildReadSQL(plan, 'public').sql
    expect(sql).toContain('json_agg')
    expect(sql).toContain('COALESCE(')
    expect(sql).toContain("'[]'::jsonb")
  })

  it('uses INNER JOIN LATERAL for !inner', () => {
    const plan: ReadPlan = {
      table: 'tickets', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [],
      embeds: [{ relation: 'clients', outputName: 'clients', joinType: 'inner', spread: false, relationship: baseRel,
        plan: { table: 'clients', fields: [{ kind: 'field', name: 'id' }], embeds: [], filters: [], order: [] } }],
    }
    expect(buildReadSQL(plan).sql).toContain('INNER JOIN LATERAL')
  })

  it('joins through a junction for many-to-many embeds', () => {
    const plan: ReadPlan = {
      table: 'users', fields: [{ kind: 'field', name: 'id' }], filters: [], order: [],
      embeds: [{ relation: 'teams', outputName: 'teams', joinType: 'left', spread: false,
        relationship: { sourceTable: 'users', targetTable: 'teams', constraintName: 'memberships_user_id_fkey:memberships_team_id_fkey', cardinality: 'many-to-many', self: false, columnPairs: [],
          junction: { table: 'memberships', sourceConstraint: 'memberships_user_id_fkey', targetConstraint: 'memberships_team_id_fkey', sourceColumns: [{ source: 'id', target: 'user_id' }], targetColumns: [{ source: 'team_id', target: 'id' }] } },
        plan: { table: 'teams', fields: [{ kind: 'field', name: '*' }], embeds: [], filters: [], order: [] } }],
    }
    const sql = buildReadSQL(plan, 'public').sql
    expect(sql).toContain('JOIN "public"."memberships"')
    expect(sql).toContain('"team_id"')
    expect(sql).toContain('"user_id"')
  })

  it('applies parameterized root and embedded filters/order/ranges to their nodes', () => {
    const plan: ReadPlan = {
      table: 'tickets', fields: [{ kind: 'field', name: 'id' }],
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      order: [{ column: 'id', direction: 'desc' }], limit: 10, offset: 5,
      embeds: [{ relation: 'clients', outputName: 'clients', joinType: 'left', spread: false, relationship: baseRel,
        plan: {
          table: 'clients', fields: [{ kind: 'field', name: 'name' }], embeds: [],
          filters: [{ column: 'name', operator: 'ilike', value: 'A*' }],
          order: [{ column: 'name', direction: 'asc' }], limit: 2, offset: 1,
        } }],
    }
    const built = buildReadSQL(plan, 'public')
    expect(built.params).toEqual(['A%', 'open'])
    expect(built.sql).toContain('"pgrst_r_1"."name" ILIKE $1')
    expect(built.sql).toContain('ORDER BY "pgrst_r_1"."name" ASC LIMIT 2 OFFSET 1')
    expect(built.sql).toContain('"pgrst_r_0"."status" = $2')
    expect(built.sql).toContain('ORDER BY "pgrst_r_0"."id" DESC LIMIT 10 OFFSET 5')
  })

  it('formats JSON path filters with PostgreSQL arrow operators instead of quoting the whole path', () => {
    const plan: ReadPlan = {
      table: 'people', fields: [{ kind: 'field', name: 'id' }], embeds: [], order: [],
      filters: [{ column: 'json_data->>blood_type', operator: 'eq', value: 'A-' }],
    }
    const built = buildReadSQL(plan, 'public')
    expect(built.sql).toContain('"pgrst_r_0"."json_data"->>\'blood_type\' = $1')
    expect(built.sql).not.toContain('"json_data->>blood_type"')
    expect(built.params).toEqual(['A-'])
  })

  it('preserves mixed JSON object and array path operators in filters and order terms', () => {
    const plan: ReadPlan = {
      table: 'people', fields: [{ kind: 'field', name: 'id' }], embeds: [],
      filters: [{ column: 'json_data->phones->0->>number', operator: 'eq', value: '555-0100' }],
      order: [{ column: 'json_data->phones->0->>number', direction: 'asc' }],
    }
    const built = buildReadSQL(plan)
    const path = '"pgrst_r_0"."json_data"->\'phones\'->0->>\'number\''
    expect(built.sql).toContain(`${path} = $1`)
    expect(built.sql).toContain(`ORDER BY ${path} ASC`)
    expect(built.params).toEqual(['555-0100'])
  })

  it('formats JSON path fields inside recursively nested logical filters', () => {
    const plan: ReadPlan = {
      table: 'people', fields: [{ kind: 'field', name: 'id' }], embeds: [], filters: [], order: [],
      logic: [{
        kind: 'logic', operator: 'or', negate: false,
        terms: [
          { kind: 'filter', filter: { column: 'json_data->>blood_type', operator: 'eq', value: 'A-' } },
          { kind: 'logic', operator: 'and', negate: true, terms: [
            { kind: 'filter', filter: { column: 'json_data->phones->0->>number', operator: 'like', value: '555*' } },
          ] },
        ],
      }],
    }
    const built = buildReadSQL(plan)
    expect(built.sql).toContain('"pgrst_r_0"."json_data"->>\'blood_type\' = $1')
    expect(built.sql).toContain('"pgrst_r_0"."json_data"->\'phones\'->0->>\'number\' LIKE $2')
    expect(built.sql).toContain('NOT (')
    expect(built.params).toEqual(['A-', '555%'])
  })

  it('builds an exact count without root/embedded ranges', () => {
    const plan: ReadPlan = {
      table: 'tickets', fields: [{ kind: 'field', name: 'id' }], embeds: [],
      filters: [{ column: 'status', operator: 'eq', value: 'open' }], order: [{ column: 'id', direction: 'desc' }], limit: 2, offset: 10,
    }
    const built = buildReadCountSQL(plan)
    expect(built.sql).toContain('SELECT COUNT(*) AS count FROM (SELECT')
    expect(built.sql).not.toContain('LIMIT 2')
    expect(built.sql).not.toContain('OFFSET 10')
    expect(built.sql).not.toContain('ORDER BY')
    expect(built.params).toEqual(['open'])
  })
})
