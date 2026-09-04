/**
 * Schema Cache
 *
 * Caches table/column metadata from the database for query building
 * and validation.
 */
export interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    maxLength?: number;
    precision?: number;
    scale?: number;
}
export interface ForeignKeyInfo {
    name: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
    onDelete?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
}
export interface TableSchema {
    name: string;
    schema: string;
    columns: Map<string, ColumnInfo>;
    primaryKey: string[];
    foreignKeys: ForeignKeyInfo[];
    indexes: string[];
}
export interface SchemaCacheOptions {
    /** Schema name to introspect (default: 'public') */
    schema?: string;
    /** TTL for cached data in milliseconds (default: 60000) */
    cacheTTL?: number;
    /** Function to execute SQL queries */
    queryFn: (sql: string, params?: unknown[]) => Promise<{
        rows: Record<string, unknown>[];
    }>;
}
/**
 * Schema cache for database introspection
 */
export declare class SchemaCache {
    private tables;
    private foreignKeysByTable;
    private lastRefresh;
    private options;
    private refreshPromise;
    constructor(options: SchemaCacheOptions);
    /**
     * Get schema for a table, refreshing cache if needed
     */
    getTable(tableName: string): Promise<TableSchema | undefined>;
    /**
     * Get all tables in the schema
     */
    getTables(): Promise<Map<string, TableSchema>>;
    /**
     * Get foreign keys that reference a specific table
     */
    getForeignKeysTo(tableName: string): Promise<ForeignKeyInfo[]>;
    /**
     * Get all foreign key relationships
     */
    getAllForeignKeys(): Promise<Map<string, ForeignKeyInfo[]>>;
    /**
     * Check if a table exists
     */
    hasTable(tableName: string): Promise<boolean>;
    /**
     * Get column info for a table
     */
    getColumn(tableName: string, columnName: string): Promise<ColumnInfo | undefined>;
    /**
     * Validate that columns exist on a table
     */
    validateColumns(tableName: string, columns: string[]): Promise<{
        valid: boolean;
        invalid: string[];
    }>;
    /**
     * Force a cache refresh
     */
    refresh(): Promise<void>;
    /**
     * Clear the cache
     */
    clear(): void;
    /**
     * Ensure cache is fresh, refreshing if necessary
     */
    private ensureFresh;
    /**
     * Perform the actual cache refresh
     */
    private doRefresh;
    /**
     * Get information for building resource embeddings
     */
    getEmbeddingInfo(fromTable: string, toTable: string): Promise<{
        type: 'many-to-one' | 'one-to-many';
        foreignKey: ForeignKeyInfo;
    } | undefined>;
}
//# sourceMappingURL=schema.d.ts.map