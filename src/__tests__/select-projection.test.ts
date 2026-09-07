import { describe, expect, it } from 'vitest'
import { parsePostgRESTSelect } from '../select.js'
import { buildReadPlan } from '../read-plan.js'
import { buildReadSQL } from '../read-sql.js'

describe('upstream select projection grammar', () => {
  it('parses aliases, JSON paths and terminal casts without confusing :: for alias :', () => {
    expect(parsePostgRESTSelect('label:data->>name::text')).toEqual([{
      kind: 'field', name: 'data->>name', alias: 'label', cast: 'text',
    }])
  })

  it('parses field casts before aggregates and aggregate casts after them', () => {
    expect(parsePostgRESTSelect('total:amount::numeric.sum()::bigint')).toEqual([{
      kind: 'field', name: 'amount', alias: 'total', cast: 'numeric', aggregate: 'sum', aggregateCast: 'bigint',
    }])
  })

  it('parses count() as count(*) and preserves an alias', () => {
    expect(parsePostgRESTSelect('total:count()')).toEqual([{
      kind: 'field', name: '*', alias: 'total', aggregate: 'count',
    }])
  })

  it('compiles JSON path projection casts with PostgreSQL JSON operators', () => {
    const plan = buildReadPlan('people', parsePostgRESTSelect('blood:data->>blood_type::text'), [])
    const sql = buildReadSQL(plan, 'public').sql
    expect(sql).toContain('CAST( "pgrst_r_0"."data"->>\'blood_type\' AS text ) AS "blood"')
  })

  it('compiles aggregate projection and groups non-aggregate fields', () => {
    const plan = buildReadPlan('orders', parsePostgRESTSelect('customer_id,total:amount::numeric.sum()::bigint'), [])
    const sql = buildReadSQL(plan, 'public').sql
    expect(sql).toContain('CAST( sum(CAST( "pgrst_r_0"."amount" AS numeric )) AS bigint ) AS "total"')
    expect(sql).toContain('GROUP BY "pgrst_r_0"."customer_id"')
  })

  it('rejects malformed casts and unknown aggregate syntax', () => {
    expect(() => parsePostgRESTSelect('name::')).toThrow()
    expect(() => parsePostgRESTSelect('amount.median()')).toThrow()
  })
})
