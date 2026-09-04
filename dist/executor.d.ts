/** Optional transactional/session capability for SQLExecutor. */
export interface SQLResult {
    rows: Record<string, unknown>[];
    /** Rows newly inserted by the statement when the executor can distinguish insert from conflict-update. */
    insertedCount?: number;
}
export interface SQLStatementExecutor {
    (sql: string, params?: unknown[]): Promise<SQLResult>;
}
export interface SQLTransactionContext {
    schema?: string;
    role?: string;
    settings?: Record<string, string>;
    /** Requested transaction disposition when PostgREST db-tx-end behavior is enabled. */
    transactionEnd?: 'commit' | 'rollback';
}
export interface SQLExecutor extends SQLStatementExecutor {
    transaction?<T>(callback: (execute: SQLStatementExecutor) => Promise<T>, context?: SQLTransactionContext): Promise<T>;
}
export declare function hasTransactionCapability(executor: SQLExecutor): executor is SQLExecutor & Required<Pick<SQLExecutor, 'transaction'>>;
export declare function withOptionalTransaction<T>(executor: SQLExecutor, callback: (execute: SQLStatementExecutor) => Promise<T>, context?: SQLTransactionContext): Promise<T>;
//# sourceMappingURL=executor.d.ts.map