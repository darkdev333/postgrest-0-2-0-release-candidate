import type { RelationshipInfo } from './relationships.js'

export interface RelationshipQueryResult { rows: Record<string, unknown>[] }
export interface RelationshipCacheOptions {
  schema?: string
  cacheTTL?: number
  queryFn: (sql: string, params?: unknown[]) => Promise<RelationshipQueryResult>
}

export const RELATIONSHIPS_SQL = `
WITH fk_constraints AS (
  SELECT
    src_ns.nspname AS source_schema,
    src.relname AS source_table,
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
  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS key_cols(src_attnum, tgt_attnum, ord)
  JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = key_cols.src_attnum
  JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = key_cols.tgt_attnum
  WHERE con.contype = 'f' AND src_ns.nspname = $1
  GROUP BY src_ns.nspname, src.relname, tgt.relname, con.conname, con.conrelid, con.conkey
)
SELECT source_schema, source_table, target_table, constraint_name,
       source_columns, target_columns, source_unique, source_primary_key
FROM fk_constraints
ORDER BY source_table, constraint_name
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
  sourceTable: string
  targetTable: string
  constraintName: string
  sourceColumns: string[]
  targetColumns: string[]
  sourceUnique: boolean
  sourcePrimaryKey: string[]
}

function isSubset(values: string[], container: string[]): boolean {
  return values.length > 0 && values.every(value => container.includes(value))
}

function decodeFK(row: Record<string, unknown>): CatalogFK {
  return {
    sourceTable: String(row.source_table),
    targetTable: String(row.target_table),
    constraintName: String(row.constraint_name),
    sourceColumns: textArray(row.source_columns),
    targetColumns: textArray(row.target_columns),
    sourceUnique: row.source_unique === true || row.source_unique === 't' || row.source_unique === 'true',
    sourcePrimaryKey: textArray(row.source_primary_key),
  }
}

export function relationshipsFromCatalogRows(rows: Record<string, unknown>[]): RelationshipInfo[] {
  const fks = rows.map(decodeFK)
  const relationships: RelationshipInfo[] = []

  for (const fk of fks) {
    const pairs = fk.sourceColumns.map((source, index) => ({ source, target: fk.targetColumns[index] ?? '' }))
    const directCardinality = fk.sourceUnique ? 'one-to-one' as const : 'many-to-one' as const
    relationships.push({
      sourceTable: fk.sourceTable,
      targetTable: fk.targetTable,
      constraintName: fk.constraintName,
      cardinality: directCardinality,
      columnPairs: pairs,
      self: fk.sourceTable === fk.targetTable,
    })
    relationships.push({
      sourceTable: fk.targetTable,
      targetTable: fk.sourceTable,
      constraintName: fk.constraintName,
      cardinality: fk.sourceUnique ? 'one-to-one' : 'one-to-many',
      columnPairs: pairs.map(pair => ({ source: pair.target, target: pair.source })),
      self: fk.sourceTable === fk.targetTable,
    })
  }

  const bySource = new Map<string, CatalogFK[]>()
  for (const fk of fks) {
    const list = bySource.get(fk.sourceTable) ?? []
    list.push(fk)
    bySource.set(fk.sourceTable, list)
  }
  for (const [junctionTable, junctionFKs] of bySource) {
    for (let i = 0; i < junctionFKs.length; i += 1) {
      for (let j = i + 1; j < junctionFKs.length; j += 1) {
        const left = junctionFKs[i]!
        const right = junctionFKs[j]!
        if (left.targetTable === right.targetTable) continue
        const keyColumns = [...new Set([...left.sourceColumns, ...right.sourceColumns])]
        const primaryKey = left.sourcePrimaryKey.length ? left.sourcePrimaryKey : right.sourcePrimaryKey
        if (!isSubset(keyColumns, primaryKey)) continue

        relationships.push({
          sourceTable: left.targetTable,
          targetTable: right.targetTable,
          constraintName: `${left.constraintName}:${right.constraintName}`,
          cardinality: 'many-to-many',
          columnPairs: [],
          self: false,
          junction: {
            table: junctionTable,
            sourceConstraint: left.constraintName,
            targetConstraint: right.constraintName,
            sourceColumns: left.targetColumns.map((source, index) => ({ source, target: left.sourceColumns[index] ?? '' })),
            targetColumns: right.sourceColumns.map((source, index) => ({ source, target: right.targetColumns[index] ?? '' })),
          },
        })
        relationships.push({
          sourceTable: right.targetTable,
          targetTable: left.targetTable,
          constraintName: `${right.constraintName}:${left.constraintName}`,
          cardinality: 'many-to-many',
          columnPairs: [],
          self: false,
          junction: {
            table: junctionTable,
            sourceConstraint: right.constraintName,
            targetConstraint: left.constraintName,
            sourceColumns: right.targetColumns.map((source, index) => ({ source, target: right.sourceColumns[index] ?? '' })),
            targetColumns: left.sourceColumns.map((source, index) => ({ source, target: left.targetColumns[index] ?? '' })),
          },
        })
      }
    }
  }

  return relationships
}

export class RelationshipCache {
  private readonly schema: string
  private readonly cacheTTL: number
  private readonly queryFn: RelationshipCacheOptions['queryFn']
  private cached: RelationshipInfo[] = []
  private lastRefresh = 0
  private refreshPromise: Promise<void> | null = null

  constructor(options: RelationshipCacheOptions) {
    this.schema = options.schema ?? 'public'
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
    const result = await this.queryFn(RELATIONSHIPS_SQL, [this.schema])
    this.cached = relationshipsFromCatalogRows(result.rows)
    this.lastRefresh = Date.now()
  }
}
