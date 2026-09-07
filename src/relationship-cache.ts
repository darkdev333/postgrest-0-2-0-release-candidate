import type { RelationshipInfo } from './relationships.js'
import { assembleViewAwareRelationships } from './relationship-assembly.js'
import { VIEW_KEY_DEPENDENCIES_SQL, viewDependenciesFromCatalogRows } from './view-relationship-catalog.js'
import { qualifiedRelationKey } from './view-relationships.js'

export { VIEW_KEY_DEPENDENCIES_SQL, viewDependenciesFromCatalogRows } from './view-relationship-catalog.js'

export interface RelationshipQueryResult { rows: Record<string, unknown>[] }
export interface RelationshipCacheOptions {
  schema?: string
  extraSearchPath?: string[]
  cacheTTL?: number
  queryFn: (sql: string, params?: unknown[]) => Promise<RelationshipQueryResult>
}

export const RELATIONSHIPS_SQL = `
WITH fk_constraints AS (
  SELECT
    src_ns.nspname AS source_schema,
    src.relname AS source_table,
    tgt_ns.nspname AS target_schema,
    tgt.relname AS target_table,
    con.conname AS constraint_name,
    array_agg(src_att.attname ORDER BY key_cols.ord) AS source_columns,
    array_agg(tgt_att.attname ORDER BY key_cols.ord) AS target_columns,
    EXISTS (
      SELECT 1
      FROM pg_constraint uq
      WHERE uq.conrelid = con.conrelid
        AND uq.contype IN ('p','u')
        AND (SELECT array_agg(x ORDER BY x) FROM unnest(uq.conkey) AS x)
          = (SELECT array_agg(x ORDER BY x) FROM unnest(con.conkey) AS x)
    ) AS source_unique,
    COALESCE((
      SELECT array_agg(pk_att.attname ORDER BY pk_key.ord)
      FROM pg_constraint pk
      CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY AS pk_key(attnum, ord)
      JOIN pg_attribute pk_att ON pk_att.attrelid = pk.conrelid AND pk_att.attnum = pk_key.attnum
      WHERE pk.conrelid = con.conrelid AND pk.contype = 'p'
    ), ARRAY[]::name[]) AS source_primary_key
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS key_cols(src_attnum, tgt_attnum, ord)
  JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = key_cols.src_attnum
  JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = key_cols.tgt_attnum
  WHERE con.contype = 'f'
    AND con.conparentid = 0
  GROUP BY src_ns.nspname, src.relname, tgt_ns.nspname, tgt.relname, con.conname, con.conrelid, con.conkey
)
SELECT source_schema, source_table, target_schema, target_table, constraint_name,
       source_columns, target_columns, source_unique, source_primary_key
FROM fk_constraints
ORDER BY source_table, constraint_name
`

/** Discover PostgREST computed relationships: one-argument functions whose
 * argument is a composite relation type and whose return type is another
 * composite relation type. `ROWS 1` (or a non-SETOF return) marks a to-one
 * relationship, matching upstream's `not proretset or prorows = 1` rule. */
export const COMPUTED_RELATIONSHIPS_SQL = `
WITH all_relations AS (
  SELECT reltype
  FROM pg_class
  WHERE relkind IN ('v','r','m','f','p')
)
SELECT
  fn_ns.nspname AS function_schema,
  p.proname AS function_name,
  arg_ns.nspname AS source_schema,
  arg_type.typname AS source_table,
  ret_ns.nspname AS target_schema,
  ret_type.typname AS target_table,
  (NOT p.proretset OR p.prorows = 1) AS single_row
FROM pg_proc p
JOIN pg_namespace fn_ns ON fn_ns.oid = p.pronamespace
JOIN pg_type arg_type ON arg_type.oid = p.proargtypes[0]
JOIN pg_namespace arg_ns ON arg_ns.oid = arg_type.typnamespace
JOIN pg_type ret_type ON ret_type.oid = p.prorettype
JOIN pg_namespace ret_ns ON ret_ns.oid = ret_type.typnamespace
WHERE p.pronargs = 1
  AND p.prokind = 'f'
  AND p.proargtypes[0] IN (SELECT reltype FROM all_relations)
  AND p.prorettype IN (SELECT reltype FROM all_relations)
  AND fn_ns.nspname = $1
  AND arg_ns.nspname = $1
  AND ret_ns.nspname = $1
ORDER BY source_table, function_name
`

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  if (!value.startsWith('{') || !value.endsWith('}')) return value ? [value] : []
  const body = value.slice(1, -1)
  if (!body) return []
  return body.split(',').map(item => item.replace(/^"|"$/g, ''))
}

