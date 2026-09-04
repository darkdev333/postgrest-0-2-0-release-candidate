/**
 * PostgREST Query Parameter Parser
 *
 * Parses PostgREST-style query parameters into structured objects
 * for SQL query building.
 */
/** Supported PostgREST filter operators */
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in' | 'cs' | 'cd' | 'ov' | 'sl' | 'sr' | 'nxl' | 'nxr' | 'adj' | 'not' | 'or' | 'and' | 'fts' | 'plfts' | 'phfts' | 'wfts';
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
/**
 * Parser for PostgREST query parameters.
 *
 * Converts URL search parameters into structured ParsedQuery objects
 * that can be consumed by the QueryBuilder.
 */
export declare class PostgrestParser {
    /**
     * Parse all query parameters from a URL search params object.
     *
     * @param searchParams - The URLSearchParams to parse
     * @returns Structured query representation
     */
    parse(searchParams: URLSearchParams): ParsedQuery;
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
    parseSelect(select: string): {
        columns: string[] | '*';
        embedded: EmbeddedResource[];
    };
    /**
     * Split a string by commas, respecting nested parentheses.
     *
     * For example, `"a,b(c,d),e"` splits into `["a", "b(c,d)", "e"]`.
     *
     * @param input - The string to split
     * @returns Array of top-level segments
     */
    private splitByTopLevelComma;
    /**
     * Extract embedded resources from remaining parts after a wildcard ('*').
     *
     * @param parts - The remaining parts to check for embedded resources
     * @returns Array of parsed embedded resources
     */
    private extractEmbeddedFromParts;
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
    parseOrder(order: string): OrderClause[];
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
    parseFilter(column: string, value: string): Filter | null;
    /**
     * Parse values inside `in.(...)` supporting quoted strings with commas.
     *
     * Handles quoted values like `in.("hello, world","foo")` where commas
     * inside quotes are not treated as separators.
     *
     * @param inner - The string content inside the parentheses
     * @returns Array of parsed values
     */
    private parseInValues;
    /**
     * Parse a logical filter (or/and) containing nested conditions.
     *
     * Format: `(col1.eq.val1,col2.gt.val2)`
     *
     * @param value - The logical filter expression wrapped in parentheses
     * @returns Array of parsed sub-filters
     */
    private parseLogicalFilter;
    /**
     * Parse a scalar value, attempting to convert to number, boolean, or null
     * when the string representation matches known patterns.
     *
     * @param value - The raw string value
     * @returns Parsed value as number, boolean, null, or string
     */
    private parseScalarValue;
    /**
     * Parse a Range header for pagination.
     *
     * Format: `items=0-24` (returns offset=0, limit=25)
     *
     * @param header - The raw Range header value
     * @returns Parsed offset and limit, or null if the header is invalid
     */
    parseRangeHeader(header: string): {
        offset: number;
        limit: number;
    } | null;
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
    validateTableName(tableName: string, allowlist: string[]): void;
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
    parseTableFromPath(path: string, allowlist: string[]): string;
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
    parseSelectWithValidation(select: string, allowlist: string[]): {
        columns: string[] | '*';
        embedded: EmbeddedResource[];
    };
    /**
     * Recursively validate embedded resource names against an allowlist.
     *
     * @param embedded - Array of embedded resources to validate
     * @param allowlist - Array of permitted table names
     * @throws Error if any resource name fails validation
     */
    private validateEmbeddedResources;
}
//# sourceMappingURL=parser.d.ts.map