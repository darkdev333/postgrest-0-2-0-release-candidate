/**
 * Validation for URL-addressed PostgREST resources.
 *
 * PostgREST resolves resource names through its schema cache and quotes SQL
 * identifiers when generating SQL. Do not restrict resources to unquoted
 * PostgreSQL identifier syntax: valid exposed relations can have quoted names.
 */
export function isValidResourceName(name: string): boolean {
  return name.length > 0 && name.trim().length > 0 && !name.includes('\0')
}
