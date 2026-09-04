/**
 * SQL Query Builder
 *
 * Converts parsed PostgREST parameters into parameterized SQL queries
 * with proper quoting, JOIN handling, and pagination.
 */
import type { ParsedQuery, Filter } from './parser.js';
import type { TableSchema, ForeignKeyInfo } from './schema.js';
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
/**
 * SQL Query Builder for PostgREST-style queries.
 *
 * Converts parsed query parameters into properly parameterized SQL statements.
 * Handles SELECT, INSERT, UPDATE, DELETE, and RPC (function call) queries.
 */
export declare class QueryBuilder {
    private paramIndex;
    private params;
    private options;
    constructor(options?: QueryBuilderOptions);
    /**
     * Build a SELECT query from parsed parameters.
     *
     * @param table - Target table name
     * @param query - Parsed query parameters (columns, filters, order, etc.)
     * @param tableSchema - Optional table schema for column validation
     * @param foreignKeys - Optional foreign key map for embedded resource resolution
     * @returns Built query with optional count query
     */
    buildSelect(table: string, query: ParsedQuery, tableSchema?: TableSchema, foreignKeys?: Map<string, ForeignKeyInfo[]>): BuiltQuery;
    /**
     * Build an INSERT query.
     *
     * @param table - Target table name
     * @param data - Row(s) to insert (single object or array)
     * @param returning - Columns to return ('*' for all, array for specific, undefined for none)
     * @returns Built query
     * @throws Error if no data is provided
     */
    buildInsert(table: string, data: Record<string, unknown> | Record<string, unknown>[], returning?: string[] | '*'): BuiltQuery;
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
    buildUpdate(table: string, data: Record<string, unknown>, filters: Filter[], returning?: string[] | '*'): BuiltQuery;
    /**
     * Build a DELETE query.
     *
     * @param table - Target table name
     * @param filters - WHERE clause filters
     * @param returning - Columns to return
     * @returns Built query
     */
    buildDelete(table: string, filters: Filter[], returning?: string[] | '*'): BuiltQuery;
    /**
     * Build an RPC (stored function call) query.
     *
     * @param functionName - Name of the PostgreSQL function to call
     * @param args - Named arguments to pass to the function
     * @returns Built query
     */
    buildRPC(functionName: string, args?: Record<string, unknown>): BuiltQuery;
    /**
     * Build a schema-qualified, quoted table name.
     */
    private qualifiedTableName;
    /**
     * Build a RETURNING clause string (including the RETURNING keyword).
     * Returns empty string if no returning is specified.
     */
    private buildReturningClause;
    /**
     * Build column selection including embedded resource subqueries.
     */
    private buildColumns;
    /**
     * Build a WHERE clause from an array of filters.
     * Returns empty string if no filters are provided.
     */
    private buildWhere;
    /**
     * Build a single SQL condition from a filter.
     * Handles logical operators, IS, IN, LIKE, FTS, and standard comparisons.
     */
    private buildCondition;
    /**
     * Build an IS condition for null, true, or false checks.
     */
    private buildIsCondition;
    /**
     * Build an ORDER BY clause from order specifications.
     * Returns empty string if no order is specified.
     */
    private buildOrderBy;
    /**
     * Build a LIMIT/OFFSET clause, applying default and maximum limits.
     * Returns empty string if no pagination is needed.
     */
    private buildLimitOffset;
    /**
     * Build JOINs for embedded resources.
     * Currently returns empty as simple cases use subqueries in SELECT.
     * Reserved for more complex join scenarios.
     */
    private buildJoins;
    /**
     * Add a value to the parameter list and return its placeholder ($N).
     */
    private addParam;
    /**
     * Reset the builder state for a new query.
     */
    private reset;
}
/**
 * Convenience function to build a query without manually managing a QueryBuilder instance.
 *
 * @param type - The type of query to build
 * @param table - Target table (or function name for 'rpc')
 * @param options - Query-specific options
 * @returns Built query
 *
 * @example
 * ```ts
 * const query = buildQuery('select', 'users', {
 *   query: { columns: '*', embedded: [], filters: [], order: [] },
 * });
 * ```
 */
export declare function buildQuery(type: 'select' | 'insert' | 'update' | 'delete' | 'rpc', table: string, options?: {
    query?: ParsedQuery;
    data?: Record<string, unknown> | Record<string, unknown>[];
    filters?: Filter[];
    returning?: string[] | '*';
    args?: Record<string, unknown>;
    tableSchema?: TableSchema;
    foreignKeys?: Map<string, ForeignKeyInfo[]>;
    builderOptions?: QueryBuilderOptions;
}): BuiltQuery;
//# sourceMappingURL=builder.d.ts.map