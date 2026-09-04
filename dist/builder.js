/**
 * SQL Query Builder
 *
 * Converts parsed PostgREST parameters into parameterized SQL queries
 * with proper quoting, JOIN handling, and pagination.
 */
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
const OPERATOR_MAP = {
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
    is: 'IS',
    in: 'IN',
    cs: '@>',
    cd: '<@',
    ov: '&&',
    sl: '<<',
    sr: '>>',
    nxl: '&<',
    nxr: '&>',
    adj: '-|-',
    not: 'NOT',
    or: 'OR',
    and: 'AND',
    fts: '@@',
    plfts: '@@',
    phfts: '@@',
    wfts: '@@', // websearch full text search (websearch_to_tsquery)
};
/**
 * Mapping of full-text search operators to their PostgreSQL tsquery functions.
 */
const FTS_FUNCTION_MAP = {
    fts: 'to_tsquery',
    plfts: 'plainto_tsquery',
    phfts: 'phraseto_tsquery',
    wfts: 'websearch_to_tsquery',
};
// --- Query Builder Class ---
/**
 * SQL Query Builder for PostgREST-style queries.
 *
 * Converts parsed query parameters into properly parameterized SQL statements.
 * Handles SELECT, INSERT, UPDATE, DELETE, and RPC (function call) queries.
 */
