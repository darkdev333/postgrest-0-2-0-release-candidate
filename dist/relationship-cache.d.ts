import type { RelationshipInfo } from './relationships.js';
export { VIEW_KEY_DEPENDENCIES_SQL, viewDependenciesFromCatalogRows } from './view-relationship-catalog.js';
export interface RelationshipQueryResult {
    rows: Record<string, unknown>[];
}
export interface RelationshipCacheOptions {
    schema?: string;
    extraSearchPath?: string[];
    cacheTTL?: number;
    queryFn: (sql: string, params?: unknown[]) => Promise<RelationshipQueryResult>;
}
export declare const RELATIONSHIPS_SQL = "\nWITH fk_constraints AS (\n  SELECT\n    src_ns.nspname AS source_schema,\n    src.relname AS source_table,\n    tgt_ns.nspname AS target_schema,\n    tgt.relname AS target_table,\n    con.conname AS constraint_name,\n    array_agg(src_att.attname ORDER BY key_cols.ord) AS source_columns,\n    array_agg(tgt_att.attname ORDER BY key_cols.ord) AS target_columns,\n    EXISTS (\n      SELECT 1\n      FROM pg_constraint uq\n      WHERE uq.conrelid = con.conrelid\n        AND uq.contype IN ('p','u')\n        AND (SELECT array_agg(x ORDER BY x) FROM unnest(uq.conkey) AS x)\n          = (SELECT array_agg(x ORDER BY x) FROM unnest(con.conkey) AS x)\n    ) AS source_unique,\n    COALESCE((\n      SELECT array_agg(pk_att.attname ORDER BY pk_key.ord)\n      FROM pg_constraint pk\n      CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY AS pk_key(attnum, ord)\n      JOIN pg_attribute pk_att ON pk_att.attrelid = pk.conrelid AND pk_att.attnum = pk_key.attnum\n      WHERE pk.conrelid = con.conrelid AND pk.contype = 'p'\n    ), ARRAY[]::name[]) AS source_primary_key\n  FROM pg_constraint con\n  JOIN pg_class src ON src.oid = con.conrelid\n  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace\n  JOIN pg_class tgt ON tgt.oid = con.confrelid\n  JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace\n  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS key_cols(src_attnum, tgt_attnum, ord)\n  JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = key_cols.src_attnum\n  JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = key_cols.tgt_attnum\n  WHERE con.contype = 'f'\n    AND con.conparentid = 0\n  GROUP BY src_ns.nspname, src.relname, tgt_ns.nspname, tgt.relname, con.conname, con.conrelid, con.conkey\n)\nSELECT source_schema, source_table, target_schema, target_table, constraint_name,\n       source_columns, target_columns, source_unique, source_primary_key\nFROM fk_constraints\nORDER BY source_table, constraint_name\n";
/** Discover PostgREST computed relationships: one-argument functions whose
 * argument is a composite relation type and whose return type is another
 * composite relation type. `ROWS 1` (or a non-SETOF return) marks a to-one
 * relationship, matching upstream's `not proretset or prorows = 1` rule. */
export declare const COMPUTED_RELATIONSHIPS_SQL = "\nWITH all_relations AS (\n  SELECT reltype\n  FROM pg_class\n  WHERE relkind IN ('v','r','m','f','p')\n)\nSELECT\n  fn_ns.nspname AS function_schema,\n  p.proname AS function_name,\n  arg_ns.nspname AS source_schema,\n  arg_type.typname AS source_table,\n  ret_ns.nspname AS target_schema,\n  ret_type.typname AS target_table,\n  (NOT p.proretset OR p.prorows = 1) AS single_row\nFROM pg_proc p\nJOIN pg_namespace fn_ns ON fn_ns.oid = p.pronamespace\nJOIN pg_type arg_type ON arg_type.oid = p.proargtypes[0]\nJOIN pg_namespace arg_ns ON arg_ns.oid = arg_type.typnamespace\nJOIN pg_type ret_type ON ret_type.oid = p.prorettype\nJOIN pg_namespace ret_ns ON ret_ns.oid = ret_type.typnamespace\nWHERE p.pronargs = 1\n  AND p.prokind = 'f'\n  AND p.proargtypes[0] IN (SELECT reltype FROM all_relations)\n  AND p.prorettype IN (SELECT reltype FROM all_relations)\n  AND fn_ns.nspname = $1\n  AND arg_ns.nspname = $1\n  AND ret_ns.nspname = $1\nORDER BY source_table, function_name\n";
/** Backwards-compatible table-only relationship assembly. */
export declare function relationshipsFromCatalogRows(rows: Record<string, unknown>[], exposedSchema?: string): RelationshipInfo[];
/** Upstream-ordered FK/view relationship graph assembly. Internal base FKs are
 * intentionally retained through view derivation, then removed at the end like
 * upstream `removeInternal`; pre-filtering here would lose valid exposed
 * view-to-view relationships derived from private underlying tables. */
export declare function relationshipsFromCatalogAndViewRows(rows: Record<string, unknown>[], viewRows: Record<string, unknown>[], exposedSchema?: string): RelationshipInfo[];
export declare function relationshipsFromComputedRows(rows: Record<string, unknown>[], exposedSchema?: string): RelationshipInfo[];
/** Match upstream getOverrideRelationshipsMap: a computed relationship named
 * like a detected foreign relation replaces the whole detected relationship
 * bucket for that source/target pair. */
export declare function applyComputedRelationshipOverrides(detected: RelationshipInfo[], computed: RelationshipInfo[]): RelationshipInfo[];
export declare class RelationshipCache {
    private readonly schema;
    private readonly extraSearchPath;
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