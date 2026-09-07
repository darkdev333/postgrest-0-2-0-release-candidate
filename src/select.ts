export type ReadJoinType = 'left' | 'inner'
export type SelectAggregate = 'count' | 'sum' | 'avg' | 'max' | 'min'

export interface SelectFieldNode {
  kind: 'field'
  name: string
  alias?: string
  cast?: string
  aggregate?: SelectAggregate
  aggregateCast?: string
}

export interface SelectEmbedNode {
  kind: 'embed'
  relation: string
  alias?: string
  hint?: string
  joinType?: ReadJoinType
  spread?: boolean
  children: SelectNode[]
}

export type SelectNode = SelectFieldNode | SelectEmbedNode

function splitTopLevelComma(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    if (escaped) { current += char; escaped = false; continue }
    if (quoted && char === '\\') { current += char; escaped = true; continue }
    if (char === '"') { quoted = !quoted; current += char; continue }
    if (!quoted) {
      if (char === '(') depth += 1
      else if (char === ')') { depth -= 1; if (depth < 0) throw new Error('Invalid select syntax: unmatched closing parenthesis') }
      else if (char === ',' && depth === 0) { parts.push(current); current = ''; continue }
    }
    current += char
  }
  if (quoted) throw new Error('Invalid select syntax: unterminated quoted identifier')
  if (depth !== 0) throw new Error('Invalid select syntax: unmatched parenthesis')
  if (current.length > 0) parts.push(current)
  return parts
}

function topLevelOpenParen(input: string): number {
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') return i
  }
  return -1
}

/** Find an alias separator while ignoring PostgreSQL cast `::`. */
function aliasSeparator(input: string): number {
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    if (char === '"') quoted = !quoted
    if (quoted || char !== ':') continue
    if (input[i - 1] === ':' || input[i + 1] === ':') continue
    return i
  }
  return -1
}

function parseAliasAndName(input: string): { alias?: string; name: string } {
  const colon = aliasSeparator(input)
  if (colon < 0) return { name: input }
  const alias = input.slice(0, colon)
  const name = input.slice(colon + 1)
  if (!alias || !name) throw new Error(`Invalid select alias syntax: ${input}`)
  return { alias, name }
}

function parseEmbedPrefix(rawPrefix: string): Omit<SelectEmbedNode, 'kind' | 'children'> {
  let prefix = rawPrefix.trim()
  let spread = false
  if (prefix.startsWith('...')) { spread = true; prefix = prefix.slice(3) }
  const { alias, name: relationAndModifiers } = parseAliasAndName(prefix)
  const segments = relationAndModifiers.split('!')
  const relation = segments.shift()
  if (!relation) throw new Error(`Invalid embedded relation: ${rawPrefix}`)
  let hint: string | undefined
  let joinType: ReadJoinType | undefined
  for (const modifier of segments) {
    if (!modifier) throw new Error(`Invalid embedded modifier: ${rawPrefix}`)
    if (modifier === 'inner' || modifier === 'left') {
      if (joinType && joinType !== modifier) throw new Error(`Conflicting join modifiers: ${rawPrefix}`)
      joinType = modifier
    } else {
      if (hint && hint !== modifier) throw new Error(`Multiple relationship hints: ${rawPrefix}`)
      hint = modifier
    }
  }
  return {
    relation,
    ...(alias && { alias }),
    ...(hint && { hint }),
    ...(joinType && { joinType }),
    ...(spread && { spread: true }),
  }
}

function splitTrailingCast(input: string): { expression: string; cast?: string } {
  let depth = 0
  let quoted = false
  for (let i = input.length - 2; i >= 0; i -= 1) {
    const char = input[i]!
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === ')') depth += 1
    else if (char === '(') depth -= 1
    if (depth === 0 && input[i] === ':' && input[i + 1] === ':') {
      const cast = input.slice(i + 2).trim()
      if (!cast) throw new Error(`Invalid cast syntax: ${input}`)
      return { expression: input.slice(0, i), cast }
    }
  }
  return { expression: input }
}

function parseField(input: string): SelectFieldNode {
  const { alias, name: aliasedExpression } = parseAliasAndName(input)
  const outer = splitTrailingCast(aliasedExpression)
  let expression = outer.expression
  let aggregateCast: string | undefined
  let cast: string | undefined
  let aggregate: SelectAggregate | undefined

  const aggregateMatch = expression.match(/^(.*?)(?:\.([A-Za-z]+))?\(\)$/)
  if (aggregateMatch) {
    const base = aggregateMatch[1] ?? ''
    const named = aggregateMatch[2]?.toLowerCase()
    if (named && ['count', 'sum', 'avg', 'max', 'min'].includes(named)) {
      aggregate = named as SelectAggregate
      expression = base
    } else if (!named && base.toLowerCase() === 'count') {
      aggregate = 'count'
      expression = '*'
    } else {
      throw new Error(`Invalid aggregate syntax: ${input}`)
    }
    aggregateCast = outer.cast
    const inner = splitTrailingCast(expression)
    expression = inner.expression
    cast = inner.cast
  } else {
    cast = outer.cast
  }

  if (!expression) throw new Error(`Invalid select field: ${input}`)
  const field: SelectFieldNode = { kind: 'field', name: expression }
  if (alias) field.alias = alias
  if (cast) field.cast = cast
  if (aggregate) field.aggregate = aggregate
  if (aggregateCast) field.aggregateCast = aggregateCast
  return field
}

function parseItem(raw: string): SelectNode {
  const item = raw.trim()
  if (!item) throw new Error('Invalid select syntax: empty item')
  const open = topLevelOpenParen(item)
  if (open >= 0) {
    // Aggregate expressions are fields, not embeds.
    if (/^(?:[^:]+:)?(?:\*|[^(),]+?)(?:\.(?:count|sum|avg|max|min))?\(\)(?:::[A-Za-z0-9_.$\[\] ]+)?$/i.test(item)) {
      return parseField(item)
    }
    if (!item.endsWith(')')) throw new Error(`Invalid embedded select: ${item}`)
    const prefix = item.slice(0, open)
    const inner = item.slice(open + 1, -1)
    if (!prefix) throw new Error(`Invalid embedded select: ${item}`)
    return { kind: 'embed', ...parseEmbedPrefix(prefix), children: parsePostgRESTSelect(inner) }
  }
  return parseField(item)
}

/** Parse the PostgREST `select` grammar into a nested read AST. */
export function parsePostgRESTSelect(select: string): SelectNode[] {
  if (!select.trim()) return []
  return splitTopLevelComma(select).map(parseItem)
}
