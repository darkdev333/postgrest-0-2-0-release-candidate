import { describe, expect, it } from 'vitest'
import { relationshipsFromComputedRows } from '../relationship-cache.js'
import { findRelationshipCandidates, type RelationshipInfo } from '../relationships.js'
import { parsePostgRESTSelect } from '../select.js'
import { buildReadPlan } from '../read-plan.js'
import { buildReadSQL } from '../read-sql.js'

describe('upstream computed relationship parity', () => {
  it('uses not-proretset/prorows=1 metadata to distinguish to-one from to-many', () => {
    const relationships = relationshipsFromComputedRows([
      { function_schema: 'public', function_name: 'director', source_table: 'films', target_table: 'directors', single_row: true },
      { function_schema: 'public', function_name: 'premieres', source_table: 'films', target_table: 'premieres', single_row: false },
    ])

    expect(relationships[0]).toMatchObject({
      sourceTable: 'films', targetTable: 'directors', cardinality: 'one-to-one',
      computed: { functionName: 'director', functionSchema: 'public' },
    })
    expect(relationships[1]).toMatchObject({
      sourceTable: 'films', targetTable: 'premieres', cardinality: 'one-to-many',
      computed: { functionName: 'premieres', functionSchema: 'public' },
    })
  })

  it('marks recursive computed relationships as self relationships', () => {
    const [relationship] = relationshipsFromComputedRows([
      { function_schema: 'public', function_name: 'supervisor', source_table: 'employees', target_table: 'employees', single_row: true },
    ])
    expect(relationship).toMatchObject({ self: true, cardinality: 'one-to-one' })
  })

  it('lets a computed function selector override an automatically detected relationship selector', () => {
    const detected: RelationshipInfo = {
      sourceTable: 'films', targetTable: 'directors', constraintName: 'films_director_id_fkey',
      cardinality: 'many-to-one', self: false, columnPairs: [{ source: 'director_id', target: 'id' }],
    }
    const computed = relationshipsFromComputedRows([
      { function_schema: 'api', function_name: 'directors', source_table: 'films', target_table: 'directors', single_row: false },
    ])[0]!

    const candidates = findRelationshipCandidates([detected, computed], 'films', 'directors')
    expect(candidates).toEqual([computed])
  })

  it('plans and compiles computed to-one embeds as a lateral function call on the parent row', () => {
    const [relationship] = relationshipsFromComputedRows([
      { function_schema: 'api', function_name: 'director', source_table: 'films', target_table: 'directors', single_row: true },
    ])
    const plan = buildReadPlan('films', parsePostgRESTSelect('id,director(id,name)'), [relationship!])
    const built = buildReadSQL(plan, 'public')

    expect(built.sql).toContain('LEFT JOIN LATERAL')
    expect(built.sql).toContain('"api"."director"("pgrst_r_0"::"public"."films")')
    expect(built.sql).toContain('row_to_json')
  })

  it('plans and compiles computed to-many embeds as arrays', () => {
    const [relationship] = relationshipsFromComputedRows([
      { function_schema: 'api', function_name: 'premieres', source_table: 'films', target_table: 'premieres', single_row: false },
    ])
    const plan = buildReadPlan('films', parsePostgRESTSelect('id,premieres(id,name)'), [relationship!])
    const built = buildReadSQL(plan, 'public')

    expect(built.sql).toContain('"api"."premieres"("pgrst_r_0"::"public"."films")')
    expect(built.sql).toContain('json_agg')
    expect(built.sql).toContain("'[]'::jsonb")
  })
})
