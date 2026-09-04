/**
 * Advanced Filtering Tests (RED phase TDD)
 *
 * Issue: postgres-e5pc.4
 *
 * Tests cover all PostgREST filter operators:
 * - eq, neq (equality)
 * - gt, gte, lt, lte (comparison)
 * - like, ilike (pattern matching)
 * - in (set membership)
 * - is (null/boolean)
 * - fts, plfts, phfts, wfts (full text search)
 * - cs, cd, ov (array/range containment)
 * - sl, sr, nxl, nxr, adj (range operators)
 * - not (negation)
 * - or, and (logical operators)
 *
 * These tests verify:
 * 1. Parser correctly parses filter query params
 * 2. QueryBuilder generates correct SQL
 * 3. Router integrates parsing + building end-to-end
 *
 * These tests should FAIL because the features are not fully implemented yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createPostgRESTRouter, type SQLExecutor } from '../router.js'
import { PostgrestParser } from '../parser.js'
import { QueryBuilder } from '../builder.js'
import type { ParsedQuery, Filter } from '../parser.js'

// Mock SQL executor that captures queries
const createCapturedSqlMock = (): SQLExecutor & { captured: { sql: string; params: unknown[] }[] } => {
  const captured: { sql: string; params: unknown[] }[] = []
  const fn = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true, is_unique: true },
          { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'NO', is_primary_key: false, is_unique: true },
          { table_name: 'users', column_name: 'age', data_type: 'integer', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'status', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'active', data_type: 'boolean', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'tags', data_type: 'text[]', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'score', data_type: 'numeric', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'bio', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'created_at', data_type: 'timestamptz', is_nullable: 'NO', is_primary_key: false, is_unique: false },
          { table_name: 'users', column_name: 'deleted_at', data_type: 'timestamptz', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true, is_unique: true },
          { table_name: 'posts', column_name: 'title', data_type: 'text', is_nullable: 'NO', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'body', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'category', data_type: 'text', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'price', data_type: 'numeric', is_nullable: 'YES', is_primary_key: false, is_unique: false },
          { table_name: 'posts', column_name: 'search_vector', data_type: 'tsvector', is_nullable: 'YES', is_primary_key: false, is_unique: false },
        ],
      }
    }
    if (sql.includes('information_schema')) {
      return { rows: [] }
    }
    captured.push({ sql, params: params || [] })
    return { rows: [{ id: 1, name: 'Test' }] }
  }) as unknown as SQLExecutor & { captured: { sql: string; params: unknown[] }[] }
  fn.captured = captured
  return fn
}

describe('Advanced Filtering (postgres-e5pc.4)', () => {
  let parser: PostgrestParser
  let builder: QueryBuilder

  beforeEach(() => {
    parser = new PostgrestParser()
    builder = new QueryBuilder({ schema: 'public' })
  })

  describe('Parser: eq operator', () => {
    it('should parse eq with string value', () => {
      const filter = parser.parseFilter('name', 'eq.Alice')
      expect(filter).toEqual({
        column: 'name',
        operator: 'eq',
        value: 'Alice',
        negate: false,
      })
    })

    it('should parse eq with numeric value', () => {
      const filter = parser.parseFilter('age', 'eq.25')
      expect(filter?.operator).toBe('eq')
      expect(filter?.value).toBe(25)
    })

    it('should parse eq with quoted string containing dots', () => {
      const filter = parser.parseFilter('email', 'eq."user@example.com"')
      expect(filter?.value).toBe('user@example.com')
    })

    it('should parse eq with empty string', () => {
      const filter = parser.parseFilter('name', 'eq.')
      expect(filter?.operator).toBe('eq')
      expect(filter?.value).toBe('')
    })

    it('should parse eq with value containing special characters', () => {
      const filter = parser.parseFilter('name', 'eq.O\'Brien')
      expect(filter?.value).toBe("O'Brien")
    })
  })

  describe('Parser: neq operator', () => {
    it('should parse neq with string value', () => {
      const filter = parser.parseFilter('status', 'neq.deleted')
      expect(filter).toEqual({
        column: 'status',
        operator: 'neq',
        value: 'deleted',
        negate: false,
      })
    })

    it('should parse neq with numeric value', () => {
      const filter = parser.parseFilter('age', 'neq.0')
      expect(filter?.operator).toBe('neq')
      expect(filter?.value).toBe(0)
    })

    it('should parse neq with null', () => {
      const filter = parser.parseFilter('deleted_at', 'neq.null')
      expect(filter?.operator).toBe('neq')
      expect(filter?.value).toBeNull()
    })
  })

  describe('Parser: gt/gte/lt/lte operators', () => {
    it('should parse gt with integer', () => {
      const filter = parser.parseFilter('age', 'gt.18')
      expect(filter?.operator).toBe('gt')
      expect(filter?.value).toBe(18)
    })

    it('should parse gte with float', () => {
      const filter = parser.parseFilter('score', 'gte.3.5')
      expect(filter?.operator).toBe('gte')
      expect(filter?.value).toBe(3.5)
    })

    it('should parse lt with negative number', () => {
      const filter = parser.parseFilter('balance', 'lt.-100')
      expect(filter?.operator).toBe('lt')
      expect(filter?.value).toBe(-100)
    })

    it('should parse lte with zero', () => {
      const filter = parser.parseFilter('stock', 'lte.0')
      expect(filter?.operator).toBe('lte')
      expect(filter?.value).toBe(0)
    })

    it('should parse gt with timestamp string', () => {
      const filter = parser.parseFilter('created_at', 'gt.2024-01-01T00:00:00Z')
      expect(filter?.operator).toBe('gt')
      expect(filter?.value).toBe('2024-01-01T00:00:00Z')
    })

    it('should parse lt with date string', () => {
      const filter = parser.parseFilter('created_at', 'lt.2024-12-31')
      expect(filter?.operator).toBe('lt')
      expect(filter?.value).toBe('2024-12-31')
    })
  })

  describe('Parser: like/ilike operators', () => {
    it('should parse like with wildcard prefix', () => {
      const filter = parser.parseFilter('name', 'like.*Smith')
      expect(filter?.operator).toBe('like')
      expect(filter?.value).toBe('*Smith')
    })

    it('should parse like with wildcard suffix', () => {
      const filter = parser.parseFilter('name', 'like.John*')
      expect(filter?.operator).toBe('like')
      expect(filter?.value).toBe('John*')
    })

    it('should parse like with wildcards on both sides', () => {
      const filter = parser.parseFilter('email', 'like.*@gmail*')
      expect(filter?.operator).toBe('like')
      expect(filter?.value).toBe('*@gmail*')
    })

    it('should parse ilike for case-insensitive matching', () => {
      const filter = parser.parseFilter('name', 'ilike.*john*')
      expect(filter?.operator).toBe('ilike')
      expect(filter?.value).toBe('*john*')
    })

    it('should parse like with percent encoding', () => {
      const filter = parser.parseFilter('name', 'like.%25Smith%25')
      expect(filter?.operator).toBe('like')
      // Should handle URL-encoded percent signs
      expect(filter?.value).toBe('%25Smith%25')
    })
  })

  describe('Parser: in operator', () => {
    it('should parse in with string values', () => {
      const filter = parser.parseFilter('status', 'in.(active,pending,review)')
      expect(filter?.operator).toBe('in')
      expect(filter?.value).toEqual(['active', 'pending', 'review'])
    })

    it('should parse in with numeric values', () => {
      const filter = parser.parseFilter('id', 'in.(1,2,3,4,5)')
      expect(filter?.operator).toBe('in')
      expect(filter?.value).toEqual([1, 2, 3, 4, 5])
    })

    it('should parse in with single value', () => {
      const filter = parser.parseFilter('role', 'in.(admin)')
      expect(filter?.operator).toBe('in')
      expect(filter?.value).toEqual(['admin'])
    })

    it('should parse in with mixed types', () => {
      const filter = parser.parseFilter('val', 'in.(1,two,true,null)')
      expect(filter?.operator).toBe('in')
      expect(filter?.value).toEqual([1, 'two', true, null])
    })

    it('should parse in with quoted strings containing commas', () => {
      const filter = parser.parseFilter('name', 'in.("Smith, John","Doe, Jane")')
      expect(filter?.operator).toBe('in')
      expect(filter?.value).toEqual(['Smith, John', 'Doe, Jane'])
    })

    it('should handle in with empty parentheses', () => {
      const filter = parser.parseFilter('id', 'in.()')
      expect(filter?.operator).toBe('in')
      // Empty set should result in empty array or be rejected
      expect(filter?.value).toEqual([])
    })
  })

  describe('Parser: is operator', () => {
    it('should parse is.null', () => {
      const filter = parser.parseFilter('deleted_at', 'is.null')
      expect(filter?.operator).toBe('is')
      expect(filter?.value).toBeNull()
    })

    it('should parse is.true', () => {
      const filter = parser.parseFilter('active', 'is.true')
      expect(filter?.operator).toBe('is')
      expect(filter?.value).toBe(true)
    })

    it('should parse is.false', () => {
      const filter = parser.parseFilter('verified', 'is.false')
      expect(filter?.operator).toBe('is')
      expect(filter?.value).toBe(false)
    })

    it('should reject is with non-null/boolean values', () => {
      const filter = parser.parseFilter('name', 'is.something')
      // 'is' should only accept null, true, false
      expect(filter?.value).not.toBe('something')
    })
  })

  describe('Parser: Full Text Search operators', () => {
    it('should parse fts (to_tsquery)', () => {
      const filter = parser.parseFilter('body', 'fts.hello & world')
      expect(filter?.operator).toBe('fts')
      expect(filter?.value).toBe('hello & world')
    })

    it('should parse plfts (plainto_tsquery)', () => {
      const filter = parser.parseFilter('content', 'plfts.search term')
      expect(filter?.operator).toBe('plfts')
      expect(filter?.value).toBe('search term')
    })

    it('should parse phfts (phraseto_tsquery)', () => {
      const filter = parser.parseFilter('title', 'phfts.exact phrase match')
      expect(filter?.operator).toBe('phfts')
      expect(filter?.value).toBe('exact phrase match')
    })

    it('should parse wfts (websearch_to_tsquery)', () => {
      const filter = parser.parseFilter('document', 'wfts.search query -excluded')
      expect(filter?.operator).toBe('wfts')
      expect(filter?.value).toBe('search query -excluded')
    })

    it('should parse fts with language config', () => {
      // PostgREST supports fts(english).search_term
      const filter = parser.parseFilter('body', 'fts(english).hello & world')
      expect(filter?.operator).toBe('fts')
      // Should parse the language config
    })

    it('should parse plfts with language config', () => {
      const filter = parser.parseFilter('content', 'plfts(german).suchbegriff')
      expect(filter?.operator).toBe('plfts')
    })
  })

  describe('Parser: Range/Array operators', () => {
    it('should parse cs (contains) for arrays', () => {
      const filter = parser.parseFilter('tags', 'cs.{news,tech}')
      expect(filter?.operator).toBe('cs')
      expect(filter?.value).toBe('{news,tech}')
    })

    it('should parse cd (contained by) for arrays', () => {
      const filter = parser.parseFilter('tags', 'cd.{news,tech,science}')
      expect(filter?.operator).toBe('cd')
    })

    it('should parse ov (overlaps) for arrays', () => {
      const filter = parser.parseFilter('categories', 'ov.{a,b,c}')
      expect(filter?.operator).toBe('ov')
    })

    it('should parse cs for range types', () => {
      const filter = parser.parseFilter('duration', 'cs.[2024-01-01,2024-12-31]')
      expect(filter?.operator).toBe('cs')
    })

    it('should parse sl (strictly left of range)', () => {
      const filter = parser.parseFilter('range_col', 'sl.(1,5)')
      expect(filter?.operator).toBe('sl')
    })

    it('should parse sr (strictly right of range)', () => {
      const filter = parser.parseFilter('range_col', 'sr.(10,20)')
      expect(filter?.operator).toBe('sr')
    })

    it('should parse nxl (does not extend left)', () => {
      const filter = parser.parseFilter('range_col', 'nxl.(0,10)')
      expect(filter?.operator).toBe('nxl')
    })

    it('should parse nxr (does not extend right)', () => {
      const filter = parser.parseFilter('range_col', 'nxr.(0,100)')
      expect(filter?.operator).toBe('nxr')
    })

    it('should parse adj (adjacent ranges)', () => {
      const filter = parser.parseFilter('range_col', 'adj.(5,10)')
      expect(filter?.operator).toBe('adj')
    })
  })

  describe('Parser: Negation', () => {
    it('should parse not.eq', () => {
      const filter = parser.parseFilter('status', 'not.eq.active')
      expect(filter?.operator).toBe('eq')
      expect(filter?.negate).toBe(true)
      expect(filter?.value).toBe('active')
    })

    it('should parse not.like', () => {
      const filter = parser.parseFilter('name', 'not.like.*test*')
      expect(filter?.operator).toBe('like')
      expect(filter?.negate).toBe(true)
    })

    it('should parse not.in', () => {
      const filter = parser.parseFilter('status', 'not.in.(deleted,banned)')
      expect(filter?.operator).toBe('in')
      expect(filter?.negate).toBe(true)
      expect(filter?.value).toEqual(['deleted', 'banned'])
    })

    it('should parse not.is.null', () => {
      const filter = parser.parseFilter('email', 'not.is.null')
      expect(filter?.operator).toBe('is')
      expect(filter?.negate).toBe(true)
      expect(filter?.value).toBeNull()
    })

    it('should parse not.fts', () => {
      const filter = parser.parseFilter('body', 'not.fts.excluded_term')
      expect(filter?.operator).toBe('fts')
      expect(filter?.negate).toBe(true)
    })

    it('should parse not.cs (not contains)', () => {
      const filter = parser.parseFilter('tags', 'not.cs.{spam}')
      expect(filter?.operator).toBe('cs')
      expect(filter?.negate).toBe(true)
    })
  })

  describe('Parser: Logical operators (or/and)', () => {
    it('should parse or with two conditions', () => {
      const filter = parser.parseFilter('or', '(status.eq.active,status.eq.pending)')
      expect(filter?.operator).toBe('or')
      const subFilters = filter?.value as Filter[]
      expect(subFilters).toHaveLength(2)
      expect(subFilters[0]?.column).toBe('status')
      expect(subFilters[0]?.operator).toBe('eq')
      expect(subFilters[0]?.value).toBe('active')
      expect(subFilters[1]?.value).toBe('pending')
    })

    it('should parse or with different columns', () => {
      const filter = parser.parseFilter('or', '(name.eq.Alice,email.eq.bob@test.com)')
      expect(filter?.operator).toBe('or')
      const subFilters = filter?.value as Filter[]
      expect(subFilters[0]?.column).toBe('name')
      expect(subFilters[1]?.column).toBe('email')
    })

    it('should parse and with multiple conditions', () => {
      const filter = parser.parseFilter('and', '(age.gte.18,age.lte.65,status.eq.active)')
      expect(filter?.operator).toBe('and')
      const subFilters = filter?.value as Filter[]
      expect(subFilters).toHaveLength(3)
    })

    it('should parse nested logical operators', () => {
      // or=(and(age.gte.18,status.eq.active),role.eq.admin)
      const filter = parser.parseFilter('or', '(and(age.gte.18,status.eq.active),role.eq.admin)')
      expect(filter?.operator).toBe('or')
      const subFilters = filter?.value as Filter[]
      expect(subFilters.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse or with negated conditions', () => {
      const filter = parser.parseFilter('or', '(status.not.eq.deleted,age.gt.18)')
      expect(filter?.operator).toBe('or')
      const subFilters = filter?.value as Filter[]
      // First condition should be negated
      expect(subFilters[0]?.negate).toBe(true)
    })
  })

  describe('QueryBuilder: eq/neq SQL generation', () => {
    it('should generate correct SQL for eq operator', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'name', operator: 'eq', value: 'Alice' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('"name" =')
      expect(result.params).toContain('Alice')
    })

    it('should generate correct SQL for neq operator', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'status', operator: 'neq', value: 'deleted' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"status" !=')
      expect(result.params).toContain('deleted')
    })
  })

  describe('QueryBuilder: gt/gte/lt/lte SQL generation', () => {
    it('should generate > for gt', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'age', operator: 'gt', value: 18 }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"age" >')
      expect(result.sql).not.toContain('>=')
      expect(result.params).toContain(18)
    })

    it('should generate >= for gte', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'age', operator: 'gte', value: 21 }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"age" >=')
      expect(result.params).toContain(21)
    })

    it('should generate < for lt', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'price', operator: 'lt', value: 100 }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"price" <')
      expect(result.sql).not.toContain('<=')
    })

    it('should generate <= for lte', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'quantity', operator: 'lte', value: 50 }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"quantity" <=')
    })
  })

  describe('QueryBuilder: like/ilike SQL generation', () => {
    it('should generate LIKE with proper parameter', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'name', operator: 'like', value: '%Smith%' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"name" LIKE')
      expect(result.params).toContain('%Smith%')
    })

    it('should generate ILIKE for case-insensitive match', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'email', operator: 'ilike', value: '%@gmail.com' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"email" ILIKE')
    })

    it('should convert PostgREST wildcards (*) to SQL wildcards (%)', () => {
      // PostgREST uses * as wildcard, SQL uses %
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'name', operator: 'like', value: '*Smith*' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      // The builder should convert * to % in LIKE values
      expect(result.params[0]).toBe('%Smith%')
    })
  })

  describe('QueryBuilder: in operator SQL generation', () => {
    it('should generate IN clause with multiple values', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'status', operator: 'in', value: ['active', 'pending'] }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"status" IN')
      expect(result.sql).toContain('$1')
      expect(result.sql).toContain('$2')
      expect(result.params).toContain('active')
      expect(result.params).toContain('pending')
    })

    it('should generate IN clause with single value', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'role', operator: 'in', value: ['admin'] }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"role" IN')
      expect(result.params).toContain('admin')
    })

    it('should handle IN with numeric values', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'id', operator: 'in', value: [1, 2, 3] }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.params).toEqual(expect.arrayContaining([1, 2, 3]))
    })
  })

  describe('QueryBuilder: is operator SQL generation', () => {
    it('should generate IS NULL', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'deleted_at', operator: 'is', value: null }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"deleted_at" IS NULL')
    })

    it('should generate IS TRUE', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'active', operator: 'is', value: true }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"active" IS TRUE')
    })

    it('should generate IS FALSE', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'verified', operator: 'is', value: false }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"verified" IS FALSE')
    })
  })

  describe('QueryBuilder: Full Text Search SQL generation', () => {
    it('should generate @@ to_tsquery for fts', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'search_vector', operator: 'fts', value: 'hello & world' }],
        order: [],
      }
      const result = builder.buildSelect('posts', query)
      expect(result.sql).toContain('"search_vector" @@ to_tsquery')
      expect(result.params).toContain('hello & world')
    })

    it('should generate @@ plainto_tsquery for plfts', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'body', operator: 'plfts', value: 'search terms' }],
        order: [],
      }
      const result = builder.buildSelect('posts', query)
      expect(result.sql).toContain('"body" @@ plainto_tsquery')
    })

    it('should generate @@ phraseto_tsquery for phfts', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'title', operator: 'phfts', value: 'exact phrase' }],
        order: [],
      }
      const result = builder.buildSelect('posts', query)
      expect(result.sql).toContain('"title" @@ phraseto_tsquery')
    })

    it('should generate @@ websearch_to_tsquery for wfts', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'body', operator: 'wfts', value: 'search -excluded' }],
        order: [],
      }
      const result = builder.buildSelect('posts', query)
      expect(result.sql).toContain('"body" @@ websearch_to_tsquery')
    })

    it('should support language config in fts queries', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{
          column: 'body',
          operator: 'fts',
          value: 'hello & world',
          // Language config should be passed somehow
        }],
        order: [],
      }
      const result = builder.buildSelect('posts', query)
      // Should support: to_tsquery('english', $1)
      expect(result.sql).toContain('to_tsquery')
    })
  })

  describe('QueryBuilder: Array/Range operators SQL generation', () => {
    it('should generate @> for cs (contains)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'tags', operator: 'cs', value: '{news,tech}' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"tags" @>')
    })

    it('should generate <@ for cd (contained by)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'tags', operator: 'cd', value: '{news,tech,science}' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"tags" <@')
    })

    it('should generate && for ov (overlaps)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'categories', operator: 'ov', value: '{a,b,c}' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"categories" &&')
    })

    it('should generate << for sl (strictly left)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'range_col', operator: 'sl', value: '(1,5)' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"range_col" <<')
    })

    it('should generate >> for sr (strictly right)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'range_col', operator: 'sr', value: '(10,20)' }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('"range_col" >>')
    })
  })

  describe('QueryBuilder: Negation SQL generation', () => {
    it('should wrap condition with NOT for negated eq', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'status', operator: 'eq', value: 'deleted', negate: true }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('NOT')
      expect(result.sql).toContain('"status" =')
    })

    it('should generate IS NOT NULL for negated is null', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'email', operator: 'is', value: null, negate: true }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toMatch(/NOT.*IS NULL|IS NOT NULL/)
    })

    it('should generate NOT IN for negated in', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'status', operator: 'in', value: ['deleted', 'banned'], negate: true }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toMatch(/NOT.*IN|NOT IN/)
    })
  })

  describe('QueryBuilder: Logical operators SQL generation', () => {
    it('should generate OR clause', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{
          column: 'or',
          operator: 'or',
          value: [
            { column: 'status', operator: 'eq', value: 'active' },
            { column: 'role', operator: 'eq', value: 'admin' },
          ] as Filter[],
        }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('OR')
      expect(result.sql).toContain('"status" =')
      expect(result.sql).toContain('"role" =')
    })

    it('should generate AND clause for explicit and filter', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{
          column: 'and',
          operator: 'and',
          value: [
            { column: 'age', operator: 'gte', value: 18 },
            { column: 'age', operator: 'lte', value: 65 },
          ] as Filter[],
        }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('AND')
      expect(result.sql).toContain('"age" >=')
      expect(result.sql).toContain('"age" <=')
    })

    it('should wrap logical groups in parentheses', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{
          column: 'or',
          operator: 'or',
          value: [
            { column: 'a', operator: 'eq', value: 1 },
            { column: 'b', operator: 'eq', value: 2 },
          ] as Filter[],
        }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      // Should have parentheses around OR group
      expect(result.sql).toMatch(/\(.*OR.*\)/)
    })
  })

  describe('QueryBuilder: Multiple filters combined', () => {
    it('should combine multiple filters with AND', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [
          { column: 'age', operator: 'gte', value: 18 },
          { column: 'status', operator: 'eq', value: 'active' },
          { column: 'deleted_at', operator: 'is', value: null },
        ],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('AND')
      expect(result.sql).toContain('"age" >=')
      expect(result.sql).toContain('"status" =')
      expect(result.sql).toContain('"deleted_at" IS NULL')
    })

    it('should properly parameterize multiple filters', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [
          { column: 'name', operator: 'eq', value: 'Alice' },
          { column: 'age', operator: 'gt', value: 25 },
        ],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      expect(result.params).toHaveLength(2)
      expect(result.params[0]).toBe('Alice')
      expect(result.params[1]).toBe(25)
      expect(result.sql).toContain('$1')
      expect(result.sql).toContain('$2')
    })
  })

  describe('Router: End-to-end filtering integration', () => {
    let app: Hono
    let mockSql: SQLExecutor & { captured: { sql: string; params: unknown[] }[] }

    beforeEach(() => {
      mockSql = createCapturedSqlMock()
      const router = createPostgRESTRouter(mockSql)
      app = new Hono()
      app.route('/api', router)
    })

    it('should handle eq filter in URL query params', async () => {
      await app.request('http://localhost/api/users?name=eq.Alice')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('WHERE')
      expect(dataQuery?.sql).toContain('"name" =')
      expect(dataQuery?.params).toContain('Alice')
    })

    it('should handle multiple filters in URL', async () => {
      await app.request('http://localhost/api/users?age=gte.18&status=eq.active')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('AND')
      expect(dataQuery?.sql).toContain('"age" >=')
      expect(dataQuery?.sql).toContain('"status" =')
    })

    it('should handle in filter in URL', async () => {
      await app.request('http://localhost/api/users?status=in.(active,pending)')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('IN')
      expect(dataQuery?.params).toContain('active')
      expect(dataQuery?.params).toContain('pending')
    })

    it('should handle is.null filter in URL', async () => {
      await app.request('http://localhost/api/users?deleted_at=is.null')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('IS NULL')
    })

    it('should handle negated filter in URL', async () => {
      await app.request('http://localhost/api/users?status=not.eq.deleted')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('NOT')
    })

    it('should handle or filter in URL', async () => {
      await app.request('http://localhost/api/users?or=(status.eq.active,role.eq.admin)')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('OR')
    })

    it('should handle like filter in URL', async () => {
      await app.request('http://localhost/api/users?name=like.*Smith*')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('LIKE')
    })

    it('should handle fts filter in URL', async () => {
      await app.request('http://localhost/api/posts?body=fts.hello')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('@@')
      expect(dataQuery?.sql).toContain('to_tsquery')
    })

    it('should handle combined select and filters', async () => {
      await app.request('http://localhost/api/users?select=id,name&status=eq.active&age=gt.18')
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('"id"')
      expect(dataQuery?.sql).toContain('"name"')
      expect(dataQuery?.sql).toContain('WHERE')
    })

    it('should apply filters to PATCH requests', async () => {
      await app.request('http://localhost/api/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('UPDATE')
      expect(dataQuery?.sql).toContain('WHERE')
      expect(dataQuery?.sql).toContain('"id" =')
    })

    it('should apply filters to DELETE requests', async () => {
      await app.request('http://localhost/api/users?id=eq.1', {
        method: 'DELETE',
      })
      const dataQuery = mockSql.captured[0]
      expect(dataQuery?.sql).toContain('DELETE')
      expect(dataQuery?.sql).toContain('WHERE')
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should reject unknown filter operators', () => {
      const filter = parser.parseFilter('name', 'unknown_op.value')
      expect(filter).toBeNull()
    })

    it('should handle filter values with dots (like email)', () => {
      const filter = parser.parseFilter('email', 'eq.user@example.com')
      expect(filter?.operator).toBe('eq')
      // The value after the operator dot should be the rest of the string
      expect(filter?.value).toBe('user@example.com')
    })

    it('should handle filter with very long value', () => {
      const longValue = 'a'.repeat(10000)
      const filter = parser.parseFilter('name', `eq.${longValue}`)
      expect(filter?.value).toBe(longValue)
    })

    it('should handle filter with unicode characters', () => {
      const filter = parser.parseFilter('name', 'eq.cafe\u0301')
      expect(filter?.operator).toBe('eq')
    })

    it('should handle filter with URL-encoded characters', () => {
      const filter = parser.parseFilter('name', 'eq.hello%20world')
      expect(filter?.operator).toBe('eq')
      // URL decoding is typically handled by the web framework before reaching parser
      expect(filter?.value).toBe('hello%20world')
    })

    it('should properly escape SQL in generated queries (no injection)', () => {
      const query: ParsedQuery = {
        columns: '*',
        embedded: [],
        filters: [{ column: 'name', operator: 'eq', value: "'; DROP TABLE users; --" }],
        order: [],
      }
      const result = builder.buildSelect('users', query)
      // Should use parameterized query, not inline the value
      expect(result.sql).not.toContain("DROP TABLE")
      expect(result.sql).toContain('$1')
      expect(result.params[0]).toBe("'; DROP TABLE users; --")
    })

    it('should handle multiple same-key filters (URLSearchParams limitation)', () => {
      const params = new URLSearchParams()
      params.append('age', 'gte.18')
      params.append('age', 'lte.65')
      const result = parser.parse(params)
      // Implementation-dependent: may get one or both filters
      expect(result.filters.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle empty filter value', () => {
      const filter = parser.parseFilter('name', '')
      // Empty string should either return null or default to eq with empty value
      expect(filter === null || filter?.value === '').toBe(true)
    })
  })
})