interface CatalogFK {
  sourceSchema?: string
  sourceTable: string
  targetSchema?: string
  targetTable: string
  constraintName: string
  sourceColumns: string[]
  targetColumns: string[]
  sourceUnique: boolean
  sourcePrimaryKey: string[]
}

function decodeFK(row: Record<string, unknown>): CatalogFK {
  return {
    sourceSchema: row.source_schema == null ? undefined : String(row.source_schema),
    sourceTable: String(row.source_table),
    targetSchema: row.target_schema == null ? undefined : String(row.target_schema),
    targetTable: String(row.target_table),
    constraintName: String(row.constraint_name),
    sourceColumns: textArray(row.source_columns),
    targetColumns: textArray(row.target_columns),
    sourceUnique: row.source_unique === true || row.source_unique === 't' || row.source_unique === 'true',
    sourcePrimaryKey: textArray(row.source_primary_key),
  }
}

function rowBelongsToSchema(schema: string | undefined, sourceSchema?: string, targetSchema?: string): boolean {
  if (!schema) return true
  if (sourceSchema && sourceSchema !== schema) return false
  if (targetSchema && targetSchema !== schema) return false
  return true
}

function baseRelationshipState(rows: Record<string, unknown>[]): {
  direct: RelationshipInfo[]
  primaryKeys: Map<string, string[]>
} {
  const direct: RelationshipInfo[] = []
  const primaryKeys = new Map<string, string[]>()
  for (const fk of rows.map(decodeFK)) {
    const pairs = fk.sourceColumns.map((source, index) => ({ source, target: fk.targetColumns[index] ?? '' }))
    direct.push({
      sourceSchema: fk.sourceSchema,
      sourceTable: fk.sourceTable,
      targetSchema: fk.targetSchema,
      targetTable: fk.targetTable,
      constraintName: fk.constraintName,
      cardinality: fk.sourceUnique ? 'one-to-one' : 'many-to-one',
      columnPairs: pairs,
      self: fk.sourceTable === fk.targetTable && (!fk.sourceSchema || !fk.targetSchema || fk.sourceSchema === fk.targetSchema),
    })
    if (fk.sourcePrimaryKey.length) {
      primaryKeys.set(qualifiedRelationKey(fk.sourceSchema, fk.sourceTable), fk.sourcePrimaryKey)
      if (!primaryKeys.has(fk.sourceTable)) primaryKeys.set(fk.sourceTable, fk.sourcePrimaryKey)
    }
  }
  return { direct, primaryKeys }
}

function relationshipBelongsToSchema(relationship: RelationshipInfo, schema: string | undefined): boolean {
  if (!schema) return true
  if (relationship.sourceSchema && relationship.sourceSchema !== schema) return false
  if (relationship.targetSchema && relationship.targetSchema !== schema) return false
  if (relationship.junction?.schema && relationship.junction.schema !== schema) return false
  return true
}

function filterRelationshipsToSchema(relationships: RelationshipInfo[], exposedSchema?: string): RelationshipInfo[] {
  return relationships.filter(relationship => relationshipBelongsToSchema(relationship, exposedSchema))
}

/** Backwards-compatible table-only relationship assembly. */
export function relationshipsFromCatalogRows(rows: Record<string, unknown>[], exposedSchema?: string): RelationshipInfo[] {
  const { direct, primaryKeys } = baseRelationshipState(rows)
  return filterRelationshipsToSchema(assembleViewAwareRelationships(direct, primaryKeys, []), exposedSchema)
}

/** Upstream-ordered FK/view relationship graph assembly. Internal base FKs are
 * intentionally retained through view derivation, then removed at the end like
 * upstream `removeInternal`; pre-filtering here would lose valid exposed
 * view-to-view relationships derived from private underlying tables. */
