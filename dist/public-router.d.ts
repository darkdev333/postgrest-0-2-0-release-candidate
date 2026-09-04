import { Hono } from 'hono';
import { type PostgRESTRouterOptions } from './compat-router.js';
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from './executor.js';
/**
 * Public package boundary.
 *
 * The compatibility router owns behavioral routing (flat vs embedded planner).
 * This boundary normalizes negotiated response media types so successful
 * application/vnd.pgrst.object(+json) requests match upstream PostgREST even
 * while the older flat-router implementation is being retired internally.
 */
export declare function createPostgRESTRouter(sql: SQLExecutor, options?: PostgRESTRouterOptions): Hono;
export type { PostgRESTRouterOptions, SQLExecutor, SQLStatementExecutor, SQLTransactionContext };
//# sourceMappingURL=public-router.d.ts.map