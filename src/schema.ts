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
  queryFn: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Schema cache for database introspection
 */
export class SchemaCache {
  private tables: Map<string, TableSchema> = new Map();
  private foreignKeysByTable: Map<string, ForeignKeyInfo[]> = new Map();
  private lastRefresh: number = 0;
  private options: Required<SchemaCacheOptions>;
  private refreshPromise: Promise<void> | null = null;

  constructor(options: SchemaCacheOptions) {
    this.options = {
      schema: 'public',
      cacheTTL: 60000,
      ...options,
    };
  }

  /**
   * Get schema for a table, refreshing cache if needed
   */
  async getTable(tableName: string): Promise<TableSchema | undefined> {
    await this.ensureFresh();
    return this.tables.get(tableName);
  }

  /**
   * Get all tables in the schema
   */
  async getTables(): Promise<Map<string, TableSchema>> {
    await this.ensureFresh();
    return new Map(this.tables);
  }

  /**
   * Get foreign keys that reference a specific table
   */
  async getForeignKeysTo(tableName: string): Promise<ForeignKeyInfo[]> {
    await this.ensureFresh();
    return this.foreignKeysByTable.get(tableName) || [];
  }

  /**
   * Get all foreign key relationships
   */
  async getAllForeignKeys(): Promise<Map<string, ForeignKeyInfo[]>> {
    await this.ensureFresh();
    return new Map(this.foreignKeysByTable);
  }

  /**
   * Check if a table exists
   */
  async hasTable(tableName: string): Promise<boolean> {
    await this.ensureFresh();
    return this.tables.has(tableName);
  }

  /**
   * Get column info for a table
   */
  async getColumn(tableName: string, columnName: string): Promise<ColumnInfo | undefined> {
    const table = await this.getTable(tableName);
    return table?.columns.get(columnName);
  }

  /**
   * Validate that columns exist on a table
   */
  async validateColumns(tableName: string, columns: string[]): Promise<{ valid: boolean; invalid: string[] }> {
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
  async refresh(): Promise<void> {
    // Prevent concurrent refreshes
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.tables.clear();
    this.foreignKeysByTable.clear();
    this.lastRefresh = 0;
  }

  /**
   * Ensure cache is fresh, refreshing if necessary
   */
  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefresh > this.options.cacheTTL) {
      await this.refresh();
    }
  }

  /**
   * Perform the actual cache refresh
   */
  private async doRefresh(): Promise<void> {
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
    const tableMap = new Map<string, TableSchema>();
    const fkByTable = new Map<string, ForeignKeyInfo[]>();

    // Process columns
    for (const row of columnsResult.rows) {
      const tableName = row.table_name as string;

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

      const table = tableMap.get(tableName)!;

      const columnInfo: ColumnInfo = {
        name: row.column_name as string,
        type: row.data_type as string,
        nullable: row.is_nullable === 'YES',
        isPrimaryKey: row.is_primary_key as boolean,
        isUnique: row.is_unique as boolean,
      };

      if (row.column_default !== null && row.column_default !== undefined) {
        columnInfo.defaultValue = row.column_default as string;
      }
      if (row.character_maximum_length !== null && row.character_maximum_length !== undefined) {
        columnInfo.maxLength = row.character_maximum_length as number;
      }
      if (row.numeric_precision !== null && row.numeric_precision !== undefined) {
        columnInfo.precision = row.numeric_precision as number;
      }
      if (row.numeric_scale !== null && row.numeric_scale !== undefined) {
        columnInfo.scale = row.numeric_scale as number;
      }

      table.columns.set(columnInfo.name, columnInfo);

      if (columnInfo.isPrimaryKey) {
        table.primaryKey.push(columnInfo.name);
      }
    }

    // Process foreign keys
    for (const row of foreignKeysResult.rows) {
      const tableName = row.table_name as string;
      const referencedTable = row.referenced_table as string;

      const fkInfo: ForeignKeyInfo = {
        name: row.constraint_name as string,
        column: row.column_name as string,
        referencedTable,
        referencedColumn: row.referenced_column as string,
      };

      const deleteRule = row.delete_rule as string | null | undefined;
      if (deleteRule === 'CASCADE' || deleteRule === 'SET NULL' || deleteRule === 'SET DEFAULT' || deleteRule === 'RESTRICT' || deleteRule === 'NO ACTION') {
        fkInfo.onDelete = deleteRule;
      }
      const updateRule = row.update_rule as string | null | undefined;
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
      fkByTable.get(referencedTable)!.push(fkInfo);
    }

    // Update cache
    this.tables = tableMap;
    this.foreignKeysByTable = fkByTable;
    this.lastRefresh = Date.now();
  }

  /**
   * Get information for building resource embeddings
   */
  async getEmbeddingInfo(
    fromTable: string,
    toTable: string
  ): Promise<{ type: 'many-to-one' | 'one-to-many'; foreignKey: ForeignKeyInfo } | undefined> {
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
