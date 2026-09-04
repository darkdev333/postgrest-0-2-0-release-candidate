import type { RelationshipInfo } from './relationships.js';
export interface RelationshipQueryResult {
    rows: Record<string, unknown>[];
}
export interface RelationshipCacheOptions {
    schema?: string;
    cacheTTL?: number;
    queryFn: (sql: string, params?: unknown[]) => Promise<RelationshipQueryResult>;
}
export declare const RELATIONSHIPS_SQL = "\nWITH fk_constraints AS (\n  SELECT\n    src_ns.nspname AS source_schema,\n    src.relname AS source_table,\n    tgt.relname AS target_table,\n    con.conname AS constraint_name,\n    array_agg(src_att.attname ORDER BY key_cols.ord) AS source_columns,\n    array_agg(tgt_att.attname ORDER BY key_cols.ord) AS target_columns,\n    EXISTS (\n      SELECT 1\n      FROM pg_constraint uq\n      WHERE uq.conrelid = con.conrelid\n        AND uq.contype IN ('p','u')\n        AND (SELECT array_agg(x ORDER BY x) FROM unnest(uq.conkey) AS x)\n          = (SELECT array_agg(x ORDER BY x) FROM unnest(con.conkey) AS x)\n    ) AS source_unique,\n    COALESCE((\n      SELECT array_agg(pk_att.attname ORDER BY pk_key.ord)\n      FROM pg_constraint pk\n      CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY AS pk_key(attnum, ord)\n      JOIN pg_attribute pk_att ON pk_att.attrelid = pk.conrelid AND pk_att.attnum = pk_key.attnum\n      WHERE pk.conrelid = con.conrelid AND pk.contype = 'p'\n    ), ARRAY[]::name[]) AS source_primary_key\n  FROM pg_constraint con\n  JOIN pg_class src ON src.oid = con.conrelid\n  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace\n  JOIN pg_class tgt ON tgt.oid = con.confrelid\n  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS key_cols(src_attnum, tgt_attnum, ord)\n  JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = key_cols.src_attnum\n  JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = key_cols.tgt_attnum\n  WHERE con.contype = 'f' AND src_ns.nspname = $1\n  GROUP BY src_ns.nspname, src.relname, tgt.relname, con.conname, con.conrelid, con.conkey\n)\nSELECT source_schema, source_table, target_table, constraint_name,\n       source_columns, target_columns, source_unique, source_primary_key\nFROM fk_constraints\nORDER BY source_table, constraint_name\n";
export declare function relationshipsFromCatalogRows(rows: Record<string, unknown>[]): RelationshipInfo[];
export declare class RelationshipCache {
    private readonly schema;
    private readonly cacheTTL;
    private readonly queryFn;
    private cached;
    private lastRefresh;
    private refreshPromise;
    constructor(options: RelationshipCacheOptions);
    getRelationships(): Promise<RelationshipInfo[]>;
    refresh(): Promise<void>;
    clear(): void;
    private doRefresh;
}
//# sourceMappingURL=relationship-cache.d.ts.map