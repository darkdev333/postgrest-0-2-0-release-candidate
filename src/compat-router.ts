import { Hono, type Context } from 'hono'
import { createPostgRESTRouter as createBaseRouter, type PostgRESTRouterOptions } from './router.js'
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from './executor.js'
import { hasTransactionCapability, withOptionalTransaction } from './executor.js'
import { SchemaCache } from './schema.js'
import { RelationshipCache } from './relationship-cache.js'
import { parsePostgRESTSelect, type SelectNode } from './select.js'
import { buildReadPlan, expandSpreadStars, RelationshipResolutionError, type ReadPlan } from './read-plan.js'
import { applyReadQueryParams, ReadQueryPathError, RelatedOrderError } from './read-query.js'
import { buildReadCountSQL, buildReadSQL } from './read-sql.js'
import { parsePreferHeader, responsePreferences, setResponseHeaders, setCORSHeaders, type CORSOptions, type PreferHeader, type ResponseHeaderOptions } from './headers.js'
import { acceptsSingularObject, SINGULAR_MEDIA_TYPE } from './media.js'
import { invalidPreferences, ambiguousRelationship, noRelationship, notEmbedded, relatedOrderNotToOne, requestedRangeNotSatisfiable, singularCardinalityError } from './errors.js'
import { negativeLimitDetails, offsideOffsetDetails, parseRangeRequest, readStatus } from './range.js'
import { selectSchemaProfile } from './profiles.js'
import { isValidIdentifier } from '@dotdo/postgres-shared/validation'

const DECIMAL_RADIX = 10

function hasEmbed(nodes: SelectNode[]): boolean {
  return nodes.some(node => node.kind === 'embed')
}

function singular(c: Context, rows: Record<string, unknown>[], status: number): Response {
  if (rows.length !== 1) return c.json(singularCardinalityError(rows.length), 406)
  c.header('Content-Type', SINGULAR_MEDIA_TYPE)
  return c.json(rows[0], status as 200 | 201)
}

function rangeFailure(c: Context, details: string, totalCount?: number, head = false): Response {
  c.header('Content-Type', 'application/json')
  c.header('Range-Unit', 'items')
  if (totalCount !== undefined) c.header('Content-Range', `*/${totalCount}`)
  return head ? c.body(null, 416) : c.json(requestedRangeNotSatisfiable(details), 416)
}

function clampRootRange(plan: ReadPlan, defaultLimit: number, maxLimit: number): void {
  const requested = plan.limit ?? defaultLimit
  plan.limit = Math.min(requested, maxLimit)
}

/**
 * Compatibility wrapper around the mature flat router.
 * Embedded table GET/HEAD uses the upstream-derived relationship/read planner;
 * all other requests delegate to the existing router unchanged.
 */
