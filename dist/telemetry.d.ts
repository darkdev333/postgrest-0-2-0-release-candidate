import type { SQLExecutor, SQLTransactionContext } from './executor.js';
import type { PostgRESTErrorBody } from './errors.js';
export interface PostgRESTObserverOptions {
    /** Include request headers. Disabled by default. Authorization/Cookie are redacted unless overridden. */
    includeHeaders?: boolean;
    /** Include bound SQL parameter values. Disabled by default. */
    includeParams?: boolean;
    /** Include transaction/session context. Enabled by default, but settings are omitted unless includeSettings is true. */
    includeContext?: boolean;
    /** Include request-local PostgreSQL settings inside transaction context. Disabled by default. */
    includeSettings?: boolean;
    redactHeader?: (name: string, value: string) => string | undefined;
    redactParam?: (value: unknown, index: number) => unknown;
    redactSetting?: (name: string, value: string) => string | undefined;
}
export type PostgRESTTelemetryEvent = {
    type: 'request.received';
    at: number;
    method: string;
    url: string;
    headers?: Record<string, string>;
} | {
    type: 'request.parsed';
    at: number;
    method: string;
    url: string;
    schema?: string;
    query: unknown;
} | {
    type: 'query.built';
    at: number;
    schema?: string;
    query: unknown;
} | {
    type: 'sql.generated';
    at: number;
    sql: string;
    params?: unknown[];
    context?: SQLTransactionContext;
} | {
    type: 'sql.execute.start';
    at: number;
    sql: string;
    params?: unknown[];
    context?: SQLTransactionContext;
} | {
    type: 'sql.execute.end';
    at: number;
    sql: string;
    durationMs: number;
    rowCount: number;
    context?: SQLTransactionContext;
} | {
    type: 'response.created';
    at: number;
    method: string;
    url: string;
    status: number;
    durationMs: number;
} | {
    type: 'error';
    at: number;
    stage: string;
    message: string;
    code?: string;
    sqlState?: string;
    normalized?: PostgRESTErrorBody;
    durationMs?: number;
    sql?: string;
    context?: SQLTransactionContext;
};
export type PostgRESTObserver = (event: PostgRESTTelemetryEvent) => void;
export declare function emitObserver(observer: PostgRESTObserver | undefined, event: PostgRESTTelemetryEvent): void;
export declare function requestHeadersForObserver(headers: Headers, options?: PostgRESTObserverOptions): Record<string, string> | undefined;
export declare function paramsForObserver(params: unknown[] | undefined, options?: PostgRESTObserverOptions): unknown[] | undefined;
export declare function contextForObserver(context: SQLTransactionContext | undefined, options?: PostgRESTObserverOptions): SQLTransactionContext | undefined;
export declare function observedExecutor(executor: SQLExecutor, observer: PostgRESTObserver | undefined, options?: PostgRESTObserverOptions): SQLExecutor;
//# sourceMappingURL=telemetry.d.ts.map
