import { Hono } from 'hono';
import { type PostgRESTRouterOptions as CompatibilityRouterOptions } from './compat-router.js';
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from './executor.js';
import { type PostgRESTObserver, type PostgRESTObserverOptions } from './telemetry.js';
export interface PostgRESTRouterOptions extends CompatibilityRouterOptions {
    /** Optional zero-behavior-impact structured diagnostics hook. */
    observer?: PostgRESTObserver;
    /** Controls sensitive telemetry fields such as headers, params and session settings. */
    observerOptions?: PostgRESTObserverOptions;
}
/**
 * Public package boundary.
 *
 * The compatibility router owns behavioral routing (flat vs embedded planner).
 * This boundary normalizes negotiated response media types and owns the optional
 * observer lifecycle so both router paths share one request/SQL/response stream.
 */
export declare function createPostgRESTRouter(sql: SQLExecutor, options?: PostgRESTRouterOptions): Hono;
export type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext };
//# sourceMappingURL=public-router.d.ts.map