export class QueryBuilder {
    paramIndex = INITIAL_PARAM_INDEX;
    params = [];
    options;
    constructor(options = {}) {
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
    buildSelect(table, query, tableSchema, foreignKeys) {
        this.reset();
        const tableName = this.qualifiedTableName(table);
        const columns = this.buildColumns(query.columns, table, query.embedded, tableSchema, foreignKeys);
        const where = this.buildWhere(query.filters);
        const orderBy = this.buildOrderBy(query.order);
        const limitOffset = this.buildLimitOffset(query.limit, query.offset);
        const joins = this.buildJoins(table, query.embedded, foreignKeys);
        // Assemble the main query
        let sql = `SELECT ${columns} FROM ${tableName}`;
        if (joins)
            sql += ` ${joins}`;
        if (where)
            sql += ` WHERE ${where}`;
        if (orderBy)
            sql += ` ORDER BY ${orderBy}`;
        if (limitOffset)
            sql += ` ${limitOffset}`;
        // Build count query if requested
        let countSql;
        if (query.count) {
            countSql = `SELECT COUNT(*) FROM ${tableName}`;
            if (joins)
                countSql += ` ${joins}`;
            if (where)
                countSql += ` WHERE ${where}`;
        }
        const result = {
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
    buildInsert(table, data, returning) {
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
        const valuesClauses = [];
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
    buildUpdate(table, data, filters, returning) {
        this.reset();
        const tableName = this.qualifiedTableName(table);
        // Build SET clause
        const setClauses = [];
        for (const [column, value] of Object.entries(data)) {
            setClauses.push(`"${column}" = ${this.addParam(value)}`);
        }
        if (setClauses.length === 0) {
            throw new Error('No data provided for update');
        }
        let sql = `UPDATE ${tableName} SET ${setClauses.join(', ')}`;
        const where = this.buildWhere(filters);
        if (where)
            sql += ` WHERE ${where}`;
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
    buildDelete(table, filters, returning) {
        this.reset();
        const tableName = this.qualifiedTableName(table);
        let sql = `DELETE FROM ${tableName}`;
        const where = this.buildWhere(filters);
        if (where)
            sql += ` WHERE ${where}`;
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
    buildRPC(functionName, args = {}) {
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
    qualifiedTableName(table) {
        const schemaPrefix = this.options.schema ? `"${this.options.schema}".` : '';
        return `${schemaPrefix}"${table}"`;
    }
    /**
     * Build a RETURNING clause string (including the RETURNING keyword).
     * Returns empty string if no returning is specified.
     */
    buildReturningClause(returning) {
        if (!returning)
            return '';
        const cols = returning === '*' ? '*' : returning.map(c => `"${c}"`).join(', ');
        return ` RETURNING ${cols}`;
    }
    /**
     * Build column selection including embedded resource subqueries.
     */
    buildColumns(columns, table, embedded, tableSchema, foreignKeys) {
        // tableSchema is available for future use (type validation, column existence checks)
        void tableSchema;
        if (columns === '*' && embedded.length === 0) {
            return `"${table}".*`;
        }
        const parts = [];
        if (columns === '*') {
            parts.push(`"${table}".*`);
        }
        else {
            for (const col of columns) {
                // Handle alias notation: col:alias
                const aliasMatch = col.match(/^(\w+):(\w+)$/);
                if (aliasMatch) {
                    parts.push(`"${table}"."${aliasMatch[1]}" AS "${aliasMatch[2]}"`);
                }
                else {
                    parts.push(`"${table}"."${col}"`);
                }
            }
        }
        // Build subqueries for embedded resources
        for (const embed of embedded) {
            const fk = foreignKeys?.get(embed.name)?.[0];
            if (fk) {
                const subColumns = embed.columns === '*'
                    ? '*'
                    : embed.columns.map(c => `"${c}"`).join(', ');
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
    /**
     * Build a WHERE clause from an array of filters.
     * Returns empty string if no filters are provided.
     */
    buildWhere(filters) {
        if (filters.length === 0)
            return '';
        const conditions = [];
        for (const filter of filters) {
            const condition = this.buildCondition(filter);
            if (condition) {
                conditions.push(condition);
            }
        }
        return conditions.join(' AND ');
    }
    /**
     * Build a single SQL condition from a filter.
     * Handles logical operators, IS, IN, LIKE, FTS, and standard comparisons.
     */
    buildCondition(filter) {
        const { column, operator, value, negate } = filter;
        // Handle logical operators (OR/AND groups)
        if (operator === 'or' || operator === 'and') {
            const subFilters = value;
            const subConditions = subFilters.map(f => this.buildCondition(f)).filter(Boolean);
            const joiner = operator === 'or' ? ' OR ' : ' AND ';
            return `(${subConditions.join(joiner)})`;
        }
        let condition;
        switch (operator) {
            case 'is':
                condition = this.buildIsCondition(column, value);
                break;
            case 'in': {
                const values = value;
                const placeholders = values.map(v => this.addParam(v)).join(', ');
                condition = `"${column}" IN (${placeholders})`;
                break;
            }
            case 'like':
            case 'ilike': {
                // Convert PostgREST wildcards (*) to SQL wildcards (%)
                const likeValue = typeof value === 'string' ? value.replace(/\*/g, '%') : value;
                condition = `"${column}" ${OPERATOR_MAP[operator]} ${this.addParam(likeValue)}`;
                break;
            }
            case 'fts':
            case 'plfts':
            case 'phfts':
            case 'wfts': {
                const ftsFunction = FTS_FUNCTION_MAP[operator];
                condition = `"${column}" @@ ${ftsFunction}(${this.addParam(value)})`;
                break;
            }
            default: {
                const sqlOperator = OPERATOR_MAP[operator] || '=';
                condition = `"${column}" ${sqlOperator} ${this.addParam(value)}`;
            }
        }
        return negate ? `NOT (${condition})` : condition;
    }
    /**
     * Build an IS condition for null, true, or false checks.
     */
    buildIsCondition(column, value) {
        if (value === null)
            return `"${column}" IS NULL`;
        if (value === true)
            return `"${column}" IS TRUE`;
        if (value === false)
            return `"${column}" IS FALSE`;
        return `"${column}" IS ${this.addParam(value)}`;
    }
    /**
     * Build an ORDER BY clause from order specifications.
     * Returns empty string if no order is specified.
     */
    buildOrderBy(order) {
        if (order.length === 0)
            return '';
        return order
            .map(({ column, direction, nullsFirst }) => {
            let clause = `"${column}" ${direction.toUpperCase()}`;
            if (nullsFirst !== undefined) {
                clause += nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
            }
            return clause;
        })
            .join(', ');
    }
    /**
     * Build a LIMIT/OFFSET clause, applying default and maximum limits.
     * Returns empty string if no pagination is needed.
     */
    buildLimitOffset(limit, offset) {
        const parts = [];
        // Apply default/max limits
        let effectiveLimit = limit ?? this.options.defaultLimit;
        if (effectiveLimit !== undefined && this.options.maxLimit !== undefined) {
            effectiveLimit = Math.min(effectiveLimit, this.options.maxLimit);
        }
        if (effectiveLimit !== undefined) {
            parts.push(`LIMIT ${effectiveLimit}`);
        }
        if (offset !== undefined && offset > 0) {
            parts.push(`OFFSET ${offset}`);
        }
        return parts.join(' ');
    }
    /**
     * Build JOINs for embedded resources.
     * Currently returns empty as simple cases use subqueries in SELECT.
     * Reserved for more complex join scenarios.
     */
    buildJoins(_table, _embedded, _foreignKeys) {
        return '';
    }
    /**
     * Add a value to the parameter list and return its placeholder ($N).
     */
    addParam(value) {
        this.params.push(value);
        return '$' + this.paramIndex++;
    }
    /**
     * Reset the builder state for a new query.
     */
    reset() {
        this.paramIndex = INITIAL_PARAM_INDEX;
        this.params = [];
    }
}
// --- Convenience Function ---
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
export function buildQuery(type, table, options = {}) {
    const builder = new QueryBuilder(options.builderOptions);
    switch (type) {
        case 'select':
            return builder.buildSelect(table, options.query || { columns: '*', embedded: [], filters: [], order: [] }, options.tableSchema, options.foreignKeys);
        case 'insert':
            return builder.buildInsert(table, options.data || {}, options.returning);
        case 'update':
            return builder.buildUpdate(table, options.data || {}, options.filters || [], options.returning);
        case 'delete':
            return builder.buildDelete(table, options.filters || [], options.returning);
        case 'rpc':
            return builder.buildRPC(table, options.args);
        default:
            throw new Error(`Unknown query type: ${type}`);
    }
}
//# sourceMappingURL=builder.js.map