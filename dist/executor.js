export function hasTransactionCapability(executor) { return typeof executor.transaction === 'function'; }
export async function withOptionalTransaction(executor, callback, context) { if (executor.transaction)
    return executor.transaction(callback, context); return callback(executor); }
//# sourceMappingURL=executor.js.map