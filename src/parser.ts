/**
 * PostgREST Query Parameter Parser
 *
 * Parses PostgREST-style query parameters into structured objects
 * for SQL query building.
 */

import {
  POSTGRES_IDENTIFIER_PATTERN,
  MAX_IDENTIFIER_LENGTH,
} from '@dotdo/postgres-shared/validation';

// --- Constants ---

/** Query parameter names reserved for non-filter use */
const RESERVED_PARAMS = ['select', 'order', 'limit', 'offset'] as const;

/** Numeric base for parseInt */
const DECIMAL_RADIX = 10;

/**
 * Valid filter operators supported by PostgREST.
 * Grouped by category for clarity.
 */
const VALID_FILTER_OPERATORS: readonly FilterOperator[] = [
  // Comparison operators
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  // Pattern matching
  'like', 'ilike',
  // Identity checks
  'is', 'in',
  // Array/range operators
  'cs', 'cd', 'ov', 'sl', 'sr', 'nxl', 'nxr', 'adj',
  // Full-text search operators
  'fts', 'plfts', 'phfts', 'wfts',
] as const;

/** Full-text search operators that keep value as-is */
const FULL_TEXT_SEARCH_OPERATORS: readonly FilterOperator[] = ['fts', 'plfts', 'phfts', 'wfts'];

/** Array and range operators that keep value as string */
const ARRAY_RANGE_OPERATORS: readonly FilterOperator[] = ['cs', 'cd', 'ov', 'sl', 'sr', 'nxl', 'nxr', 'adj'];

/** Regex for matching embedded resource syntax: name:alias(inner) */
const EMBEDDED_RESOURCE_PATTERN = /^(\w+)(?::(\w+))?\((.+)\)$/;

/** Regex for order clause: column.direction.nulls */
const ORDER_CLAUSE_PATTERN = /^(\w+)(?:\.(asc|desc))?(?:\.(nullsfirst|nullslast))?$/i;

/** Regex for negation prefix */
const NEGATION_PREFIX_PATTERN = /^not\.(.+)$/;

/** Regex for filter operator with optional language config */
const FILTER_OPERATOR_PATTERN = /^(\w+)(?:\([^)]*\))?\.(.*)$/s;

/** Regex for IN operator value list */
const IN_VALUE_PATTERN = /^\((.*)\)$/s;

/** Regex for Range header format */
const RANGE_HEADER_PATTERN = /^items=(\d+)-(\d+)$/;

/** Regex for logical filter wrapper */
const LOGICAL_FILTER_PATTERN = /^\((.+)\)$/;

/** Regex for integer values */
const INTEGER_PATTERN = /^-?\d+$/;

/** Regex for float values */
const FLOAT_PATTERN = /^-?\d+\.\d+$/;

/** SQL injection patterns to validate against */
const SQL_INJECTION_PATTERNS: readonly RegExp[] = [
  /;/,           // Semicolons
  /--/,          // SQL comments
  /\/\*/,        // Block comment start
  /\*\//,        // Block comment end
  /\bunion\b/i,  // UNION keyword
  /'/,           // Single quotes
  /"/,           // Double quotes
  /\x00/,        // Null bytes
  /\n/,          // Newlines
  /\r/,          // Carriage returns
];

// --- Types ---

/** Supported PostgREST filter operators */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'cs'
  | 'cd'
  | 'ov'
  | 'sl'
  | 'sr'
  | 'nxl'
  | 'nxr'
  | 'adj'
  | 'not'
  | 'or'
  | 'and'
  | 'fts'
  | 'plfts'
  | 'phfts'
  | 'wfts';

/** A single column filter condition */
export interface Filter {
  /** Column name to filter on */
  column: string;
  /** Filter operator to apply */
  operator: FilterOperator;
  /** Value to compare against */
  value: unknown;
  /** Whether to negate the filter condition */
  negate?: boolean;
}

/** An ORDER BY clause specification */
export interface OrderClause {
  /** Column to order by */
  column: string;
  /** Sort direction */
  direction: 'asc' | 'desc';
  /** Whether NULLs should sort first */
  nullsFirst?: boolean;
}

/** An embedded (joined) resource in the select clause */
export interface EmbeddedResource {
  /** Table/resource name to embed */
  name: string;
  /** Columns to select from the embedded resource */
  columns: string[] | '*';
  /** Alias for the embedded resource in the response */
  alias?: string;
  /** Nested embedded resources */
  embedded?: EmbeddedResource[];
  /** Filters to apply to the embedded resource */
  filters?: Filter[];
  /** Order clauses for the embedded resource */
  order?: OrderClause[];
  /** Maximum rows to return from the embedded resource */
  limit?: number;
  /** Row offset for the embedded resource */
  offset?: number;
}

