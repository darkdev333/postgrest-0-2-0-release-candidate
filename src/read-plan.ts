import type { Filter, OrderClause } from './parser.js'
import type { RelationshipInfo } from './relationships.js'
import { findRelationshipCandidates } from './relationships.js'
import type { ReadJoinType, SelectEmbedNode, SelectFieldNode, SelectNode } from './select.js'

export interface RelatedOrderClause {
  relation: string
  column: string
  direction: 'asc' | 'desc'
  nullsFirst?: boolean
}

export type ReadOrderClause = OrderClause | RelatedOrderClause

export interface EmbedNullFilter {
  resource: string
  negate: boolean
}

export type ReadLogicTerm =
  | { kind: 'filter'; filter: Filter }
  | { kind: 'embed-null'; resource: string; negate: boolean }
  | { kind: 'logic'; operator: 'and' | 'or'; negate: boolean; terms: ReadLogicTerm[] }

export interface PlannedEmbed {
  relation: string
  outputName: string
  joinType: ReadJoinType
  spread: boolean
  relationship: RelationshipInfo
  plan: ReadPlan
}

export interface ReadPlan {
  table: string
  fields: SelectFieldNode[]
  embeds: PlannedEmbed[]
  filters?: Filter[]
  order?: ReadOrderClause[]
  embedNullFilters?: EmbedNullFilter[]
  logic?: ReadLogicTerm[]
  limit?: number
  offset?: number
}

export type ReadPlanColumnResolver = (table: string) => Promise<string[]>

export class RelationshipResolutionError extends Error {
  readonly code: 'PGRST200' | 'PGRST201'
  readonly sourceTable: string
  readonly targetTable: string
  readonly hint?: string
  readonly candidates: RelationshipInfo[]

  constructor(code: 'PGRST200' | 'PGRST201', sourceTable: string, targetTable: string, candidates: RelationshipInfo[], hint?: string) {
    const message = code === 'PGRST201'
      ? `Could not embed because more than one relationship was found for '${sourceTable}' and '${targetTable}'`
      : `Could not find a relationship between '${sourceTable}' and '${targetTable}' in the schema cache`
    super(message)
    this.name = 'RelationshipResolutionError'
    this.code = code
    this.sourceTable = sourceTable
    this.targetTable = targetTable
    this.candidates = candidates
    if (hint) this.hint = hint
  }
}

function planEmbed(sourceTable: string, embed: SelectEmbedNode, relationships: RelationshipInfo[]): PlannedEmbed {
  const candidates = findRelationshipCandidates(relationships, sourceTable, embed.relation, embed.hint)
  if (candidates.length === 0) throw new RelationshipResolutionError('PGRST200', sourceTable, embed.relation, [], embed.hint)
  if (candidates.length > 1) throw new RelationshipResolutionError('PGRST201', sourceTable, embed.relation, candidates, embed.hint)

  const relationship = candidates[0]!
  return {
    relation: embed.relation,
    outputName: embed.alias ?? embed.relation,
    joinType: embed.joinType ?? 'left',
    spread: embed.spread ?? false,
    relationship,
    plan: buildReadPlan(relationship.targetTable, embed.children, relationships),
  }
}

export function buildReadPlan(table: string, select: SelectNode[], relationships: RelationshipInfo[]): ReadPlan {
  const fields: SelectFieldNode[] = []
  const embeds: PlannedEmbed[] = []
  for (const node of select) {
    if (node.kind === 'field') fields.push(node)
    else embeds.push(planEmbed(table, node, relationships))
  }
  return { table, fields, embeds, filters: [], order: [], embedNullFilters: [], logic: [] }
}

function expandStarFields(fields: SelectFieldNode[], columns: string[]): SelectFieldNode[] {
  const expanded: SelectFieldNode[] = []
  for (const field of fields) {
    if (field.name === '*') {
      expanded.push(...columns.map(name => ({ kind: 'field' as const, name })))
    } else {
      expanded.push(field)
    }
  }
  return expanded
}

/**
 * Expand `*` only when the containing relation is spread.
 *
 * Ordinary `relation(*)` remains a row/object projection and can safely stay as `table.*`.
 * Spread needs an explicit output-column list because to-one spread flattens those columns and
 * to-many spread aggregates each column independently. Column discovery stays outside the SQL
 * compiler so the compiler remains a pure ReadPlan -> parameterized SQL step.
 */
export async function expandSpreadStars(
  plan: ReadPlan,
  resolveColumns: ReadPlanColumnResolver,
  spreadContext = false,
): Promise<ReadPlan> {
  const fields = spreadContext && plan.fields.some(field => field.name === '*')
    ? expandStarFields(plan.fields, await resolveColumns(plan.table))
    : [...plan.fields]

  const embeds = await Promise.all(plan.embeds.map(async embed => ({
    ...embed,
    plan: await expandSpreadStars(embed.plan, resolveColumns, embed.spread),
  })))

  return {
    ...plan,
    fields,
    embeds,
    filters: [...(plan.filters ?? [])],
    order: [...(plan.order ?? [])],
    embedNullFilters: [...(plan.embedNullFilters ?? [])],
    logic: [...(plan.logic ?? [])],
  }
}
