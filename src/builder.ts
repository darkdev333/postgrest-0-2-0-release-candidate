/**
 * SQL Query Builder
 *
 * Converts parsed PostgREST parameters into parameterized SQL queries
 * with proper quoting, JOIN handling, and pagination.
 */

import type { ParsedQuery, Filter, OrderClause, EmbeddedResource, FilterOperator } from './parser.js';
import type { TableSchema, ForeignKeyInfo } from './schema.js';

// --- Constants ---

/** Default maximum rows per query */
const DEFAULT_MAX_LIMIT = 1000;

/** Default rows per query when no limit is specified */
const DEFAULT_LIMIT = 100;

/** Initial parameter index for parameterized queries */
const INITIAL_PARAM_INDEX = 1;

/**
 * Mapping of PostgREST filter operators to their SQL equivalents.
 * Full-text search operators all use @@ but differ in their tsquery function.
 */
const OPERATOR_MAP: Record<FilterOperator, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
  match: '~',
  imatch: '~*',
  is: 'IS',
  isdistinct: 'IS DISTINCT FROM',
  in: 'IN',
  cs: '@>',      // contains
  cd: '<@',      // contained by
  ov: '&&',      // overlaps
  sl: '<<',      // strictly left of
  sr: '>>',      // strictly right of
  nxl: '&>',     // does not extend to the left of
  nxr: '&<',     // does not extend to the right of
  adj: '-|-',    // is adjacent to
  not: 'NOT',
  or: 'OR',
  and: 'AND',
  fts: '@@',     // full text search (to_tsquery)
  plfts: '@@',   // plain full text search (plainto_tsquery)
  phfts: '@@',   // phrase full text search (phraseto_tsquery)
  wfts: '@@',    // websearch full text search (websearch_to_tsquery)
};

/**
 * Mapping of full-text search operators to their PostgreSQL tsquery functions.
 */
const FTS_FUNCTION_MAP: Partial<Record<FilterOperator, string>> = {
  fts: 'to_tsquery',
  plfts: 'plainto_tsquery',
  phfts: 'phraseto_tsquery',
  wfts: 'websearch_to_tsquery',
};

// --- Types ---

/** A built SQL query with parameterized values */
export interface BuiltQuery {
  /** The parameterized SQL query string */
  sql: string;
  /** Array of parameter values corresponding to $1, $2, etc. */
  params: unknown[];
  /** Optional count query for pagination (SELECT COUNT(*) ...) */
  countSql?: string;
}

/** Configuration options for the QueryBuilder */
export interface QueryBuilderOptions {
  /** PostgreSQL schema name (default: none) */
  schema?: string;
  /** Maximum rows per query (default: 1000) */
  maxLimit?: number;
  /** Default rows per query when no limit specified (default: 100) */
  defaultLimit?: number;
}

// --- Query Builder Class ---

/**
 * SQL Query Builder for PostgREST-style queries.
 *
 * Converts parsed query parameters into properly parameterized SQL statements.
 * Handles SELECT, INSERT, UPDATE, DELETE, and RPC (function call) queries.
 */
export class QueryBuilder {
  private paramIndex = INITIAL_PARAM_INDEX;
  private params: unknown[] = [];
  private options: Required<Pick<QueryBuilderOptions, 'maxLimit' | 'defaultLimit'>> & QueryBuilderOptions;

  constructor(options: QueryBuilderOptions = {}) {
    this.options = {
      maxLimit: DEFAULT_MAX_LIMIT,
      defaultLimit: DEFAULT_LIMIT,
      ...options,
    };
  }