/** Result of parsing all query parameters */
export interface ParsedQuery {
  /** Columns to select */
  columns: string[] | '*';
  /** Embedded resources (joins) */
  embedded: EmbeddedResource[];
  /** WHERE clause filters */
  filters: Filter[];
  /** ORDER BY clauses */
  order: OrderClause[];
  /** Maximum rows to return */
  limit?: number;
  /** Row offset for pagination */
  offset?: number;
  /** Count mode for total row count */
  count?: 'exact' | 'planned' | 'estimated';
}

// --- Helper Functions ---

/**
 * Parse an embedded resource match result into an EmbeddedResource object.
 * Shared by parseSelect and extractEmbeddedFromParts to eliminate duplication.
 */
function buildEmbeddedResource(
  name: string,
  alias: string | undefined,
  innerSelect: string,
  parseSelectFn: (select: string) => { columns: string[] | '*'; embedded: EmbeddedResource[] }
): EmbeddedResource {
  const innerParsed = parseSelectFn(innerSelect);
  const embeddedResource: EmbeddedResource = {
    name,
    columns: innerParsed.columns,
    embedded: innerParsed.embedded,
  };
  if (alias) {
    embeddedResource.alias = alias;
  }
  return embeddedResource;
}

/**
 * Attempt to parse a trimmed part as an embedded resource.
 * Returns the EmbeddedResource if it matches, or null otherwise.
 */
function tryParseEmbeddedPart(
  trimmedPart: string,
  parseSelectFn: (select: string) => { columns: string[] | '*'; embedded: EmbeddedResource[] }
): EmbeddedResource | null {
  const embedMatch = trimmedPart.match(EMBEDDED_RESOURCE_PATTERN);
  if (!embedMatch) return null;

  const name = embedMatch[1];
  const alias = embedMatch[2];
  const innerSelect = embedMatch[3];
  if (!name || !innerSelect) return null;

  return buildEmbeddedResource(name, alias, innerSelect, parseSelectFn);
}

/**
 * Parse a non-negative integer from a string.
 * Returns undefined if the string is not a valid non-negative integer.
 */
function parseNonNegativeInt(value: string): number | undefined {
  const parsed = parseInt(value, DECIMAL_RADIX);
  return (!isNaN(parsed) && parsed >= 0) ? parsed : undefined;
}

/**
 * Determine the parsed value for a given filter operator and raw string value.
 */
function parseFilterValue(operator: string, rawValue: string, parseValueFn: (v: string) => unknown, parseInValuesFn: (inner: string) => unknown[]): unknown {
  if (operator === 'in') {
    const inMatch = rawValue.match(IN_VALUE_PATTERN);
    if (inMatch) {
      const inner = inMatch[1] ?? '';
      return inner === '' ? [] : parseInValuesFn(inner);
    }
    return rawValue;
  }

  if (operator === 'is') {
    if (rawValue === 'null') return null;
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
    return null;
  }

  if (operator === 'like' || operator === 'ilike') {
    return rawValue;
  }

  if (FULL_TEXT_SEARCH_OPERATORS.includes(operator as FilterOperator)) {
    return rawValue;
  }

  if (ARRAY_RANGE_OPERATORS.includes(operator as FilterOperator)) {
    return rawValue;
  }

  return parseValueFn(rawValue);
}

// --- Main Parser Class ---

/**
 * Parser for PostgREST query parameters.
 *
 * Converts URL search parameters into structured ParsedQuery objects
 * that can be consumed by the QueryBuilder.
 */
export class PostgrestParser {
  /**
   * Parse all query parameters from a URL search params object.
   *
   * @param searchParams - The URLSearchParams to parse
   * @returns Structured query representation
   */
  parse(searchParams: URLSearchParams): ParsedQuery {
    const result: ParsedQuery = {
      columns: '*',
      embedded: [],
      filters: [],
      order: [],
    };

    // Parse select parameter
    const select = searchParams.get('select');
    if (select) {
      const parsed = this.parseSelect(select);
      result.columns = parsed.columns;
      result.embedded = parsed.embedded;
    }

    // Parse order parameter
    const order = searchParams.get('order');
    if (order) {
      result.order = this.parseOrder(order);
    }

    // Parse limit and offset
    const limitStr = searchParams.get('limit');
    if (limitStr) {
      const limitValue = parseNonNegativeInt(limitStr);
      if (limitValue !== undefined) {
        result.limit = limitValue;
      }
    }

    const offsetStr = searchParams.get('offset');
    if (offsetStr) {
      const offsetValue = parseNonNegativeInt(offsetStr);
      if (offsetValue !== undefined) {
        result.offset = offsetValue;
      }
    }

    // Parse filters (all other parameters that match filter patterns)
    for (const [key, value] of searchParams.entries()) {
      if (!(RESERVED_PARAMS as readonly string[]).includes(key)) {
        const filter = this.parseFilter(key, value);
        if (filter) {
          result.filters.push(filter);
        }
      }
    }

    return result;
  }

