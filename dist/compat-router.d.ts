import { Hono } from 'hono';
import { type PostgRESTRouterOptions } from './router.js';
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from './executor.js';
/**
 * Compatibility wrapper around the mature flat router.
 * Embedded table GET/HEAD uses the upstream-derived relationship/read planner;
 * all other requests delegate to the existing router unchanged.
 */
export declare function createPostgRESTRouter(sql: SQLExecutor, options?: PostgRESTRouterOptions): Hono;
export type { PostgRESTRouterOptions, SQLExecutor, SQLStatementExecutor, SQLTransactionContext };
//# sourceMappingURL=compat-router.d.ts.map