import { PostgrestParser, type Filter } from './parser.js'

export function parseReadLogicFilter(
  operator: 'and' | 'or',
  value: string,
  parser = new PostgrestParser(),
  negate = false,
): Filter | null {
  const parsed = parser.parseFilter(operator, value)
  if (!parsed) return null
  return negate ? { ...parsed, negate: !parsed.negate } : parsed
}
