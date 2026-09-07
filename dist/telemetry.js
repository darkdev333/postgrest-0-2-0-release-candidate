export function emitObserver(observer, event) {
    if (!observer)
        return;
    try {
        observer(event);
    }
    catch { /* observers must never affect request behavior */ }
}
function safeHeaders(headers, options) {
    if (!options.includeHeaders)
        return undefined;
    const result = {};
    for (const [name, value] of headers.entries()) {
        const lower = name.toLowerCase();
        const defaultValue = lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie' ? '[REDACTED]' : value;
        const redacted = options.redactHeader ? options.redactHeader(name, defaultValue) : defaultValue;
        if (redacted !== undefined)
            result[name] = redacted;
    }
    return result;
}
function safeParams(params, options) {
    if (!options.includeParams || !params)
        return undefined;
    return params.map((value, index) => options.redactParam ? options.redactParam(value, index) : value);
}
function safeContext(context, options) {
    if (!context || options.includeContext === false)
        return undefined;
    const visible = {};
    if (context.schema !== undefined)
        visible.schema = context.schema;
    if (context.role !== undefined)
        visible.role = context.role;
    if (context.transactionEnd !== undefined)
        visible.transactionEnd = context.transactionEnd;
    if (options.includeSettings && context.settings) {
        const settings = {};
        for (const [name, value] of Object.entries(context.settings)) {
            const lower = name.toLowerCase();
            const defaultValue = lower.includes('jwt') || lower.includes('authorization') || lower.includes('cookie') || lower.includes('secret') || lower.includes('token') ? '[REDACTED]' : value;
            const redacted = options.redactSetting ? options.redactSetting(name, defaultValue) : defaultValue;
            if (redacted !== undefined)
                settings[name] = redacted;
        }
        if (Object.keys(settings).length)
            visible.settings = settings;
    }
    return visible;
}
export function requestHeadersForObserver(headers, options = {}) {
    return safeHeaders(headers, options);
}
export function paramsForObserver(params, options = {}) {
    return safeParams(params, options);
}
export function contextForObserver(context, options = {}) {
    return safeContext(context, options);
}
export function observedExecutor(executor, observer, options = {}) {
    if (!observer)
        return executor;
    const wrap = (execute, context) => async (sql, params = []) => {
        const visibleParams = safeParams(params, options);
        const visibleContext = safeContext(context, options);
        emitObserver(observer, { type: 'sql.generated', at: Date.now(), sql, ...(visibleParams && { params: visibleParams }), ...(visibleContext && { context: visibleContext }) });
        const started = Date.now();
        emitObserver(observer, { type: 'sql.execute.start', at: started, sql, ...(visibleParams && { params: visibleParams }), ...(visibleContext && { context: visibleContext }) });
        try {
            const result = await execute(sql, params);
            emitObserver(observer, { type: 'sql.execute.end', at: Date.now(), sql, durationMs: Date.now() - started, rowCount: result.rows.length, ...(visibleContext && { context: visibleContext }) });
            return result;
        }
        catch (error) {
            const err = error;
            emitObserver(observer, { type: 'error', at: Date.now(), stage: 'sql.execute', message: err?.message ?? String(error), ...(err?.code && { code: err.code, sqlState: err.code }), durationMs: Date.now() - started, sql, ...(visibleContext && { context: visibleContext }) });
            throw error;
        }
    };
    const observed = wrap(executor);
    if (executor.transaction) {
        observed.transaction = async (callback, context) => executor.transaction(execute => callback(wrap(execute, context)), context);
    }
    return observed;
}
//# sourceMappingURL=telemetry.js.map