  /**
   * Parse the select parameter into columns and embedded resources.
   *
   * Supports formats:
   * - `select=col1,col2` - specific columns
   * - `select=*` - all columns
   * - `select=*,posts(*)` - all columns with embedded resource
   * - `select=col1,posts:alias(col2,col3)` - embedded with alias
   *
   * @param select - The raw select parameter string
   * @returns Parsed columns and embedded resources
   */
  parseSelect(select: string): { columns: string[] | '*'; embedded: EmbeddedResource[] } {
    const columns: string[] = [];
    const embedded: EmbeddedResource[] = [];

    // Split by comma but respect parentheses
    const parts = this.splitByTopLevelComma(select);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check if this is an embedded resource (has parentheses)
      const embeddedResource = tryParseEmbeddedPart(trimmed, (s) => this.parseSelect(s));
      if (embeddedResource) {
        embedded.push(embeddedResource);
      } else if (trimmed === '*') {
        // Wildcard: return '*' for columns and parse remaining parts for embeds
        if (columns.length === 0) {
          return {
            columns: '*',
            embedded: this.extractEmbeddedFromParts(parts.slice(1)),
          };
        }
      } else {
        columns.push(trimmed);
      }
    }

    return {
      columns: columns.length > 0 ? columns : '*',
      embedded,
    };
  }

  /**
   * Split a string by commas, respecting nested parentheses.
   *
   * For example, `"a,b(c,d),e"` splits into `["a", "b(c,d)", "e"]`.
   *
   * @param input - The string to split
   * @returns Array of top-level segments
   */
  private splitByTopLevelComma(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let parenDepth = 0;

    for (const char of input) {
      if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        parenDepth--;
        current += char;
      } else if (char === ',' && parenDepth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Extract embedded resources from remaining parts after a wildcard ('*').
   *
   * @param parts - The remaining parts to check for embedded resources
   * @returns Array of parsed embedded resources
   */
  private extractEmbeddedFromParts(parts: string[]): EmbeddedResource[] {
    const embedded: EmbeddedResource[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      const embeddedResource = tryParseEmbeddedPart(trimmed, (s) => this.parseSelect(s));
      if (embeddedResource) {
        embedded.push(embeddedResource);
      }
    }

    return embedded;
  }

  /**
   * Parse the order parameter into OrderClause objects.
   *
   * Supports formats:
   * - `order=col.desc` - single column descending
   * - `order=col1.asc,col2.desc` - multiple columns
   * - `order=col.desc.nullsfirst` - with nulls ordering
   *
   * @param order - The raw order parameter string
   * @returns Array of order clauses
   */
  parseOrder(order: string): OrderClause[] {
    const clauses: OrderClause[] = [];
    const parts = order.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const match = trimmed.match(ORDER_CLAUSE_PATTERN);
      if (match) {
        const column = match[1];
        const direction = match[2] || 'asc';
        const nullsModifier = match[3];
        if (column) {
          const clause: OrderClause = {
            column,
            direction: direction.toLowerCase() as 'asc' | 'desc',
          };
          if (nullsModifier) {
            clause.nullsFirst = nullsModifier.toLowerCase() === 'nullsfirst';
          }
          clauses.push(clause);
        }
      }
    }

    return clauses;
  }

  /**
   * Parse a single filter from a query parameter key-value pair.
   *
   * Supports formats:
   * - `col=eq.value` - equality
   * - `col=gt.5` - comparison
   * - `col=in.(a,b,c)` - set membership
   * - `col=not.eq.value` - negation
   * - `col=fts(english).value` - FTS with language config
   * - `or=(col1.eq.val1,col2.gt.val2)` - logical OR
   *
   * @param column - The query parameter key (column name or logical operator)
   * @param value - The query parameter value (operator.value format)
   * @returns Parsed filter, or null if the value is empty or invalid
   */
  parseFilter(column: string, value: string): Filter | null {
    if (value === '') return null;

    // Handle logical operators (or, and)
    if (column === 'or' || column === 'and') {
      return {
        column,
        operator: column as FilterOperator,
        value: this.parseLogicalFilter(value),
      };
    }

    // Check for negation prefix
    const negateMatch = value.match(NEGATION_PREFIX_PATTERN);
    let filterValue = value;
    let negate = false;

    if (negateMatch && negateMatch[1]) {
      negate = true;
      filterValue = negateMatch[1];
    }

    // Match operator with optional language config
    const match = filterValue.match(FILTER_OPERATOR_PATTERN);
    if (!match) {
      // No operator specified, default to 'eq'
      return {
        column,
        operator: 'eq',
        value: filterValue,
        negate,
      };
    }

    const operator = match[1];
    const rawValue = match[2] ?? '';

    // Validate operator
    if (!operator || !VALID_FILTER_OPERATORS.includes(operator as FilterOperator)) {
      return null;
    }

    // Parse the value based on operator type
    const parsedValue = parseFilterValue(
      operator,
      rawValue,
      (v) => this.parseScalarValue(v),
      (inner) => this.parseInValues(inner),
    );

    return {
      column,
      operator: operator as FilterOperator,
      value: parsedValue,
      negate,
    };
  }

  /**
   * Parse values inside `in.(...)` supporting quoted strings with commas.
   *
   * Handles quoted values like `in.("hello, world","foo")` where commas
   * inside quotes are not treated as separators.
   *
   * @param inner - The string content inside the parentheses
   * @returns Array of parsed values
   */
  private parseInValues(inner: string): unknown[] {
    const values: unknown[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]!;
      if (char === '"' && !inQuotes) {
        inQuotes = true;
        continue;
      }
      if (char === '"' && inQuotes) {
        inQuotes = false;
        // Push the quoted string as-is (don't parse as number/boolean)
        values.push(current);
        current = '';
        // Skip trailing comma if present
        if (i + 1 < inner.length && inner[i + 1] === ',') {
          i++;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        values.push(this.parseScalarValue(current.trim()));
        current = '';
        continue;
      }
      current += char;
    }

    if (current.trim() !== '' || (!inQuotes && inner.length > 0 && !inner.endsWith('"'))) {
      if (current.trim() !== '') {
        values.push(this.parseScalarValue(current.trim()));
      }
    }

    return values;
  }

  /**
   * Parse a logical filter (or/and) containing nested conditions.
   *
   * Format: `(col1.eq.val1,col2.gt.val2)`
   *
   * @param value - The logical filter expression wrapped in parentheses
   * @returns Array of parsed sub-filters
   */
  private parseLogicalFilter(value: string): Filter[] {
    const filters: Filter[] = [];

    const match = value.match(LOGICAL_FILTER_PATTERN);
    if (!match || !match[1]) return filters;

    const conditions = this.splitByTopLevelComma(match[1]);

    for (const condition of conditions) {
      const trimmed = condition.trim();
      const dotIndex = trimmed.indexOf('.');
      if (dotIndex > -1) {
        const column = trimmed.substring(0, dotIndex);
        const rest = trimmed.substring(dotIndex + 1);
        const filter = this.parseFilter(column, rest);
        if (filter) {
          filters.push(filter);
        }
      }
    }

    return filters;
  }

  /**
   * Parse a scalar value, attempting to convert to number, boolean, or null
   * when the string representation matches known patterns.
   *
   * @param value - The raw string value
   * @returns Parsed value as number, boolean, null, or string
   */
  private parseScalarValue(value: string): unknown {
    // Integer
    if (INTEGER_PATTERN.test(value)) {
      return parseInt(value, DECIMAL_RADIX);
    }
    // Float
    if (FLOAT_PATTERN.test(value)) {
      return parseFloat(value);
    }
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    // Null
    if (value === 'null') return null;
    // Quoted string (remove surrounding quotes)
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    return value;
  }

  /**
   * Parse a Range header for pagination.
   *
   * Format: `items=0-24` (returns offset=0, limit=25)
   *
   * @param header - The raw Range header value
   * @returns Parsed offset and limit, or null if the header is invalid
   */
  parseRangeHeader(header: string): { offset: number; limit: number } | null {
    const match = header.match(RANGE_HEADER_PATTERN);
    if (!match) return null;

    const startStr = match[1];
    const endStr = match[2];
    if (!startStr || !endStr) return null;

    const start = parseInt(startStr, DECIMAL_RADIX);
    const end = parseInt(endStr, DECIMAL_RADIX);

    return {
      offset: start,
      limit: end - start + 1,
    };
  }

  /**
   * Validate a table name against an allowlist.
   *
   * Checks for:
   * - Empty or whitespace-only names
   * - SQL injection patterns (semicolons, comments, UNION, etc.)
   * - Valid PostgreSQL identifier format
   * - Maximum identifier length
   * - Presence in the allowlist
   *
   * @param tableName - The table name to validate
   * @param allowlist - Array of permitted table names
   * @throws Error if the table name is invalid or not in the allowlist
   */
  validateTableName(tableName: string, allowlist: string[]): void {
    if (!tableName || tableName.trim() === '') {
      throw new Error('Invalid table name: empty or whitespace');
    }

    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(tableName)) {
        throw new Error('Invalid table name: contains SQL injection pattern');
      }
    }

    if (!POSTGRES_IDENTIFIER_PATTERN.test(tableName)) {
      throw new Error('Invalid table name: invalid PostgreSQL identifier');
    }

    if (tableName.length > MAX_IDENTIFIER_LENGTH) {
      throw new Error(`Invalid table name: exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`);
    }

    if (!allowlist.includes(tableName)) {
      throw new Error(`Table '${tableName}' not found in allowlist`);
    }
  }

  /**
   * Parse and validate a table name from a URL path.
   *
   * Handles URL decoding, query string removal, path traversal prevention,
   * and validation against the allowlist.
   *
   * @param path - The raw URL path
   * @param allowlist - Array of permitted table names
   * @returns The validated table name
   * @throws Error if the path is invalid or the table name fails validation
   */
  parseTableFromPath(path: string, allowlist: string[]): string {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      throw new Error('Invalid table name: malformed URL encoding');
    }

    // Remove query string if present
    const queryIndex = decodedPath.indexOf('?');
    if (queryIndex !== -1) {
      decodedPath = decodedPath.substring(0, queryIndex);
    }

    // Extract the first path segment (table name)
    const segments = decodedPath.split('/').filter(s => s.length > 0);

    if (segments.length === 0) {
      throw new Error('Invalid table name: no table specified in path');
    }

    const tableName = segments[0];
    if (tableName === undefined) {
      throw new Error('Invalid table name: no table specified in path');
    }

    // Prevent path traversal
    if (tableName === '..' || tableName === '.') {
      throw new Error('Invalid table name: path traversal attempt');
    }

    this.validateTableName(tableName, allowlist);

    return tableName;
  }

  /**
   * Parse select parameter with table name validation for embedded resources.
   *
   * Validates all embedded resource names against the allowlist to prevent
   * SQL injection through resource embedding.
   *
   * @param select - The raw select parameter string
   * @param allowlist - Array of permitted table names
   * @returns Parsed select result after validating all embedded resource names
   * @throws Error if any embedded resource name fails validation
   */
  parseSelectWithValidation(select: string, allowlist: string[]): { columns: string[] | '*'; embedded: EmbeddedResource[] } {
    // First, check for invalid embedded resource patterns
    const parts = this.splitByTopLevelComma(select);
    for (const part of parts) {
      const trimmed = part.trim();
      // If it contains parentheses, it should be a valid embedded resource
      if (trimmed.includes('(') && trimmed.includes(')')) {
        const parenIndex = trimmed.indexOf('(');
        let potentialTableName = trimmed.substring(0, parenIndex);

        // Handle alias syntax: tableName:alias
        if (potentialTableName.includes(':')) {
          potentialTableName = potentialTableName.split(':')[0] ?? '';
        }

        this.validateTableName(potentialTableName, allowlist);
      }
    }

    const result = this.parseSelect(select);

    // Recursively validate all embedded resources
    this.validateEmbeddedResources(result.embedded, allowlist);

    return result;
  }

  /**
   * Recursively validate embedded resource names against an allowlist.
   *
   * @param embedded - Array of embedded resources to validate
   * @param allowlist - Array of permitted table names
   * @throws Error if any resource name fails validation
   */
  private validateEmbeddedResources(embedded: EmbeddedResource[], allowlist: string[]): void {
    for (const resource of embedded) {
      this.validateTableName(resource.name, allowlist);

      if (resource.embedded && resource.embedded.length > 0) {
        this.validateEmbeddedResources(resource.embedded, allowlist);
      }
    }
  }
}
