/** PostgREST-compatible PATCH compiler with explicit columns/missing semantics. */
import type { Filter } from './parser.js';
export interface UpdateCompileOptions {
    schema?: string;
    columns?: string[];
    missing?: 'default' | 'null';
    returning?: '*' | string[];
}
export interface BuiltUpdate {
    sql: string;
    params: unknown[];
}
export declare function buildUpdateStatement(table: string, data: Record<string, unknown>, filters: Filter[], options?: UpdateCompileOptions): BuiltUpdate | null;
//# sourceMappingURL=update.d.ts.map