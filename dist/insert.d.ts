/** PostgREST-compatible INSERT/UPSERT SQL compiler. */
import type { PreferHeader } from './headers.js';
export interface InsertCompileOptions {
    schema?: string;
    returning?: '*' | string[];
    missing?: 'default' | 'null';
    resolution?: 'merge-duplicates' | 'ignore-duplicates';
    conflictColumns?: string[];
}
export interface BuiltInsert {
    sql: string;
    params: unknown[];
}
/** Compile JSON object(s) using PostgREST missing/conflict semantics. */
export declare function buildInsertStatement(table: string, data: Record<string, unknown> | Record<string, unknown>[], options?: InsertCompileOptions): BuiltInsert;
/** Add mutation preferences omitted by the legacy header helper. */
export declare function applyInsertPreferenceHeaders(headers: Headers, prefer: PreferHeader): void;
//# sourceMappingURL=insert.d.ts.map