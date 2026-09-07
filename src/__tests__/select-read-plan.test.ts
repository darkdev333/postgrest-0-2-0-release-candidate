import { describe, expect, it } from 'vitest'
import { parsePostgRESTSelect } from '../select.js'
import { buildReadPlan, expandSpreadStars, RelationshipResolutionError } from '../read-plan.js'
import type { RelationshipInfo } from '../relationships.js'

const billing: RelationshipInfo = {
  sourceTable: 'orders', targetTable: 'addresses', constraintName: 'billing',
  cardinality: 'many-to-one', self: false,
  columnPairs: [{ source: 'billing_address_id', target: 'id' }],
}
const shipping: RelationshipInfo = {
  sourceTable: 'orders', targetTable: 'addresses', constraintName: 'shipping',
  cardinality: 'many-to-one', self: false,
  columnPairs: [{ source: 'shipping_address_id', target: 'id' }],
}

describe('PostgREST select/read planning', () => {
  it('parses upstream alias + inner + hint syntax', () => {
    const [embed] = parsePostgRESTSelect('id,bill:addresses!inner!billing(id,city)').filter(n => n.kind === 'embed')
    expect(embed).toMatchObject({ kind: 'embed', relation: 'addresses', alias: 'bill', hint: 'billing', joinType: 'inner' })
    if (embed?.kind === 'embed') {
      expect(embed.children).toEqual([
        { kind: 'field', name: 'id' },
        { kind: 'field', name: 'city' },
      ])
    }
  })

  it('uses PostgREST alias:field semantics for scalar fields', () => {
    expect(parsePostgRESTSelect('display_name:name')).toEqual([
      { kind: 'field', alias: 'display_name', name: 'name' },
    ])
  })


  it('parses casts and aggregate projections into the read AST', () => {
    expect(parsePostgRESTSelect('id::text,total:amount.sum()::numeric,count()')).toEqual([
      { kind: 'field', name: 'id', cast: 'text' },
      { kind: 'field', alias: 'total', name: 'amount', aggregate: 'sum', aggregateCast: 'numeric' },
      { kind: 'field', name: '*', aggregate: 'count' },
    ])
  })

  it('preserves a pre-aggregate cast separately from an aggregate result cast', () => {
    expect(parsePostgRESTSelect('total:amount::numeric.sum()::text')).toEqual([
      { kind: 'field', alias: 'total', name: 'amount', cast: 'numeric', aggregate: 'sum', aggregateCast: 'text' },
    ])
  })

  it('keeps JSON-path field expressions intact while applying a trailing cast', () => {
    expect(parsePostgRESTSelect('status:data->>status::text')).toEqual([
      { kind: 'field', alias: 'status', name: 'data->>status', cast: 'text' },
    ])
  })

  it('preserves nested embeds as a tree', () => {
    const parsed = parsePostgRESTSelect('*,clients(id,contacts(email))')
    const clients = parsed[1]
    expect(clients).toMatchObject({ kind: 'embed', relation: 'clients' })
    if (clients?.kind === 'embed') expect(clients.children[1]).toMatchObject({ kind: 'embed', relation: 'contacts' })
  })

  it('raises PGRST201 rather than choosing the first ambiguous relationship', () => {
    const parsed = parsePostgRESTSelect('addresses(*)')
    expect(() => buildReadPlan('orders', parsed, [billing, shipping])).toThrowError(RelationshipResolutionError)
    try { buildReadPlan('orders', parsed, [billing, shipping]) }
    catch (error) { expect(error).toMatchObject({ code: 'PGRST201', sourceTable: 'orders', targetTable: 'addresses' }) }
  })

  it('uses a relationship hint to disambiguate and carries !inner into the plan', () => {
    const plan = buildReadPlan('orders', parsePostgRESTSelect('billing_address:addresses!billing!inner(*)'), [billing, shipping])
    expect(plan.embeds[0]).toMatchObject({ outputName: 'billing_address', joinType: 'inner', relationship: { constraintName: 'billing' } })
  })

  it('raises PGRST200 when no relationship exists', () => {
    expect(() => buildReadPlan('orders', parsePostgRESTSelect('customers(*)'), [billing, shipping])).toThrowError(/Could not find a relationship/)
  })

  it('expands star fields only inside spread relations using schema column order', async () => {
    const plan = buildReadPlan('orders', parsePostgRESTSelect('*,...addresses!billing(*)'), [billing, shipping])
    const calls: string[] = []
    const expanded = await expandSpreadStars(plan, async table => {
      calls.push(table)
      return ['id', 'city', 'country']
    })

    expect(expanded.fields).toEqual([{ kind: 'field', name: '*' }])
    expect(expanded.embeds[0]!.plan.fields).toEqual([
      { kind: 'field', name: 'id' },
      { kind: 'field', name: 'city' },
      { kind: 'field', name: 'country' },
    ])
    expect(calls).toEqual(['addresses'])
  })

  it('expands nested spread stars independently while leaving non-spread star objects intact', async () => {
    const addressToCountry: RelationshipInfo = {
      sourceTable: 'addresses', targetTable: 'countries', constraintName: 'addresses_country_id_fkey',
      cardinality: 'many-to-one', self: false,
      columnPairs: [{ source: 'country_id', target: 'id' }],
    }
    const addressToZones: RelationshipInfo = {
      sourceTable: 'addresses', targetTable: 'zones', constraintName: 'zones_address_id_fkey',
      cardinality: 'one-to-many', self: false,
      columnPairs: [{ source: 'id', target: 'address_id' }],
    }
    const plan = buildReadPlan(
      'orders',
      parsePostgRESTSelect('...addresses!billing(id,countries(*),...zones(*))'),
      [billing, shipping, addressToCountry, addressToZones],
    )
    const columns: Record<string, string[]> = {
      addresses: ['id', 'city'],
      countries: ['id', 'name'],
      zones: ['id', 'label'],
    }
    const expanded = await expandSpreadStars(plan, async table => columns[table] ?? [])
    const address = expanded.embeds[0]!.plan

    expect(address.fields).toEqual([{ kind: 'field', name: 'id' }])
    expect(address.embeds[0]!.plan.fields).toEqual([{ kind: 'field', name: '*' }])
    expect(address.embeds[1]!.plan.fields).toEqual([
      { kind: 'field', name: 'id' },
      { kind: 'field', name: 'label' },
    ])
  })
})
