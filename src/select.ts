export type ReadJoinType = 'left' | 'inner'

export interface SelectFieldNode {
  kind: 'field'
  name: string
  alias?: string
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
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    if (char === '"') quoted = !quoted
    if (!quoted) {
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (depth < 0) throw new Error('Invalid select syntax: unmatched closing parenthesis')
      if (char === ',' && depth === 0) {
        parts.push(current)
        current = ''
        continue
      }
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

function parseAliasAndName(input: string): { alias?: string; name: string } {
  const colon = input.indexOf(':')
  if (colon < 0) return { name: input }
  const alias = input.slice(0, colon)
  const name = input.slice(colon + 1)
  if (!alias || !name) throw new Error(`Invalid select alias syntax: ${input}`)
  return { alias, name }
}

function parseEmbedPrefix(rawPrefix: string): Omit<SelectEmbedNode, 'kind' | 'children'> {
  let prefix = rawPrefix.trim()
  let spread = false
  if (prefix.startsWith('...')) {
    spread = true
    prefix = prefix.slice(3)
  }
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
      continue
    }
    if (hint && hint !== modifier) throw new Error(`Multiple relationship hints: ${rawPrefix}`)
    hint = modifier
  }

  const parsed: Omit<SelectEmbedNode, 'kind' | 'children'> = { relation }
  if (alias) parsed.alias = alias
  if (hint) parsed.hint = hint
  if (joinType) parsed.joinType = joinType
  if (spread) parsed.spread = true
  return parsed
}

function parseItem(raw: string): SelectNode {
  const item = raw.trim()
  if (!item) throw new Error('Invalid select syntax: empty item')
  const open = topLevelOpenParen(item)
  if (open >= 0) {
    if (!item.endsWith(')')) throw new Error(`Invalid embedded select: ${item}`)
    const prefix = item.slice(0, open)
    const inner = item.slice(open + 1, -1)
    if (!prefix) throw new Error(`Invalid embedded select: ${item}`)
    return { kind: 'embed', ...parseEmbedPrefix(prefix), children: parsePostgRESTSelect(inner) }
  }
  const { alias, name } = parseAliasAndName(item)
  const field: SelectFieldNode = { kind: 'field', name }
  if (alias) field.alias = alias
  return field
}

/** Parse the PostgREST `select` grammar into a nested read AST. */
export function parsePostgRESTSelect(select: string): SelectNode[] {
  if (!select.trim()) return []
  return splitTopLevelComma(select).map(parseItem)
}