export function relationshipsFromCatalogAndViewRows(
  rows: Record<string, unknown>[],
  viewRows: Record<string, unknown>[],
  exposedSchema?: string,
): RelationshipInfo[] {
  const { direct, primaryKeys } = baseRelationshipState(rows)
  const dependencies = viewDependenciesFromCatalogRows(viewRows)
  return filterRelationshipsToSchema(assembleViewAwareRelationships(direct, primaryKeys, dependencies), exposedSchema)
}

export function relationshipsFromComputedRows(rows: Record<string, unknown>[], exposedSchema?: string): RelationshipInfo[] {
  return rows.flatMap(row => {
    const sourceSchema = row.source_schema == null ? undefined : String(row.source_schema)
    const targetSchema = row.target_schema == null ? undefined : String(row.target_schema)
    const functionSchema = row.function_schema == null ? undefined : String(row.function_schema)
    if (!rowBelongsToSchema(exposedSchema, sourceSchema, targetSchema)) return []
    // Upstream's deformed relationship map is looked up by the request schema;
    // a computed relationship function in another schema is therefore not a
    // candidate even when its argument/return relation types are exposed.
    if (exposedSchema && functionSchema && functionSchema !== exposedSchema) return []

    const sourceTable = String(row.source_table)
    const targetTable = String(row.target_table)
    const functionName = String(row.function_name)
    const singleRow = row.single_row === true || row.single_row === 't' || row.single_row === 'true'
    return [{
      sourceSchema,
      sourceTable,
      targetSchema,
      targetTable,
      constraintName: functionName,
      cardinality: singleRow ? 'one-to-one' as const : 'one-to-many' as const,
      columnPairs: [],
      self: sourceTable === targetTable && (!sourceSchema || !targetSchema || sourceSchema === targetSchema),
      computed: {
        functionName,
        functionSchema,
      },
    }]
  })
}

/** Match upstream getOverrideRelationshipsMap: a computed relationship named
 * like a detected foreign relation replaces the whole detected relationship
 * bucket for that source/target pair. */
export function applyComputedRelationshipOverrides(
  detected: RelationshipInfo[],
  computed: RelationshipInfo[],
): RelationshipInfo[] {
  const overrideKeys = new Set(computed.map(relationship =>
    `${relationship.sourceTable}\u0000${relationship.computed?.functionName ?? relationship.targetTable}`,
  ))
  return [
    ...detected.filter(relationship => !overrideKeys.has(`${relationship.sourceTable}\u0000${relationship.targetTable}`)),
    ...computed,
  ]
}

export class RelationshipCache {
  private readonly schema: string
  private readonly extraSearchPath: string[]
  private readonly cacheTTL: number
  private readonly queryFn: RelationshipCacheOptions['queryFn']
  private cached: RelationshipInfo[] = []
  private lastRefresh = 0
  private refreshPromise: Promise<void> | null = null

  constructor(options: RelationshipCacheOptions) {
    this.schema = options.schema ?? 'public'
    this.extraSearchPath = [...(options.extraSearchPath ?? [])]
    this.cacheTTL = options.cacheTTL ?? 60000
    this.queryFn = options.queryFn
  }

  async getRelationships(): Promise<RelationshipInfo[]> {
    if (Date.now() - this.lastRefresh > this.cacheTTL) await this.refresh()
    return [...this.cached]
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.doRefresh()
    try { await this.refreshPromise } finally { this.refreshPromise = null }
  }

  clear(): void { this.cached = []; this.lastRefresh = 0 }

  private async doRefresh(): Promise<void> {
    const [fkResult, viewResult, computedResult] = await Promise.all([
      this.queryFn(RELATIONSHIPS_SQL),
      this.queryFn(VIEW_KEY_DEPENDENCIES_SQL, [[this.schema], this.extraSearchPath]),
      this.queryFn(COMPUTED_RELATIONSHIPS_SQL, [this.schema]),
    ])
    const detected = relationshipsFromCatalogAndViewRows(fkResult.rows, viewResult.rows, this.schema)
    const computed = relationshipsFromComputedRows(computedResult.rows, this.schema)
    this.cached = applyComputedRelationshipOverrides(detected, computed)
    this.lastRefresh = Date.now()
  }
}
