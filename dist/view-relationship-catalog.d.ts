import type { ViewKeyDependency } from './view-relationships.js';
/**
 * PostgreSQL catalog query adapted from upstream PostgREST
 * `SchemaCache.allViewsKeyDependencies`.
 *
 * The only deliberate transport adaptation is the final `json_agg` shape: the
 * Haskell implementation decodes an array of composites, while the TypeScript
 * SQLExecutor boundary is more portable when the same pairs are returned as
 * JSON objects. Relationship semantics and recursive dependency traversal are
 * unchanged.
 *
 * $1: exposed schema names (text[])
 * $2: extra search-path schema names (text[])
 */
export declare const VIEW_KEY_DEPENDENCIES_SQL: string;
export declare function viewDependenciesFromCatalogRows(rows: Record<string, unknown>[]): ViewKeyDependency[];
//# sourceMappingURL=view-relationship-catalog.d.ts.map