export function createPostgRESTRouter(sql: SQLExecutor, options: PostgRESTRouterOptions = {}): Hono {
  const app = new Hono()
  const base = createBaseRouter(sql, options)
  const {
    schema = 'public', schemas, maxLimit = 1000, defaultLimit = 100, schemaCacheTTL = 60000,
    cors = true, corsOrigins, corsCredentials, corsMethods, corsAllowHeaders, corsExposeHeaders, corsMaxAge,
    validateTable = isValidIdentifier, transactionContext, dbTxEnd = false,
  } = options
  const allowedSchemas = schemas?.length ? [...schemas] : [schema]
  const tableCaches = new Map<string, SchemaCache>()
  const relationshipCaches = new Map<string, RelationshipCache>()

  const tableCacheFor = (activeSchema: string): SchemaCache => {
    let cache = tableCaches.get(activeSchema)
    if (!cache) {
      cache = new SchemaCache({ schema: activeSchema, cacheTTL: schemaCacheTTL, queryFn: sql })
      tableCaches.set(activeSchema, cache)
    }
    return cache
  }
  const relationshipCacheFor = (activeSchema: string): RelationshipCache => {
    let cache = relationshipCaches.get(activeSchema)
    if (!cache) {
      cache = new RelationshipCache({ schema: activeSchema, cacheTTL: schemaCacheTTL, queryFn: sql })
      relationshipCaches.set(activeSchema, cache)
    }
    return cache
  }

  async function inTx<T>(c: Context, activeSchema: string, prefer: PreferHeader, callback: (execute: SQLStatementExecutor) => Promise<T>): Promise<T> {
    const baseContext = transactionContext ? await transactionContext(c.req.raw, activeSchema) : { schema: activeSchema }
    const context: SQLTransactionContext = { ...baseContext, schema: baseContext.schema ?? activeSchema }
    if (dbTxEnd && prefer.tx) context.transactionEnd = prefer.tx
    return withOptionalTransaction(sql, callback, context)
  }

  function corsConfig(origin: string | undefined): CORSOptions | undefined {
    const config: CORSOptions = {}
    if (corsCredentials !== undefined) config.credentials = corsCredentials
    if (corsMethods) config.methods = corsMethods
    if (corsAllowHeaders) config.allowHeaders = corsAllowHeaders
    if (corsExposeHeaders) config.exposeHeaders = corsExposeHeaders
    if (corsMaxAge !== undefined) config.maxAge = corsMaxAge
    if (corsOrigins === '*') return { ...config, origin: '*' }
    if (corsOrigins instanceof RegExp) return { ...config, originPattern: corsOrigins, ...(origin !== undefined && { requestOrigin: origin }) }
    if (typeof corsOrigins === 'string') return origin && origin !== corsOrigins ? undefined : { ...config, origin: corsOrigins }
    if (Array.isArray(corsOrigins) && corsOrigins.length && origin !== undefined) return { ...config, allowedOrigins: corsOrigins, requestOrigin: origin }
    return undefined
  }

  if (cors) app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    await next()
    const config = corsConfig(origin)
    if (origin && config) setCORSHeaders(c.res.headers, config)
  })

  app.on(['GET', 'HEAD'], '/:table', async c => {
    const url = new URL(c.req.url)
    const selectRaw = url.searchParams.get('select')
    if (!selectRaw) return base.fetch(c.req.raw)

    let selectTree: SelectNode[]
    try { selectTree = parsePostgRESTSelect(selectRaw) }
    catch { return base.fetch(c.req.raw) }
    if (!hasEmbed(selectTree)) return base.fetch(c.req.raw)

    const isHead = c.req.method === 'HEAD'
    const table = c.req.param('table')
    const profile = selectSchemaProfile(c.req.method, c.req.header('Accept-Profile'), c.req.header('Content-Profile'), allowedSchemas)
    if (profile.error) return isHead ? c.body(null, 406) : c.json(profile.error, 406)
    const activeSchema = profile.schema!
    if (!validateTable(table)) return isHead ? c.body(null, 400) : c.json({ error: 'Invalid table name' }, 400)
    const tableCache = tableCacheFor(activeSchema)
    if (!(await tableCache.hasTable(table))) return isHead ? c.body(null, 404) : c.json({ error: `Table "${table}" not found` }, 404)

    const prefer = parsePreferHeader(c.req.header('Prefer'))
    if (prefer.handling === 'strict' && prefer.invalid?.length) return isHead ? c.body(null, 400) : c.json(invalidPreferences(prefer.invalid), 400)
    if (!dbTxEnd) delete prefer.tx
    else if (prefer.tx && !hasTransactionCapability(sql)) return isHead ? c.body(null, 501) : c.json({ code: 'PGRST501', details: null, hint: 'Provide SQLExecutor.transaction(callback, context) for rollback-capable request execution.', message: 'tx preference requires a transactional SQL executor' }, 501)

    try {
      const badLimit = negativeLimitDetails(url.searchParams)
      if (badLimit) return rangeFailure(c, badLimit, undefined, isHead)

      const relationships = await relationshipCacheFor(activeSchema).getRelationships()
      let plan = buildReadPlan(table, selectTree, relationships)
      plan = await expandSpreadStars(plan, async targetTable => {
        const target = await tableCache.getTable(targetTable)
        if (!target) throw new Error(`Table "${targetTable}" not found while expanding spread`)
        return [...target.columns.keys()]
      })
      plan = applyReadQueryParams(plan, url.searchParams)
      clampRootRange(plan, defaultLimit, maxLimit)

      const reqRange = parseRangeRequest(c.req.header('Range'))
      if (reqRange.kind === 'invalid') return rangeFailure(c, reqRange.details, undefined, isHead)
      if (reqRange.kind === 'valid') {
        plan.offset = reqRange.offset
        if (reqRange.limit !== undefined) plan.limit = Math.min(reqRange.limit, maxLimit)
      }

      const built = buildReadSQL(plan, activeSchema)
      const countBuilt = prefer.count && prefer.count !== 'none' ? buildReadCountSQL(plan, activeSchema) : undefined
      const { rows, totalCount } = await inTx(c, activeSchema, prefer, async execute => {
        const rows = (await execute(built.sql, built.params)).rows
        let totalCount: number | undefined
        if (countBuilt) {
          const countRows = (await execute(countBuilt.sql, countBuilt.params)).rows
          totalCount = parseInt(countRows[0]?.count as string, DECIMAL_RADIX) || 0
        }
        return { rows, totalCount }
      })

      const offset = plan.offset ?? 0
      if (totalCount !== undefined && offset > 0 && rows.length === 0 && offset >= totalCount) {
        return rangeFailure(c, offsideOffsetDetails(offset, totalCount), totalCount, isHead)
      }
      const meta: ResponseHeaderOptions = { offset, rowCount: rows.length }
      if (totalCount !== undefined) meta.totalCount = totalCount
      if (plan.limit !== undefined) meta.limit = plan.limit
      setResponseHeaders(c.res.headers, meta, responsePreferences(prefer, 'read'))
      c.header('Content-Profile', activeSchema)
      const status = readStatus(offset, rows.length, totalCount)
      if (isHead) return c.body(null, status)
      return acceptsSingularObject(c.req.header('Accept')) ? singular(c, rows, status) : c.json(rows, status)
    } catch (error) {
      if (error instanceof ReadQueryPathError) {
        return isHead ? c.body(null, 400) : c.json(notEmbedded(error.resource, error.hintText, error.detailsText), 400)
      }
      if (error instanceof RelatedOrderError) {
        return isHead ? c.body(null, 400) : c.json(relatedOrderNotToOne(error.parent, error.resource), 400)
      }
      if (error instanceof RelationshipResolutionError) {
        if (error.code === 'PGRST201') return isHead ? c.body(null, 300) : c.json(ambiguousRelationship(error.sourceTable, error.targetTable, error.candidates), 300)
        return isHead ? c.body(null, 400) : c.json(noRelationship(activeSchema, error.sourceTable, error.targetTable), 400)
      }
      return isHead ? c.body(null, 500) : c.json({ code: 'PGRST500', details: null, hint: null, message: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.all('*', c => base.fetch(c.req.raw))
  return app
}

export type { PostgRESTRouterOptions, SQLExecutor, SQLStatementExecutor, SQLTransactionContext }
