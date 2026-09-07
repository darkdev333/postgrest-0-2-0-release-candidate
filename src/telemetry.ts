import type { SQLExecutor, SQLResult, SQLStatementExecutor, SQLTransactionContext } from './executor.js'
import type { PostgRESTErrorBody } from './errors.js'

export interface PostgRESTObserverOptions {
  /** Include request headers. Disabled by default. Authorization/Cookie are redacted unless overridden. */
  includeHeaders?: boolean
  /** Include bound SQL parameter values. Disabled by default. */
  includeParams?: boolean
  /** Include transaction/session context. Enabled by default, but settings are omitted unless includeSettings is true. */
  includeContext?: boolean
  /** Include request-local PostgreSQL settings inside transaction context. Disabled by default. */
  includeSettings?: boolean
  redactHeader?: (name: string, value: string) => string | undefined
  redactParam?: (value: unknown, index: number) => unknown
  redactSetting?: (name: string, value: string) => string | undefined
}

export type PostgRESTTelemetryEvent =
  | { type: 'request.received'; at: number; method: string; url: string; headers?: Record<string, string> }
  | { type: 'request.parsed'; at: number; method: string; url: string; schema?: string; query: unknown }
  | { type: 'query.built'; at: number; schema?: string; query: unknown }
  | { type: 'sql.generated'; at: number; sql: string; params?: unknown[]; context?: SQLTransactionContext }
  | { type: 'sql.execute.start'; at: number; sql: string; params?: unknown[]; context?: SQLTransactionContext }
  | { type: 'sql.execute.end'; at: number; sql: string; durationMs: number; rowCount: number; context?: SQLTransactionContext }
  | { type: 'response.created'; at: number; method: string; url: string; status: number; durationMs: number }
  | { type: 'error'; at: number; stage: string; message: string; code?: string; sqlState?: string; normalized?: PostgRESTErrorBody; durationMs?: number; sql?: string; context?: SQLTransactionContext }

export type PostgRESTObserver = (event: PostgRESTTelemetryEvent) => void

export function emitObserver(observer: PostgRESTObserver | undefined, event: PostgRESTTelemetryEvent): void {
  if (!observer) return
  try { observer(event) } catch { /* observers must never affect request behavior */ }
}

function safeHeaders(headers: Headers, options: PostgRESTObserverOptions): Record<string, string> | undefined {
  if (!options.includeHeaders) return undefined
  const result: Record<string, string> = {}
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase()
    const defaultValue = lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie' ? '[REDACTED]' : value
    const redacted = options.redactHeader ? options.redactHeader(name, defaultValue) : defaultValue
    if (redacted !== undefined) result[name] = redacted
  }
  return result
}

function safeParams(params: unknown[] | undefined, options: PostgRESTObserverOptions): unknown[] | undefined {
  if (!options.includeParams || !params) return undefined
  return params.map((value, index) => options.redactParam ? options.redactParam(value, index) : value)
}

function safeContext(context: SQLTransactionContext | undefined, options: PostgRESTObserverOptions): SQLTransactionContext | undefined {
  if (!context || options.includeContext === false) return undefined
  const visible: SQLTransactionContext = {}
  if (context.schema !== undefined) visible.schema = context.schema
  if (context.role !== undefined) visible.role = context.role
  if (context.transactionEnd !== undefined) visible.transactionEnd = context.transactionEnd
  if (options.includeSettings && context.settings) {
    const settings: Record<string, string> = {}
    for (const [name, value] of Object.entries(context.settings)) {
      const lower = name.toLowerCase()
      const defaultValue = lower.includes('jwt') || lower.includes('authorization') || lower.includes('cookie') || lower.includes('secret') || lower.includes('token') ? '[REDACTED]' : value
      const redacted = options.redactSetting ? options.redactSetting(name, defaultValue) : defaultValue
      if (redacted !== undefined) settings[name] = redacted
    }
    if (Object.keys(settings).length) visible.settings = settings
  }
  return visible
}

export function requestHeadersForObserver(headers: Headers, options: PostgRESTObserverOptions = {}): Record<string, string> | undefined {
  return safeHeaders(headers, options)
}

export function paramsForObserver(params: unknown[] | undefined, options: PostgRESTObserverOptions = {}): unknown[] | undefined {
  return safeParams(params, options)
}

export function contextForObserver(context: SQLTransactionContext | undefined, options: PostgRESTObserverOptions = {}): SQLTransactionContext | undefined {
  return safeContext(context, options)
}

export function observedExecutor(
  executor: SQLExecutor,
  observer: PostgRESTObserver | undefined,
  options: PostgRESTObserverOptions = {},
): SQLExecutor {
  if (!observer) return executor

  const wrap = (execute: SQLStatementExecutor, context?: SQLTransactionContext): SQLStatementExecutor => async (sql, params = []) => {
    const visibleParams = safeParams(params, options)
    const visibleContext = safeContext(context, options)
    emitObserver(observer, { type: 'sql.generated', at: Date.now(), sql, ...(visibleParams && { params: visibleParams }), ...(visibleContext && { context: visibleContext }) })
    const started = Date.now()
    emitObserver(observer, { type: 'sql.execute.start', at: started, sql, ...(visibleParams && { params: visibleParams }), ...(visibleContext && { context: visibleContext }) })
    try {
      const result: SQLResult = await execute(sql, params)
      emitObserver(observer, { type: 'sql.execute.end', at: Date.now(), sql, durationMs: Date.now() - started, rowCount: result.rows.length, ...(visibleContext && { context: visibleContext }) })
      return result
    } catch (error) {
      const err = error as { message?: string; code?: string }
      emitObserver(observer, { type: 'error', at: Date.now(), stage: 'sql.execute', message: err?.message ?? String(error), ...(err?.code && { code: err.code, sqlState: err.code }), durationMs: Date.now() - started, sql, ...(visibleContext && { context: visibleContext }) })
      throw error
    }
  }

  const observed = wrap(executor) as SQLExecutor
  if (executor.transaction) {
    observed.transaction = async <T>(callback: (execute: SQLStatementExecutor) => Promise<T>, context?: SQLTransactionContext): Promise<T> =>
      executor.transaction!(execute => callback(wrap(execute, context)), context)
  }
  return observed
}
