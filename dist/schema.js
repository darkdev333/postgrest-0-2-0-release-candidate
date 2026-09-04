/**
 * Schema Cache
 *
 * Caches table/column metadata from the database for query building
 * and validation.
 */
/**
 * Schema cache for database introspection
 */
export class SchemaCache {
    tables = new Map();
    foreignKeysByTable = new Map();
    lastRefresh = 0;
    options;
    refreshPromise = null;
    constructor(options) {
        this.options = {
            schema: 'public',
            cacheTTL: 60000,
            ...options,
        };
    }
    /**
     * Get schema for a table, refreshing cache if needed
     */
    async getTable(tableName) {
        await this.ensureFresh();
        return this.tables.get(tableName);
    }
    /**
     * Get all tables in the schema
     */
    async getTables() {
        await this.ensureFresh();
        return new Map(this.tables);
    }
    /**
     * Get foreign keys that reference a specific table
     */
    async getForeignKeysTo(tableName) {
        await this.ensureFresh();
        return this.foreignKeysByTable.get(tableName) || [];
    }
    /**
     * Get all foreign key relationships
     */
    async getAllForeignKeys() {
        await this.ensureFresh();
        return new Map(this.foreignKeysByTable);
    }
    /**
     * Check if a table exists
     */
    async hasTable(tableName) {
        await this.ensureFresh();
        return this.tables.has(tableName);
    }
    /**
     * Get column info for a table
     */
    async getColumn(tableName, columnName) {
        const table = await this.getTable(tableName);
        return table?.columns.get(columnName);
    }
    /**
     * Validate that columns exist on a table
     */
    async validateColumns(tableName, columns) {
        const table = await this.getTable(tableName);
        if (!table) {
            return { valid: false, invalid: columns };
        }
        const invalid = columns.filter(col => !table.columns.has(col));
        return { valid: invalid.length === 0, invalid };
    }
    /**
     * Force a cache refresh
     */
    async refresh() {
        // Prevent concurrent refreshes
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.doRefresh();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = null;
        }
    }
    /**
     * Clear the cache
     */
    clear() {
        this.tables.clear();
        this.foreignKeysByTable.clear();
        this.lastRefresh = 0;
    }
    /**
     * Ensure cache is fresh, refreshing if necessary
     */
    async ensureFresh() {
        const now = Date.now();
        if (now - this.lastRefresh > this.options.cacheTTL) {
            await this.refresh();
        }
    }
    /**
     * Perform the actual cache refresh
     */
    async doRefresh() {
        const { schema, queryFn } = this.options;
        // Fetch tables and columns
        const columnsQuery = `
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN uq.column_name IS NOT NULL THEN true ELSE false END as is_unique
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
      ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
      LEFT JOIN (
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'UNIQUE'
          AND tc.table_schema = $1
      ) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
      WHERE c.table_schema = $1
      ORDER BY c.table_name, c.ordinal_position
    `;
        const columnsResult = await queryFn(columnsQuery, [schema]);
        // Fetch foreign keys
        const foreignKeysQuery = `
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
    `;
        const foreignKeysResult = await queryFn(foreignKeysQuery, [schema]);
        // Build table schemas
        const tableMap = new Map();
        const fkByTable = new Map();
        // Process columns
        for (const row of columnsResult.rows) {
            const tableName = row.table_name;
            if (!tableMap.has(tableName)) {
                tableMap.set(tableName, {
                    name: tableName,
                    schema,
                    columns: new Map(),
                    primaryKey: [],
                    foreignKeys: [],
                    indexes: [],
                });
            }
            const table = tableMap.get(tableName);
            const columnInfo = {
                name: row.column_name,
                type: row.data_type,
                nullable: row.is_nullable === 'YES',
                isPrimaryKey: row.is_primary_key,
                isUnique: row.is_unique,
            };
            if (row.column_default !== null && row.column_default !== undefined) {
                columnInfo.defaultValue = row.column_default;
            }
            if (row.character_maximum_length !== null && row.character_maximum_length !== undefined) {
                columnInfo.maxLength = row.character_maximum_length;
            }
            if (row.numeric_precision !== null && row.numeric_precision !== undefined) {
                columnInfo.precision = row.numeric_precision;
            }
            if (row.numeric_scale !== null && row.numeric_scale !== undefined) {
                columnInfo.scale = row.numeric_scale;
            }
            table.columns.set(columnInfo.name, columnInfo);
            if (columnInfo.isPrimaryKey) {
                table.primaryKey.push(columnInfo.name);
            }
        }
        // Process foreign keys
        for (const row of foreignKeysResult.rows) {
            const tableName = row.table_name;
            const referencedTable = row.referenced_table;
            const fkInfo = {
                name: row.constraint_name,
                column: row.column_name,
                referencedTable,
                referencedColumn: row.referenced_column,
            };
            const deleteRule = row.delete_rule;
            if (deleteRule === 'CASCADE' || deleteRule === 'SET NULL' || deleteRule === 'SET DEFAULT' || deleteRule === 'RESTRICT' || deleteRule === 'NO ACTION') {
                fkInfo.onDelete = deleteRule;
            }
            const updateRule = row.update_rule;
            if (updateRule === 'CASCADE' || updateRule === 'SET NULL' || updateRule === 'SET DEFAULT' || updateRule === 'RESTRICT' || updateRule === 'NO ACTION') {
                fkInfo.onUpdate = updateRule;
            }
            // Add to table schema
            const table = tableMap.get(tableName);
            if (table) {
                table.foreignKeys.push(fkInfo);
            }
            // Index by referenced table for lookups
            if (!fkByTable.has(referencedTable)) {
                fkByTable.set(referencedTable, []);
            }
            fkByTable.get(referencedTable).push(fkInfo);
        }
        // Update cache
        this.tables = tableMap;
        this.foreignKeysByTable = fkByTable;
        this.lastRefresh = Date.now();
    }
    /**
     * Get information for building resource embeddings
     */
    async getEmbeddingInfo(fromTable, toTable) {
        const fromSchema = await this.getTable(fromTable);
        const toSchema = await this.getTable(toTable);
        if (!fromSchema || !toSchema) {
            return undefined;
        }
        // Check if fromTable has a FK to toTable (many-to-one)
        const fkToTarget = fromSchema.foreignKeys.find(fk => fk.referencedTable === toTable);
        if (fkToTarget) {
            return { type: 'many-to-one', foreignKey: fkToTarget };
        }
        // Check if toTable has a FK to fromTable (one-to-many)
        const fkFromTarget = toSchema.foreignKeys.find(fk => fk.referencedTable === fromTable);
        if (fkFromTarget) {
            return { type: 'one-to-many', foreignKey: fkFromTarget };
        }
        return undefined;
    }
}
//# sourceMappingURL=schema.js.map