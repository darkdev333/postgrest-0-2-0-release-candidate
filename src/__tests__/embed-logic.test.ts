import { describe, expect, it } from 'vitest'
import { applyReadQueryParams } from '../read-query.js'
import { buildReadCountSQL, buildReadSQL } from '../read-sql.js'
import type { ReadPlan } from '../read-plan.js'

function twoEmbeds(): ReadPlan {
  const child = (name: string): any => ({
    relation: name, outputName: name, joinType: 'left', spread: false,
    relationship: { sourceTable: 'client', targetTable: name, constraintName: `client_${name}_fkey`, cardinality: 'many-to-one', self: false, columnPairs: [{ source: `${name}_id`, target: 'id' }] },
    plan: { table: name, fields: [], embeds: [], filters: [], order: [], embedNullFilters: [], logic: [] },
  })
  return { table: 'client', fields: [{ kind: 'field', name: '*' }], filters: [], order: [], embedNullFilters: [], logic: [], embeds: [child('clientinfo'), child('contact')] }
}

describe('upstream logic across embedded resources', () => {
  it('rewrites sibling embed null predicates inside OR while keeping child filters on children', () => {
    const params = new URLSearchParams('clientinfo.other=ilike.*main*&contact.name=ilike.*tabby*&or=(clientinfo.not.is.null,contact.not.is.null)')
    const out = applyReadQueryParams(twoEmbeds(), params)
    expect(out.embeds[0]!.plan.filters?.[0]).toMatchObject({ column: 'other', operator: 'ilike' })
    expect(out.embeds[1]!.plan.filters?.[0]).toMatchObject({ column: 'name', operator: 'ilike' })
    expect(out.logic).toEqual([{ kind: 'logic', operator: 'or', negate: false, terms: [
      { kind: 'embed-null', resource: 'clientinfo', negate: true },
      { kind: 'embed-null', resource: 'contact', negate: true },
    ] }])
    const built = buildReadSQL(out, 'public')
    expect(built.params).toEqual(['%main%', '%tabby%'])
    expect(built.sql).toMatch(/\("pgrst_e_\d+" IS DISTINCT FROM NULL OR "pgrst_e_\d+" IS DISTINCT FROM NULL\)/)
  })

  it('keeps ordinary column predicates inside logical expressions ordinary', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('or=(id.eq.1,clientinfo.not.is.null)'))
    expect(out.logic?.[0]).toMatchObject({ kind: 'logic', operator: 'or' })
    const sql = buildReadSQL(out, 'public').sql
    expect(sql).toMatch(/"pgrst_r_0"\."id" = \$1/)
    expect(sql).toMatch(/IS DISTINCT FROM NULL/)
  })

  it('preserves cross-embed logic in exact count SQL', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('or=(clientinfo.not.is.null,contact.not.is.null)'))
    const sql = buildReadCountSQL(out, 'public').sql
    expect(sql).toContain(' OR ')
    expect((sql.match(/IS DISTINCT FROM NULL/g) ?? []).length).toBe(2)
  })

  it('parses recursively nested AND groups like upstream AndOrParamsSpec', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('or=(and(name.eq.entity 2,id.eq.2),and(name.eq.entity 1,id.eq.1))'))
    expect(out.logic?.[0]).toMatchObject({
      kind: 'logic', operator: 'or', negate: false,
      terms: [
        { kind: 'logic', operator: 'and', negate: false },
        { kind: 'logic', operator: 'and', negate: false },
      ],
    })
    const built = buildReadSQL(out, 'public')
    expect(built.params).toEqual(['entity 2', 2, 'entity 1', 1])
    expect(built.sql).toContain(' OR ')
    expect((built.sql.match(/ AND /g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('parses nested negated logical groups like upstream AndOrParamsSpec', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('or=(not.and(name.eq.entity 2,id.eq.2),not.and(name.eq.entity 1,id.eq.1))'))
    expect(out.logic?.[0]).toMatchObject({
      kind: 'logic', operator: 'or',
      terms: [
        { kind: 'logic', operator: 'and', negate: true },
        { kind: 'logic', operator: 'and', negate: true },
      ],
    })
    const built = buildReadSQL(out, 'public')
    expect((built.sql.match(/NOT \(/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('supports a negated logical operator in the query key', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('not.and=(id.gte.1,id.lte.3)'))
    expect(out.logic?.[0]).toMatchObject({ kind: 'logic', operator: 'and', negate: true })
    const built = buildReadSQL(out, 'public')
    expect(built.params).toEqual([1, 3])
    expect(built.sql).toContain('NOT (')
  })

  it('routes embedded-path negated logical operators through selected aliases', () => {
    const aliased = twoEmbeds()
    aliased.embeds[0]!.outputName = 'info'
    const out = applyReadQueryParams(aliased, new URLSearchParams('info.not.or=(other.eq.main,other.eq.backup)'))
    expect(out.embeds[0]!.plan.logic?.[0]).toMatchObject({ kind: 'logic', operator: 'or', negate: true })
    const built = buildReadSQL(out, 'public')
    expect(built.params).toEqual(['main', 'backup'])
    expect(built.sql).toContain('NOT (')
  })

  it('keeps quoted commas and PostgreSQL array commas inside logical values', () => {
    const out = applyReadQueryParams(twoEmbeds(), new URLSearchParams('or=(name.eq."Doe, John",tags.cs.{a,b})'))
    expect(out.logic?.[0]).toMatchObject({
      kind: 'logic', operator: 'or',
      terms: [
        { kind: 'filter', filter: { column: 'name', operator: 'eq', value: 'Doe, John' } },
        { kind: 'filter', filter: { column: 'tags', operator: 'cs', value: '{a,b}' } },
      ],
    })
  })
})
