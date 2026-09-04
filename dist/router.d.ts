/** PostgREST-compatible Hono router for a SQLExecutor-backed PostgreSQL adapter. */
import { Hono } from 'hono';
import { type PreferHeader } from './headers.js';
import { type SQLExecutor, type SQLStatementExecutor, type SQLTransactionContext } from './executor.js';
export interface PostgRESTRouterOptions {
    schema?: string;
    schemas?: string[];
    basePath?: string;
    maxLimit?: number;
    defaultLimit?: number;
    schemaCacheTTL?: number;
    cors?: boolean;
    corsOrigins?: string | string[] | RegExp;
    corsCredentials?: boolean;
    corsMethods?: string[];
    corsAllowHeaders?: string[];
    corsExposeHeaders?: string[];
    corsMaxAge?: number;
    validateTable?: (table: string) => boolean;
    validateFunction?: (fn: string) => boolean;
    transactionContext?: (request: Request, schema: string) => SQLTransactionContext | Promise<SQLTransactionContext>;
    dbTxEnd?: boolean;
}
export declare function createPostgRESTRouter(sql: SQLExecutor, options?: PostgRESTRouterOptions): Hono;
export type { PreferHeader, SQLExecutor, SQLStatementExecutor, SQLTransactionContext };
//# sourceMappingURL=router.d.ts.map