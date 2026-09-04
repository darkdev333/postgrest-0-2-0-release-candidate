import { describe, expect, it } from 'vitest'
import { applyReadQueryParams, ReadQueryPathError } from '../read-query.js'
import type { ReadPlan } from '../read-plan.js'

function plan(): ReadPlan {
  return {
    table: 'tickets',
    fields: [{ kind: 'field', name: '*' }],
    filters: [], order: [],
    embeds: [{
      relation: 'clients', outputName: 'client', joinType: 'left', spread: false,
      relationship: { sourceTable: 'tickets', targetTable: 'clients', constraintName: 'tickets_client_id_fkey', cardinality: 'many-to-one', self: false, columnPairs: [{ source: 'client_id', target: 'id' }] },
      plan: { table: 'clients', fields: [{ kind: 'field', name: '*' }], embeds: [], filters: [], order: [] },
    }],
  }
}

describe('read query modifier paths', () => {
  it('keeps root filters/order/range on the root node', () => {
    const out = applyReadQueryParams(plan(), new URLSearchParams('status=eq.open&order=id.desc&limit=10&offset=2'))
    expect(out.filters?.[0]).toMatchObject({ column: 'status', operator: 'eq', value: 'open' })
    expect(out.order).toEqual([{ column: 'id', direction: 'desc' }])
    expect(out.limit).toBe(10)
    expect(out.offset).toBe(2)
  })

  it('routes alias-prefixed filters/order/ranges to the embedded plan', () => {
    const out = applyReadQueryParams(plan(), new URLSearchParams('client.name=ilike.A*&client.order=name.asc&client.limit=3'))
    expect(out.embeds[0]?.plan.filters?.[0]).toMatchObject({ column: 'name', operator: 'ilike', value: 'A*' })
    expect(out.embeds[0]?.plan.order).toEqual([{ column: 'name', direction: 'asc' }])
    expect(out.embeds[0]?.plan.limit).toBe(3)
    expect(out.filters).toHaveLength(0)
  })

  it('returns PGRST108 state for a path not present in select', () => {
    expect(() => applyReadQueryParams(plan(), new URLSearchParams('messages.id=eq.1'))).toThrowError(ReadQueryPathError)
    try { applyReadQueryParams(plan(), new URLSearchParams('messages.id=eq.1')) }
    catch (error) { expect(error).toMatchObject({ code: 'PGRST108', resource: 'messages' }) }
  })

  it('requires an embed alias when the selected relationship has one', () => {
    try { applyReadQueryParams(plan(), new URLSearchParams('clients.id=eq.1')) }
    catch (error) {
      expect(error).toMatchObject({
        code: 'PGRST108',
        resource: 'clients',
        detailsText: 'Target names are not allowed in filters if they have an alias',
      })
    }
  })
})
