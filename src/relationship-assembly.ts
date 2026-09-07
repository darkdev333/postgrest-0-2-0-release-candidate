import type { ManyToManyJunction, RelationshipInfo } from './relationships.js'
import { deriveViewRelationships, qualifiedRelationKey, viewPrimaryKeys, type ViewKeyDependency } from './view-relationships.js'

function subset(values: string[], container: string[]): boolean {
  return values.length > 0 && values.every(value => container.includes(value))
}

function sameRelation(aSchema: string | undefined, aTable: string, bSchema: string | undefined, bTable: string): boolean {
  return aTable === bTable && (!aSchema || !bSchema || aSchema === bSchema)
}

function inverse(relationship: RelationshipInfo): RelationshipInfo | null {
  if (relationship.computed || relationship.cardinality === 'many-to-many') return null
  const cardinality = relationship.cardinality === 'many-to-one'
    ? 'one-to-many' as const
    : relationship.cardinality === 'one-to-many'
      ? 'many-to-one' as const
      : 'one-to-one' as const
  return {
    sourceSchema: relationship.targetSchema,
    sourceTable: relationship.targetTable,
    targetSchema: relationship.sourceSchema,
    targetTable: relationship.sourceTable,
    constraintName: relationship.constraintName,
    cardinality,
    columnPairs: relationship.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
    self: relationship.self,
    sourceIsView: relationship.targetIsView,
    targetIsView: relationship.sourceIsView,
  }
}

export function addInverseRelationships(directRelationships: RelationshipInfo[]): RelationshipInfo[] {
  const result = [...directRelationships]
  for (const relationship of directRelationships) {
    const reversed = inverse(relationship)
    if (reversed) result.push(reversed)
  }
  return result
}

function junctionFor(left: RelationshipInfo, right: RelationshipInfo): ManyToManyJunction {
  return {
    schema: left.sourceSchema,
    table: left.sourceTable,
    sourceConstraint: left.constraintName,
    targetConstraint: right.constraintName,
    sourceColumns: left.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
    targetColumns: right.columnPairs.map(pair => ({ source: pair.source, target: pair.target })),
  }
}

function primaryKeyFor(primaryKeys: Map<string, string[]>, schema: string | undefined, table: string): string[] {
  return primaryKeys.get(qualifiedRelationKey(schema, table)) ?? primaryKeys.get(table) ?? []
}

export function discoverManyToManyRelationships(directRelationships: RelationshipInfo[], primaryKeys: Map<string, string[]>): RelationshipInfo[] {
  const candidates = directRelationships.filter(relationship => !relationship.computed && relationship.cardinality === 'many-to-one')
  const bySource = new Map<string, RelationshipInfo[]>()
  for (const relationship of candidates) {
    const key = qualifiedRelationKey(relationship.sourceSchema, relationship.sourceTable)
    const list = bySource.get(key) ?? []
    list.push(relationship)
    bySource.set(key, list)
  }

  const result: RelationshipInfo[] = []
  for (const relationships of bySource.values()) {
    const junction = relationships[0]
    if (!junction) continue
    const pk = primaryKeyFor(primaryKeys, junction.sourceSchema, junction.sourceTable)
    for (let i = 0; i < relationships.length; i += 1) {
      for (let j = i + 1; j < relationships.length; j += 1) {
        const left = relationships[i]!
        const right = relationships[j]!
        if (left.constraintName === right.constraintName) continue
        const columns = [...left.columnPairs.map(pair => pair.source), ...right.columnPairs.map(pair => pair.source)]
        if (!subset(columns, pk)) continue

        result.push({
          sourceSchema: left.targetSchema,
          sourceTable: left.targetTable,
          targetSchema: right.targetSchema,
          targetTable: right.targetTable,
          constraintName: `${left.constraintName}:${right.constraintName}`,
          cardinality: 'many-to-many',
          columnPairs: [],
          self: sameRelation(left.targetSchema, left.targetTable, right.targetSchema, right.targetTable),
          sourceIsView: left.targetIsView,
          targetIsView: right.targetIsView,
          junction: junctionFor(left, right),
        })
        result.push({
          sourceSchema: right.targetSchema,
          sourceTable: right.targetTable,
          targetSchema: left.targetSchema,
          targetTable: left.targetTable,
          constraintName: `${right.constraintName}:${left.constraintName}`,
          cardinality: 'many-to-many',
          columnPairs: [],
          self: sameRelation(right.targetSchema, right.targetTable, left.targetSchema, left.targetTable),
          sourceIsView: right.targetIsView,
          targetIsView: left.targetIsView,
          junction: junctionFor(right, left),
        })
      }
    }
  }
  return result
}

export function assembleViewAwareRelationships(baseDirectRelationships: RelationshipInfo[], basePrimaryKeys: Map<string, string[]>, dependencies: ViewKeyDependency[]): RelationshipInfo[] {
  const derived = deriveViewRelationships(baseDirectRelationships, dependencies)
  const direct = [...baseDirectRelationships, ...derived]
  const primaryKeys = new Map(basePrimaryKeys)
  for (const [view, columns] of viewPrimaryKeys(dependencies)) primaryKeys.set(view, columns)
  const m2m = discoverManyToManyRelationships(direct, primaryKeys)
  return addInverseRelationships([...direct, ...m2m])
}
