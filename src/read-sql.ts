import type { Filter, FilterOperator } from './parser.js'
import type { PlannedEmbed, ReadLogicTerm, ReadOrderClause, ReadPlan } from './read-plan.js'
import { isToOneRelationship } from './relationships.js'

export interface BuiltReadSQL { sql: string; params: unknown[] }
interface CompileState { nextAlias: number; nextParam: number; params: unknown[]; schema?: string }

const OPERATORS: Partial<Record<FilterOperator, string>> = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE', match: '~', imatch: '~*', isdistinct: 'IS DISTINCT FROM',
  cs: '@>', cd: '<@', ov: '&&', sl: '<<', sr: '>>', nxl: '&>', nxr: '&<', adj: '-|-',
}
const FTS: Partial<Record<FilterOperator, string>> = {
  fts: 'to_tsquery', plfts: 'plainto_tsquery', phfts: 'phraseto_tsquery', wfts: 'websearch_to_tsquery',
}
function quoteIdent(value: string): string { return `"${value.replace(/"/g, '""')}"` }
function quoteLiteral(value: string): string { return `'${value.replace(/'/g, "''")}'` }
function qualifiedTable(schema: string | undefined, table: string): string { return schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table) }
function applyCast(expression: string, cast: string | undefined): string { return cast ? `CAST( ${expression} AS ${cast} )` : expression }
function nextAlias(state: CompileState, prefix: string): string { const alias = `pgrst_${prefix}_${state.nextAlias}`; state.nextAlias += 1; return alias }
function addParam(state: CompileState, value: unknown): string { state.params.push(value); return '$' + state.nextParam++ }
function joinPredicates(embed: PlannedEmbed, parentAlias: string, childAlias: string, junctionAlias?: string): string[] {
  const rel = embed.relationship
  if (rel.cardinality === 'many-to-many') {
    if (!rel.junction || !junctionAlias) throw new Error('Invalid many-to-many relationship: missing junction metadata')
    return rel.junction.sourceColumns.map(pair => `${quoteIdent(parentAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(junctionAlias)}.${quoteIdent(pair.target)}`)
  }
  return rel.columnPairs.map(pair => `${quoteIdent(parentAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(childAlias)}.${quoteIdent(pair.target)}`)
}
function compileSelectField(field: ReadPlan['fields'][number], tableAlias: string): string {
  let expression = field.name === '*'
    ? `${quoteIdent(tableAlias)}.*`
    : compileFieldExpression(tableAlias, field.name)
  expression = applyCast(expression, field.cast)
  if (field.aggregate) {
    const aggregateInput = field.name === '*' && field.aggregate === 'count' ? '*' : expression
    expression = `${field.aggregate}(${aggregateInput})`
    expression = applyCast(expression, field.aggregateCast)
  }
  const outputName = field.alias ?? field.aggregate
  return outputName ? `${expression} AS ${quoteIdent(outputName)}` : expression
}
function compileFields(plan: ReadPlan, tableAlias: string): string[] {
  if (plan.fields.length === 0) return [`${quoteIdent(tableAlias)}.*`]
  return plan.fields.map(field => compileSelectField(field, tableAlias))
}
interface ProjectedColumn {
  sourceName: string
  outputName: string
  aggregate?: ReadPlan['fields'][number]['aggregate']
  aggregateCast?: string
}
function projectedColumns(plan: ReadPlan): ProjectedColumn[] {
  const columns: ProjectedColumn[] = []
  for (const field of plan.fields) {
    if (field.name === '*' && !field.aggregate) throw new Error('Spread embeds with * require schema-backed field expansion')
    const sourceName = field.alias ?? field.name
    const outputName = field.alias ?? field.aggregate ?? field.name
    columns.push({ sourceName, outputName, ...(field.aggregate && { aggregate: field.aggregate }), ...(field.aggregateCast && { aggregateCast: field.aggregateCast }) })
  }
  for (const embed of plan.embeds) {
    if (embed.spread) columns.push(...projectedColumns(embed.plan))
    else columns.push({ sourceName: embed.outputName, outputName: embed.outputName })
  }
  return columns
}
function hasLocalProjectionAggregate(plan: ReadPlan): boolean {
  if (plan.fields.some(field => field.aggregate)) return true
  return plan.embeds.some(embed => embed.spread && isToOneRelationship(embed.relationship) && projectedColumns(embed.plan).some(column => column.aggregate))
}
function compileGroupBy(plan: ReadPlan, tableAlias: string): string {
  if (!hasLocalProjectionAggregate(plan)) return ''
  const grouping = plan.fields
    .filter(field => !field.aggregate && field.name !== '*')
    .map(field => {
      let expression = compileFieldExpression(tableAlias, field.name)
      expression = applyCast(expression, field.cast)
      return expression
    })
  for (const embed of plan.embeds) {
    if (embed.spread) {
      grouping.push(...projectedColumns(embed.plan).filter(column => !column.aggregate).map(column => quoteIdent(column.outputName)))
    } else grouping.push(quoteIdent(embed.outputName))
  }
  return grouping.length ? ` GROUP BY ${grouping.join(', ')}` : ''
}
function compileSpreadProjection(plan: ReadPlan, lateralAlias: string): string[] {
  return projectedColumns(plan).map(column => {
    let expression = column.sourceName === '*'
      ? `${quoteIdent(lateralAlias)}.*`
      : `${quoteIdent(lateralAlias)}.${quoteIdent(column.sourceName)}`
    if (column.aggregate) {
      expression = `${column.aggregate}(${expression})`
      expression = applyCast(expression, column.aggregateCast)
    }
    return `${expression} AS ${quoteIdent(column.outputName)}`
  })
}
function withoutHoistedSpreadAggregates(plan: ReadPlan): ReadPlan {
  return {
    ...plan,
    fields: plan.fields.map(field => field.aggregate ? { ...field, aggregate: undefined, aggregateCast: undefined } : field),
    embeds: plan.embeds.map(embed =>
      embed.spread && isToOneRelationship(embed.relationship)
        ? { ...embed, plan: withoutHoistedSpreadAggregates(embed.plan) }
        : embed,
    ),
  }
}
function compileFieldExpression(alias: string, column: string): string {
  const parts = column.split(/(->>|->)/)
  const base = parts.shift()?.trim() ?? column
  let sql = `${quoteIdent(alias)}.${quoteIdent(base)}`
  for (let i = 0; i < parts.length; i += 2) {
    const operator = parts[i]
    const operand = parts[i + 1]?.trim()
    if (!operator || !operand) continue
    if (/^-?\d+$/.test(operand)) sql += `${operator}${operand}`
    else sql += `${operator}${quoteLiteral(operand)}`
  }
  return sql
}
function compileFilter(filter: Filter, tableAlias: string, state: CompileState): string {
  const { column, operator, value, negate } = filter
  if (operator === 'or' || operator === 'and') {
    const parts = (value as Filter[]).map(item => compileFilter(item, tableAlias, state))
    const combined = `(${parts.join(operator === 'or' ? ' OR ' : ' AND ')})`
    return negate ? `NOT (${combined})` : combined
  }
  const field = compileFieldExpression(tableAlias, column)
  let condition: string
  if (operator === 'is') {
    if (value === null) condition = `${field} IS NULL`
    else if (value === true) condition = `${field} IS TRUE`
    else if (value === false) condition = `${field} IS FALSE`
    else if (value === 'not_null') condition = `${field} IS NOT NULL`
    else if (value === 'unknown') condition = `${field} IS UNKNOWN`
    else condition = `${field} IS ${addParam(state, value)}`
  } else if (operator === 'isdistinct') condition = `${field} IS DISTINCT FROM ${addParam(state, value)}`
  else if (operator === 'in') {
    const values = value as unknown[]
    condition = values.length === 0 ? 'FALSE' : `${field} IN (${values.map(item => addParam(state, item)).join(', ')})`
  } else if (operator === 'like' || operator === 'ilike' || operator === 'match' || operator === 'imatch') {
    const operand = (operator === 'like' || operator === 'ilike') && typeof value === 'string' ? value.replace(/\*/g, '%') : value
    const rhs = addParam(state, operand)
    condition = `${field} ${OPERATORS[operator]} ${filter.quantifier ? `${filter.quantifier.toUpperCase()}(${rhs})` : rhs}`
  } else if (FTS[operator]) {
    const args = filter.config ? `${addParam(state, filter.config)}, ${addParam(state, value)}` : addParam(state, value)
    condition = `${field} @@ ${FTS[operator]}(${args})`
  } else {
    const rhs = addParam(state, value)
    condition = `${field} ${OPERATORS[operator] ?? '='} ${filter.quantifier ? `${filter.quantifier.toUpperCase()}(${rhs})` : rhs}`
  }
  return negate ? `NOT (${condition})` : condition
}
function compileOrderField(alias: string, column: string): string { return compileFieldExpression(alias, column) }
function compileOrder(order: ReadOrderClause[] | undefined, tableAlias: string, relatedAliases: Map<string, string> = new Map()): string {
  if (!order?.length) return ''
  return order.map(item => {
    const relation = 'relation' in item ? item.relation : undefined
    const alias = relation ? relatedAliases.get(relation) : tableAlias
    if (!alias) throw new Error(`Missing lateral alias for related order '${relation}'`)
    let clause = `${compileOrderField(alias, item.column)} ${item.direction.toUpperCase()}`
    if (item.nullsFirst !== undefined) clause += item.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'
    return clause
  }).join(', ')
}
function compileRange(plan: ReadPlan): string { const parts:string[]=[]; if(plan.limit!==undefined)parts.push(`LIMIT ${plan.limit}`); if(plan.offset!==undefined&&plan.offset>0)parts.push(`OFFSET ${plan.offset}`); return parts.join(' ') }
function compileEmbedJoins(plan: ReadPlan, state: CompileState, tableAlias: string): { selects: string[]; joins: string[]; relatedAliases: Map<string, string> } {
  const selects:string[]=[]; const joins:string[]=[]; const relatedAliases=new Map<string,string>()
  for(const embed of plan.embeds){
    const childAlias=nextAlias(state,'r'), lateralAlias=nextAlias(state,'e')
    const childQuery=compileNode(embed.plan,state,childAlias,{embed,parentAlias:tableAlias})
    relatedAliases.set(embed.outputName,lateralAlias)
    if(isToOneRelationship(embed.relationship)){
      if(embed.spread) selects.push(...compileSpreadProjection(embed.plan,lateralAlias))
      else selects.push(`row_to_json(${quoteIdent(lateralAlias)}.*)::jsonb AS ${quoteIdent(embed.outputName)}`)
      joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${childQuery} ) AS ${quoteIdent(lateralAlias)} ON TRUE`)
    }else{
      const rowAlias=nextAlias(state,'a')
      if(embed.spread){
        const columns=projectedColumns(embed.plan)
        const aggregates=columns.map(column=>`json_agg(${quoteIdent(rowAlias)}.${quoteIdent(column.sourceName)})::jsonb AS ${quoteIdent(column.outputName)}`)
        if(aggregates.length===0) throw new Error('Spread embed must project at least one field')
        const aggregateQuery=`SELECT ${aggregates.join(", ")} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`
        for(const column of columns) selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(column.outputName)}, '[]'::jsonb) AS ${quoteIdent(column.outputName)}`)
        const condition=embed.joinType==='inner'?`${quoteIdent(lateralAlias)} IS NOT NULL`:'TRUE'
        joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`)
      }else{
        const aggregateQuery=`SELECT json_agg(${quoteIdent(rowAlias)})::jsonb AS ${quoteIdent(lateralAlias)} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`
        selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(lateralAlias)}, '[]'::jsonb) AS ${quoteIdent(embed.outputName)}`)
        const condition=embed.joinType==='inner'?`${quoteIdent(lateralAlias)} IS NOT NULL`:'TRUE'
        joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`)
      }
    }
  }
  return {selects,joins,relatedAliases}
}
function compileReadLogic(term:ReadLogicTerm,tableAlias:string,state:CompileState,embedAliases:Map<string,string>):string{
  if(term.kind==='filter')return compileFilter(term.filter,tableAlias,state)
  if(term.kind==='embed-null'){
    const alias=embedAliases.get(term.resource);if(!alias)throw new Error(`Missing lateral alias for embed null filter '${term.resource}'`)
    return `${quoteIdent(alias)} IS ${term.negate?'':'NOT '}DISTINCT FROM NULL`
  }
  const inner=term.terms.map(child=>compileReadLogic(child,tableAlias,state,embedAliases)).join(term.operator==='or'?' OR ':' AND ')
  const grouped=`(${inner})`
  return term.negate?`NOT (${grouped})`:grouped
}
function appendModifiers(sql:string,plan:ReadPlan,tableAlias:string,state:CompileState,extraWhere:string[]=[],relatedAliases:Map<string,string>=new Map(),embedAliases:Map<string,string>=relatedAliases):string{
  const embedWhere=(plan.embedNullFilters??[]).map(filter=>{const alias=embedAliases.get(filter.resource);if(!alias)throw new Error(`Missing lateral alias for embed null filter '${filter.resource}'`);return `${quoteIdent(alias)} IS ${filter.negate?'':'NOT '}DISTINCT FROM NULL`})
  const logicWhere=(plan.logic??[]).map(term=>compileReadLogic(term,tableAlias,state,embedAliases))
  const where=[...extraWhere,...embedWhere,...logicWhere,...(plan.filters??[]).map(filter=>compileFilter(filter,tableAlias,state))]
  if(where.length)sql+=` WHERE ${where.join(' AND ')}`
  sql += compileGroupBy(plan, tableAlias)
  const order=compileOrder(plan.order,tableAlias,relatedAliases); if(order)sql+=` ORDER BY ${order}`
  const range=compileRange(plan); if(range)sql+=` ${range}`
  return sql
}
function compileNode(plan:ReadPlan,state:CompileState,tableAlias:string,parentJoin?:{embed:PlannedEmbed;parentAlias:string}):string{
  const selects=compileFields(plan,tableAlias), joins:string[]=[], relatedAliases=new Map<string,string>(), embedAliases=new Map<string,string>()
  for(const embed of plan.embeds){
    const childTableAlias=nextAlias(state,'r'), lateralAlias=nextAlias(state,'e'), toOne=isToOneRelationship(embed.relationship)
    embedAliases.set(embed.outputName,lateralAlias)
    if(toOne)relatedAliases.set(embed.outputName,lateralAlias)
    let childQuery:string
    if(embed.relationship.cardinality==='many-to-many'){
      const junction=embed.relationship.junction; if(!junction)throw new Error('Invalid many-to-many relationship: missing junction metadata')
      const junctionAlias=nextAlias(state,'j'), childSelects=compileFields(embed.plan,childTableAlias), nested=compileEmbedJoins(embed.plan,state,childTableAlias)
      childSelects.push(...nested.selects)
      const targetJoin=junction.targetColumns.map(pair=>`${quoteIdent(junctionAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(childTableAlias)}.${quoteIdent(pair.target)}`).join(' AND ')
      const sourceWhere=joinPredicates(embed,tableAlias,childTableAlias,junctionAlias)
      let inner=`SELECT ${childSelects.join(', ')} FROM ${qualifiedTable(state.schema,embed.plan.table)} AS ${quoteIdent(childTableAlias)} JOIN ${qualifiedTable(state.schema,junction.table)} AS ${quoteIdent(junctionAlias)} ON ${targetJoin}`
      if(nested.joins.length)inner+=` ${nested.joins.join(' ')}`
      childQuery=appendModifiers(inner,embed.plan,childTableAlias,state,sourceWhere,nested.relatedAliases,nested.relatedAliases)
    }else {
      const childPlan = toOne && embed.spread ? withoutHoistedSpreadAggregates(embed.plan) : embed.plan
      childQuery=compileNode(childPlan,state,childTableAlias,{embed,parentAlias:tableAlias})
    }
    if(toOne){
      if(embed.spread) selects.push(...compileSpreadProjection(embed.plan,lateralAlias))
      else selects.push(`row_to_json(${quoteIdent(lateralAlias)}.*)::jsonb AS ${quoteIdent(embed.outputName)}`)
      joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${childQuery} ) AS ${quoteIdent(lateralAlias)} ON TRUE`)
    }else{
      const aggregateAlias=lateralAlias,rowAlias=nextAlias(state,'a')
      if(embed.spread){
        const columns=projectedColumns(embed.plan)
        const aggregates=columns.map(column=>`json_agg(${quoteIdent(rowAlias)}.${quoteIdent(column.sourceName)})::jsonb AS ${quoteIdent(column.outputName)}`)
        if(aggregates.length===0) throw new Error('Spread embed must project at least one field')
        const aggregateQuery=`SELECT ${aggregates.join(", ")} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`
        for(const column of columns) selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(column.outputName)}, '[]'::jsonb) AS ${quoteIdent(column.outputName)}`)
        const condition=embed.joinType==='inner'?`${quoteIdent(lateralAlias)} IS NOT NULL`:'TRUE'
        joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`)
      }else{
        const aggregateQuery=`SELECT json_agg(${quoteIdent(rowAlias)})::jsonb AS ${quoteIdent(aggregateAlias)} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`
        selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(aggregateAlias)}, '[]'::jsonb) AS ${quoteIdent(embed.outputName)}`)
        const condition=embed.joinType==='inner'?`${quoteIdent(lateralAlias)} IS NOT NULL`:'TRUE'
        joins.push(`${embed.joinType==='inner'?'INNER':'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`)
      }
    }
  }
  const computed = parentJoin?.embed.relationship.computed
  const fromSource = computed
    ? `${qualifiedTable(computed.functionSchema ?? state.schema, computed.functionName)}(${quoteIdent(parentJoin!.parentAlias)}::${qualifiedTable(state.schema, parentJoin!.embed.relationship.sourceTable)})`
    : qualifiedTable(state.schema, plan.table)
  let sql=`SELECT ${selects.join(', ')} FROM ${fromSource} AS ${quoteIdent(tableAlias)}`
  if(joins.length)sql+=` ${joins.join(' ')}`
  const relationshipWhere=parentJoin && !computed?joinPredicates(parentJoin.embed,parentJoin.parentAlias,tableAlias):[]
  return appendModifiers(sql,plan,tableAlias,state,relationshipWhere,relatedAliases,embedAliases)
}
function stripRanges(plan:ReadPlan):ReadPlan{return{...plan,order:[],limit:undefined,offset:undefined,embeds:plan.embeds.map(embed=>({...embed,plan:stripRanges(embed.plan)}))}}
export function buildReadSQL(plan:ReadPlan,schema?:string):BuiltReadSQL{const state:CompileState={nextAlias:0,nextParam:1,params:[]};if(schema)state.schema=schema;const rootAlias=nextAlias(state,'r');return{sql:compileNode(plan,state,rootAlias),params:state.params}}
export function buildReadCountSQL(plan:ReadPlan,schema?:string):BuiltReadSQL{const built=buildReadSQL(stripRanges(plan),schema);return{sql:`SELECT COUNT(*) AS count FROM (${built.sql}) AS ${quoteIdent('pgrst_count')}`,params:built.params}}