  /**
   * Build a SELECT query from parsed parameters.
   *
   * @param table - Target table name
   * @param query - Parsed query parameters (columns, filters, order, etc.)
   * @param tableSchema - Optional table schema for column validation
   * @param foreignKeys - Optional foreign key map for embedded resource resolution
   * @returns Built query with optional count query
   */
  buildSelect(
    table: string,
    query: ParsedQuery,
    tableSchema?: TableSchema,
    foreignKeys?: Map<string, ForeignKeyInfo[]>
  ): BuiltQuery {
    this.reset();

    const tableName = this.qualifiedTableName(table);

    const columns = this.buildColumns(query.columns, table, query.embedded, tableSchema, foreignKeys);
    const where = this.buildWhere(query.filters);
    const orderBy = this.buildOrderBy(query.order);
    const limitOffset = this.buildLimitOffset(query.limit, query.offset);
    const joins = this.buildJoins(table, query.embedded, foreignKeys);

    // Assemble the main query
    let sql = `SELECT ${columns} FROM ${tableName}`;
    if (joins) sql += ` ${joins}`;
    if (where) sql += ` WHERE ${where}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    if (limitOffset) sql += ` ${limitOffset}`;

    // Build count query if requested
    let countSql: string | undefined;
    if (query.count) {
      countSql = `SELECT COUNT(*) FROM ${tableName}`;
      if (joins) countSql += ` ${joins}`;
      if (where) countSql += ` WHERE ${where}`;
    }

    const result: BuiltQuery = {
      sql,
      params: [...this.params],
    };

    if (countSql !== undefined) {
      result.countSql = countSql;
    }

    return result;
  }

  /**
   * Build an INSERT query.
   *
   * @param table - Target table name
   * @param data - Row(s) to insert (single object or array)
   * @param returning - Columns to return ('*' for all, array for specific, undefined for none)
   * @returns Built query
   * @throws Error if no data is provided
   */
  buildInsert(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    returning?: string[] | '*'
  ): BuiltQuery {
    this.reset();

    const tableName = this.qualifiedTableName(table);

    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
      throw new Error('No data provided for insert');
    }

    // Collect all unique column names across all rows
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const quotedColumns = columns.map(c => `"${c}"`).join(', ');

    // Build VALUES clause with parameters
    const valuesClauses: string[] = [];
    for (const row of rows) {
      const rowValues = columns.map(col => {
        const value = row[col];
        return value === undefined ? 'DEFAULT' : this.addParam(value);
      });
      valuesClauses.push(`(${rowValues.join(', ')})`);
    }

    let sql = `INSERT INTO ${tableName} (${quotedColumns}) VALUES ${valuesClauses.join(', ')}`;
    sql += this.buildReturningClause(returning);

    return {
      sql,
      params: [...this.params],
    };
  }

  /**
   * Build an UPDATE query.
   *
   * @param table - Target table name
   * @param data - Column-value pairs to update
   * @param filters - WHERE clause filters
   * @param returning - Columns to return
   * @returns Built query
   * @throws Error if no data is provided
   */
  buildUpdate(
    table: string,
    data: Record<string, unknown>,
    filters: Filter[],
    returning?: string[] | '*'
  ): BuiltQuery {
    this.reset();

    const tableName = this.qualifiedTableName(table);

    // Build SET clause
    const setClauses: string[] = [];
    for (const [column, value] of Object.entries(data)) {
      setClauses.push(`"${column}" = ${this.addParam(value)}`);
    }

    if (setClauses.length === 0) {
      throw new Error('No data provided for update');
    }

    let sql = `UPDATE ${tableName} SET ${setClauses.join(', ')}`;

    const where = this.buildWhere(filters);
    if (where) sql += ` WHERE ${where}`;

    sql += this.buildReturningClause(returning);

    return {
      sql,
      params: [...this.params],
    };
  }

  /**
   * Build a DELETE query.
   *
   * @param table - Target table name
   * @param filters - WHERE clause filters
   * @param returning - Columns to return
   * @returns Built query
   */
  buildDelete(
    table: string,
    filters: Filter[],
    returning?: string[] | '*'
  ): BuiltQuery {
    this.reset();

    const tableName = this.qualifiedTableName(table);

    let sql = `DELETE FROM ${tableName}`;

    const where = this.buildWhere(filters);
    if (where) sql += ` WHERE ${where}`;

    sql += this.buildReturningClause(returning);

    return {
      sql,
      params: [...this.params],
    };
  }

  /**
   * Build an RPC (stored function call) query.
   *
   * @param functionName - Name of the PostgreSQL function to call
   * @param args - Named arguments to pass to the function
   * @returns Built query
   */
  buildRPC(
    functionName: string,
    args: Record<string, unknown> = {}
  ): BuiltQuery {
    this.reset();

    const schemaPrefix = this.options.schema ? `"${this.options.schema}".` : '';

    // Build named argument list
    const argEntries = Object.keys(args).map(name => {
      return `"${name}" => ${this.addParam(args[name])}`;
    });

    const sql = `SELECT * FROM ${schemaPrefix}"${functionName}"(${argEntries.join(', ')})`;

    return {
      sql,
      params: [...this.params],
    };
  }

  // --- Private Methods ---

  /**
   * Build a schema-qualified, quoted table name.
   */
  private qualifiedTableName(table: string): string {
    const schemaPrefix = this.options.schema ? `"${this.options.schema}".` : '';
    return `${schemaPrefix}"${table}"`;
  }

  /**
   * Build a RETURNING clause string (including the RETURNING keyword).
   * Returns empty string if no returning is specified.
   */
  private buildReturningClause(returning?: string[] | '*'): string {
    if (!returning) return '';
    const cols = returning === '*' ? '*' : returning.map(c => `"${c}"`).join(', ');
    return ` RETURNING ${cols}`;
  }

  /**
   * Build column selection including embedded resource subqueries.
   */
  private buildColumns(
    columns: string[] | '*',
    table: string,
    embedded: EmbeddedResource[],
    tableSchema?: TableSchema,
    foreignKeys?: Map<string, ForeignKeyInfo[]>
  ): string {
    void tableSchema;

    if (columns === '*' && embedded.length === 0) {
      return `"${table}".*`;
    }

    const parts: string[] = [];

    if (columns === '*') {
      parts.push(`"${table}".*`);
    } else {
      for (const col of columns) {
        const aliasMatch = col.match(/^(\w+):(\w+)$/);
        if (aliasMatch) {
          parts.push(`"${table}"."${aliasMatch[1]}" AS "${aliasMatch[2]}"`);
        } else {
          parts.push(`"${table}"."${col}"`);
        }
      }
    }

    for (const embed of embedded) {
      const fk = foreignKeys?.get(embed.name)?.[0];
      if (fk) {
        const subColumns = embed.columns === '*'
          ? '*'
          : (embed.columns as string[]).map(c => `"${c}"`).join(', ');

        const alias = embed.alias || embed.name;
        parts.push(`(
          SELECT COALESCE(json_agg(sub), '[]'::json)
          FROM (
            SELECT ${subColumns}
            FROM "${fk.referencedTable}"
            WHERE "${fk.referencedTable}"."${fk.referencedColumn}" = "${table}"."${fk.column}"
          ) sub
        ) AS "${alias}"`);
      }
    }

    return parts.join(', ');
  }

  private buildWhere(filters: Filter[]): string {
    if (filters.length === 0) return '';
    const conditions: string[] = [];
    for (const filter of filters) {
      const condition = this.buildCondition(filter);
      if (condition) conditions.push(condition);
    }
    return conditions.join(' AND ');
  }

  private buildCondition(filter: Filter): string {
    const { column, operator, value, negate, config, quantifier } = filter;

    if (operator === 'or' || operator === 'and') {
      const subConditions = (value as Filter[]).map(f => this.buildCondition(f)).filter(Boolean);
      const combined = `(${subConditions.join(operator === 'or' ? ' OR ' : ' AND ')})`;
      return negate ? `NOT (${combined})` : combined;
    }

    let condition: string;
    switch (operator) {
      case 'is':
        condition = this.buildIsCondition(column, value);
        break;
      case 'isdistinct':
        condition = `"${column}" IS DISTINCT FROM ${this.addParam(value)}`;
        break;
      case 'in': {
        const values = value as unknown[];
        condition = values.length === 0 ? 'FALSE' : `"${column}" IN (${values.map(v => this.addParam(v)).join(', ')})`;
        break;
      }
      case 'like':
      case 'ilike':
      case 'match':
      case 'imatch': {
        const operand = (operator === 'like' || operator === 'ilike') && typeof value === 'string' ? value.replace(/\*/g, '%') : value;
        const rhs = this.addParam(operand);
        condition = `"${column}" ${OPERATOR_MAP[operator]} ${quantifier ? `${quantifier.toUpperCase()}(${rhs})` : rhs}`;
        break;
      }
      case 'fts':
      case 'plfts':
      case 'phfts':
      case 'wfts': {
        const ftsFunction = FTS_FUNCTION_MAP[operator]!;
        const args = config ? `${this.addParam(config)}, ${this.addParam(value)}` : this.addParam(value);
        condition = `"${column}" @@ ${ftsFunction}(${args})`;
        break;
      }
      default: {
        const rhs = this.addParam(value);
        condition = `"${column}" ${OPERATOR_MAP[operator] || '='} ${quantifier ? `${quantifier.toUpperCase()}(${rhs})` : rhs}`;
      }
    }

    return negate ? `NOT (${condition})` : condition;
  }

  private buildIsCondition(column: string, value: unknown): string {
    if (value === null) return `"${column}" IS NULL`;
    if (value === true) return `"${column}" IS TRUE`;
    if (value === false) return `"${column}" IS FALSE`;
    if (value === 'not_null') return `"${column}" IS NOT NULL`;
    if (value === 'unknown') return `"${column}" IS UNKNOWN`;
    return `"${column}" IS ${this.addParam(value)}`;
  }

  private buildOrderBy(order: OrderClause[]): string {
    if (order.length === 0) return '';
    return order
      .map(({ column, direction, nullsFirst }) => {
        let clause = `"${column}" ${direction.toUpperCase()}`;
        if (nullsFirst !== undefined) clause += nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
        return clause;
      })
      .join(', ');
  }

  private buildLimitOffset(limit?: number, offset?: number): string {
    const parts: string[] = [];
    let effectiveLimit = limit ?? this.options.defaultLimit;
    if (effectiveLimit !== undefined && this.options.maxLimit !== undefined) effectiveLimit = Math.min(effectiveLimit, this.options.maxLimit);
    if (effectiveLimit !== undefined) parts.push(`LIMIT ${effectiveLimit}`);
    if (offset !== undefined && offset > 0) parts.push(`OFFSET ${offset}`);
    return parts.join(' ');
  }

  private buildJoins(
    _table: string,
    _embedded: EmbeddedResource[],
    _foreignKeys?: Map<string, ForeignKeyInfo[]>
  ): string {
    return '';
  }

  private addParam(value: unknown): string {
    this.params.push(value);
    return '$' + this.paramIndex++;
  }

  private reset(): void {
    this.paramIndex = INITIAL_PARAM_INDEX;
    this.params = [];
  }
}

export function buildQuery(
  type: 'select' | 'insert' | 'update' | 'delete' | 'rpc',
  table: string,
  options: {
    query?: ParsedQuery;
    data?: Record<string, unknown> | Record<string, unknown>[];
    filters?: Filter[];
    returning?: string[] | '*';
    args?: Record<string, unknown>;
    tableSchema?: TableSchema;
    foreignKeys?: Map<string, ForeignKeyInfo[]>;
    builderOptions?: QueryBuilderOptions;
  } = {}
): BuiltQuery {
  const builder = new QueryBuilder(options.builderOptions);

  switch (type) {
    case 'select':
      return builder.buildSelect(
        table,
        options.query || { columns: '*', embedded: [], filters: [], order: [] },
        options.tableSchema,
        options.foreignKeys
      );
    case 'insert':
      return builder.buildInsert(table, options.data || {}, options.returning);
    case 'update':
      return builder.buildUpdate(table, options.data as Record<string, unknown> || {}, options.filters || [], options.returning);
    case 'delete':
      return builder.buildDelete(table, options.filters || [], options.returning);
    case 'rpc':
      return builder.buildRPC(table, options.args);
    default:
      throw new Error(`Unknown query type: ${type}`);
  }
}
