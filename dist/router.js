/** PostgREST-compatible Hono router for a SQLExecutor-backed PostgreSQL adapter. */
import { Hono } from 'hono';
import { PostgrestParser } from './parser.js';
import { QueryBuilder } from './builder.js';
import { SchemaCache } from './schema.js';
import { RoutineCache, matchRoutineByNamedArgs, routineSignature } from './routines.js';
import { buildRpcEnvelopeQuery, decodeRpcEnvelope, partitionGetRpcParams } from './rpc.js';
import { buildUpdateStatement } from './update.js';
import { parsePreferHeader, responsePreferences, setResponseHeaders, getResponseStatus, setCORSHeaders, buildLocationHeader } from './headers.js';
import { isValidIdentifier } from '@dotdo/postgres-shared/validation';
import { normalizePostgRESTError, requestedRangeNotSatisfiable, singularCardinalityError, maxAffectedViolation, maxAffectedRpcUnsupported, invalidPreferences, noRpc, ambiguousRpc } from './errors.js';
import { acceptsSingularObject, SINGULAR_MEDIA_TYPE } from './media.js';
import { negativeLimitDetails, offsideOffsetDetails, parseRangeRequest, readStatus } from './range.js';
import { selectSchemaProfile } from './profiles.js';
import { buildInsertStatement } from './insert.js';
import { hasTransactionCapability, withOptionalTransaction } from './executor.js';
const HTTP_NO_CONTENT = 204, DECIMAL_RADIX = 10;
class SingularMutationMismatch extends Error {
    rowCount;
    constructor(rowCount) {
        super(`singular mutation affected ${rowCount} rows`);
        this.rowCount = rowCount;
    }
}
class MaxAffectedMismatch extends Error {
    rowCount;
    constructor(rowCount) {
        super(`mutation affected ${rowCount} rows`);
        this.rowCount = rowCount;
    }
}
function atomicCapabilityBody(reason) { return { code: 'PGRST501', details: null, hint: 'Provide SQLExecutor.transaction(callback, context) for rollback-capable request execution.', message: reason === 'singular' ? 'Atomic singular mutation requires a transactional SQL executor' : reason === 'max-affected' ? 'max-affected enforcement requires a transactional SQL executor' : 'tx preference requires a transactional SQL executor' }; }
function formatRpcResult(rows) { const first = rows[0]; if (rows.length === 1 && first && Object.keys(first).length === 1) {
    const key = Object.keys(first)[0];
    if (key)
        return first[key];
} return rows; }
function returning(prefer, force = false) { return force || prefer.return === 'representation' ? '*' : undefined; }
function handleError(c, error) { if (error instanceof SingularMutationMismatch)
    return c.json(singularCardinalityError(error.rowCount), 406); if (error instanceof MaxAffectedMismatch)
    return c.json(maxAffectedViolation(error.rowCount), 400); const normalized = normalizePostgRESTError(error); return c.json(normalized.body, normalized.status); }
function singular(c, rows, status = 200) { if (rows.length !== 1)
    return c.json(singularCardinalityError(rows.length), 406); c.header('Content-Type', SINGULAR_MEDIA_TYPE); return c.json(rows[0], status); }
function rangeFailure(c, details, totalCount, head = false) { c.header('Content-Type', 'application/json'); c.header('Range-Unit', 'items'); if (totalCount !== undefined)
    c.header('Content-Range', `*/${totalCount}`); return head ? c.body(null, 416) : c.json(requestedRangeNotSatisfiable(details), 416); }
function missingColumnError(table, column) { return { code: 'PGRST204', details: null, hint: null, message: `Could not find the '${column}' column of '${table}' in the schema cache` }; }
export function createPostgRESTRouter(sql, options = {}) {
    const router = new Hono(), parser = new PostgrestParser();
    const { schema = 'public', schemas, basePath = '', maxLimit = 1000, defaultLimit = 100, schemaCacheTTL = 60000, cors = true, corsOrigins, corsCredentials, corsMethods, corsAllowHeaders, corsExposeHeaders, corsMaxAge, validateTable = isValidIdentifier, validateFunction = isValidIdentifier, transactionContext, dbTxEnd = false } = options;
    const allowedSchemas = schemas && schemas.length ? [...schemas] : [schema], caches = new Map(), routineCache = new RoutineCache(sql, schemaCacheTTL), baseBuilderOptions = { maxLimit, defaultLimit };
    function cacheFor(activeSchema) { let cache = caches.get(activeSchema); if (!cache) {
        cache = new SchemaCache({ schema: activeSchema, cacheTTL: schemaCacheTTL, queryFn: sql });
        caches.set(activeSchema, cache);
    } return cache; }
    function profileFor(c) { return selectSchemaProfile(c.req.method, c.req.header('Accept-Profile'), c.req.header('Content-Profile'), allowedSchemas); }
    function preparePrefer(c) { const prefer = parsePreferHeader(c.req.header('Prefer')); if (prefer.handling === 'strict' && prefer.invalid?.length)
        return { response: c.json(invalidPreferences(prefer.invalid), 400) }; if (!dbTxEnd)
        delete prefer.tx;
    else if (prefer.tx && !hasTransactionCapability(sql))
        return { response: c.json(atomicCapabilityBody('tx'), 501) }; return { prefer }; }
    async function inTx(c, activeSchema, prefer, callback) { const base = transactionContext ? await transactionContext(c.req.raw, activeSchema) : { schema: activeSchema }; const context = { ...base, schema: base.schema ?? activeSchema }; if (dbTxEnd && prefer?.tx)
        context.transactionEnd = prefer.tx; return withOptionalTransaction(sql, callback, context); }
    function corsOptions(origin) { const base = {}; if (corsCredentials !== undefined)
        base.credentials = corsCredentials; if (corsMethods)
        base.methods = corsMethods; if (corsAllowHeaders)
        base.allowHeaders = corsAllowHeaders; if (corsExposeHeaders)
        base.exposeHeaders = corsExposeHeaders; if (corsMaxAge !== undefined)
        base.maxAge = corsMaxAge; if (corsOrigins === '*')
        return { ...base, origin: '*' }; if (corsOrigins instanceof RegExp)
        return { ...base, originPattern: corsOrigins, ...(origin !== undefined && { requestOrigin: origin }) }; if (typeof corsOrigins === 'string')
        return origin && origin !== corsOrigins ? undefined : { ...base, origin: corsOrigins }; if (Array.isArray(corsOrigins) && corsOrigins.length && origin !== undefined)
        return { ...base, allowedOrigins: corsOrigins, requestOrigin: origin }; return undefined; }
    if (cors)
        router.use('*', async (c, next) => { const origin = c.req.header('Origin'); if (c.req.method === 'OPTIONS') {
            const headers = new Headers(), cfg = corsOptions(origin);
            if (cfg)
                setCORSHeaders(headers, cfg);
            return new Response(null, { status: HTTP_NO_CONTENT, headers });
        } await next(); const cfg = corsOptions(origin); if (origin && cfg)
            setCORSHeaders(c.res.headers, cfg); });
    router.get('/:table', async (c) => { const table = c.req.param('table'), isHead = c.req.method === 'HEAD', profile = profileFor(c); if (profile.error)
        return isHead ? c.body(null, 406) : c.json(profile.error, 406); const activeSchema = profile.schema, cache = cacheFor(activeSchema); if (!validateTable(table))
        return isHead ? c.body(null, 400) : c.json({ error: 'Invalid table name' }, 400); if (!(await cache.hasTable(table)))
        return isHead ? c.body(null, 404) : c.json({ error: `Table \"${table}\" not found` }, 404); const pref = preparePrefer(c); if ('response' in pref)
        return isHead ? c.body(null, pref.response.status) : pref.response; const prefer = pref.prefer; try {
        const url = new URL(c.req.url), badLimit = negativeLimitDetails(url.searchParams);
        if (badLimit)
            return rangeFailure(c, badLimit, undefined, isHead);
        const query = parser.parse(url.searchParams), reqRange = parseRangeRequest(c.req.header('Range'));
        if (reqRange.kind === 'invalid')
            return rangeFailure(c, reqRange.details, undefined, isHead);
        if (reqRange.kind === 'valid') {
            query.offset = reqRange.offset;
            if (reqRange.limit !== undefined)
                query.limit = reqRange.limit;
        }
        if (prefer.count && prefer.count !== 'none')
            query.count = prefer.count;
        const built = new QueryBuilder({ ...baseBuilderOptions, schema: activeSchema }).buildSelect(table, query, await cache.getTable(table), await cache.getAllForeignKeys());
        const { rows, totalCount } = await inTx(c, activeSchema, prefer, async (execute) => { const rows = (await execute(built.sql, built.params)).rows; let totalCount; if (built.countSql && prefer.count && prefer.count !== 'none') {
            const countRows = (await execute(built.countSql, built.params)).rows;
            totalCount = parseInt(countRows[0]?.count, DECIMAL_RADIX) || 0;
        } return { rows, totalCount }; });
        const offset = query.offset ?? 0;
        if (totalCount !== undefined && offset > 0 && rows.length === 0 && offset >= totalCount)
            return rangeFailure(c, offsideOffsetDetails(offset, totalCount), totalCount, isHead);
        const meta = { offset, rowCount: rows.length };
        if (totalCount !== undefined)
            meta.totalCount = totalCount;
        if (query.limit !== undefined)
            meta.limit = query.limit;
        setResponseHeaders(c.res.headers, meta, responsePreferences(prefer, 'read'));
        c.header('Content-Profile', activeSchema);
        const status = readStatus(offset, rows.length, totalCount);
        if (isHead)
            return c.body(null, status);
        return acceptsSingularObject(c.req.header('Accept')) ? singular(c, rows, status) : c.json(rows, status);
    }
    catch (error) {
        return isHead ? c.body(null, 500) : handleError(c, error);
    } });
    router.post('/:table', async (c) => { const table = c.req.param('table'), profile = profileFor(c); if (profile.error)
        return c.json(profile.error, 406); const activeSchema = profile.schema, cache = cacheFor(activeSchema); if (!validateTable(table))
        return c.json({ error: 'Invalid table name' }, 400); if (!(await cache.hasTable(table)))
        return c.json({ error: `Table \"${table}\" not found` }, 404); const pref = preparePrefer(c); if ('response' in pref)
        return pref.response; const prefer = pref.prefer, wantsSingular = acceptsSingularObject(c.req.header('Accept')); if (wantsSingular && !hasTransactionCapability(sql))
        return c.json(atomicCapabilityBody('singular'), 501); try {
        const tableSchema = await cache.getTable(table), requestedConflict = new URL(c.req.url).searchParams.get('on_conflict'), conflictColumns = requestedConflict ? requestedConflict.split(',').map(v => v.trim()).filter(Boolean) : (prefer.resolution === 'merge-duplicates' ? [...(tableSchema?.primaryKey ?? [])] : []), missingColumn = conflictColumns.find(column => !tableSchema?.columns.has(column));
        if (missingColumn)
            return c.json(missingColumnError(table, missingColumn), 400);
        const built = buildInsertStatement(table, await c.req.json(), { schema: activeSchema, returning: returning(prefer, wantsSingular), missing: prefer.missing, resolution: prefer.resolution, conflictColumns });
        const insertResult = await inTx(c, activeSchema, prefer, async (execute) => { const result = await execute(built.sql, built.params); if (wantsSingular && result.rows.length !== 1)
            throw new SingularMutationMismatch(result.rows.length); return result; });
        const rows = insertResult.rows;
        const appliedPrefer = responsePreferences(prefer, 'insert', { hasConflictTarget: conflictColumns.length > 0 });
        setResponseHeaders(c.res.headers, { rowCount: rows.length, headersOnly: prefer.return !== 'representation' }, appliedPrefer);
        c.header('Content-Profile', activeSchema);
        if (rows.length === 1 && tableSchema?.primaryKey.length) {
            const pk = {};
            for (const col of tableSchema.primaryKey)
                pk[col] = rows[0]?.[col];
            c.res.headers.set('Location', buildLocationHeader(basePath, table, pk));
        }
        const status = getResponseStatus('POST', rows.length, prefer, { insertedCount: insertResult.insertedCount });
        if (prefer.return !== 'representation')
            return c.body(null, status);
        return wantsSingular ? singular(c, rows, status) : c.json(rows, status);
    }
    catch (error) {
        return handleError(c, error);
    } });
    async function mutate(c, method) { const table = c.req.param('table'), profile = profileFor(c); if (profile.error)
        return c.json(profile.error, 406); const activeSchema = profile.schema, cache = cacheFor(activeSchema); if (!validateTable(table))
        return c.json({ error: 'Invalid table name' }, 400); if (!(await cache.hasTable(table)))
        return c.json({ error: `Table \"${table}\" not found` }, 404); const pref = preparePrefer(c); if ('response' in pref)
        return pref.response; const prefer = pref.prefer, wantsSingular = acceptsSingularObject(c.req.header('Accept')), enforceMax = prefer.handling === 'strict' && prefer.maxAffected !== undefined, needsAtomic = wantsSingular || enforceMax; if (needsAtomic && !hasTransactionCapability(sql))
        return c.json(atomicCapabilityBody(wantsSingular ? 'singular' : 'max-affected'), 501); try {
        const url = new URL(c.req.url), queryParams = new URLSearchParams(url.searchParams), columnsRaw = method === 'PATCH' ? queryParams.get('columns') : null;
        queryParams.delete('columns');
        const query = parser.parse(queryParams), builder = new QueryBuilder({ ...baseBuilderOptions, schema: activeSchema });
        let built;
        if (method === 'PATCH') {
            const body = (await c.req.json());
            const columns = columnsRaw?.split(',').map(v => v.trim()).filter(Boolean);
            const tableSchema = await cache.getTable(table);
            const invalid = columns?.find(column => !tableSchema?.columns.has(column));
            if (invalid)
                return c.json(missingColumnError(table, invalid), 400);
            built = buildUpdateStatement(table, body, query.filters, { schema: activeSchema, columns, missing: prefer.missing, returning: returning(prefer, needsAtomic) });
        }
        else
            built = builder.buildDelete(table, query.filters, returning(prefer, needsAtomic));
        if (!built) {
            const emptyRows = [];
            setResponseHeaders(c.res.headers, { rowCount: 0, headersOnly: prefer.return !== 'representation' }, responsePreferences(prefer, method === 'PATCH' ? 'update' : 'delete'));
            c.header('Content-Profile', activeSchema);
            const status = getResponseStatus(method, 0, prefer);
            if (wantsSingular)
                return singular(c, emptyRows, status);
            return prefer.return === 'representation' ? c.json([], status) : c.body(null, status);
        }
        const rows = await inTx(c, activeSchema, prefer, async (execute) => { const rows = (await execute(built.sql, built.params)).rows; if (wantsSingular && rows.length !== 1)
            throw new SingularMutationMismatch(rows.length); if (enforceMax && rows.length > prefer.maxAffected)
            throw new MaxAffectedMismatch(rows.length); return rows; });
        setResponseHeaders(c.res.headers, { rowCount: rows.length, headersOnly: prefer.return !== 'representation' }, responsePreferences(prefer, method === 'PATCH' ? 'update' : 'delete'));
        c.header('Content-Profile', activeSchema);
        const status = getResponseStatus(method, rows.length, prefer);
        if (prefer.return !== 'representation')
            return c.body(null, status);
        return wantsSingular ? singular(c, rows, status) : c.json(rows, status);
    }
    catch (error) {
        return handleError(c, error);
    } }
    router.patch('/:table', c => mutate(c, 'PATCH'));
    router.delete('/:table', c => mutate(c, 'DELETE'));
    router.post('/rpc/:function', async (c) => { const fn = c.req.param('function'), profile = profileFor(c); if (profile.error)
        return c.json(profile.error, 406); const activeSchema = profile.schema; if (!validateFunction(fn))
        return c.json({ error: 'Invalid function name' }, 400); const pref = preparePrefer(c); if ('response' in pref)
        return pref.response; const prefer = pref.prefer; try {
        const enforceMax = prefer.handling === 'strict' && prefer.maxAffected !== undefined, routines = await routineCache.get(activeSchema, fn);
        if (enforceMax && routines.length > 0 && routines.every(r => r.returnsVoid))
            return c.json(maxAffectedRpcUnsupported(), 400);
        if (enforceMax && !hasTransactionCapability(sql))
            return c.json(atomicCapabilityBody('max-affected'), 501);
        const url = new URL(c.req.url), badLimit = negativeLimitDetails(url.searchParams);
        if (badLimit)
            return rangeFailure(c, badLimit);
        const query = parser.parse(url.searchParams), reqRange = parseRangeRequest(c.req.header('Range'));
        if (reqRange.kind === 'invalid')
            return rangeFailure(c, reqRange.details);
        if (reqRange.kind === 'valid') {
            query.offset = reqRange.offset;
            if (reqRange.limit !== undefined)
                query.limit = reqRange.limit;
        }
        if (prefer.count && prefer.count !== 'none')
            query.count = prefer.count;
        const args = (await c.req.json().catch(() => ({}))), built = buildRpcEnvelopeQuery(fn, args, query, { schema: activeSchema, maxLimit, defaultLimit }), envelope = await inTx(c, activeSchema, prefer, async (execute) => { const envelope = decodeRpcEnvelope((await execute(built.sql, built.params)).rows[0]); if (enforceMax && envelope.affected > prefer.maxAffected)
            throw new MaxAffectedMismatch(envelope.affected); return envelope; });
        const totalCount = prefer.count && prefer.count !== 'none' ? envelope.count : undefined, offset = query.offset ?? 0;
        if (totalCount !== undefined && offset > 0 && envelope.rows.length === 0 && offset >= totalCount)
            return rangeFailure(c, offsideOffsetDetails(offset, totalCount), totalCount);
        const meta = { offset, rowCount: envelope.rows.length };
        if (totalCount !== undefined)
            meta.totalCount = totalCount;
        if (query.limit !== undefined)
            meta.limit = query.limit;
        setResponseHeaders(c.res.headers, meta, responsePreferences(prefer, 'rpc'));
        c.header('Content-Profile', activeSchema);
        const status = readStatus(offset, envelope.rows.length, totalCount);
        if (acceptsSingularObject(c.req.header('Accept')))
            return singular(c, envelope.rows, status);
        const setLike = routines.some(r => r.returnsSet || /^\s*(SETOF|TABLE)/i.test(r.resultType));
        return c.json(setLike ? envelope.rows : formatRpcResult(envelope.rows), status);
    }
    catch (error) {
        return handleError(c, error);
    } });
    router.get('/rpc/:function', async (c) => { const fn = c.req.param('function'), profile = profileFor(c); if (profile.error)
        return c.json(profile.error, 406); const activeSchema = profile.schema; if (!validateFunction(fn))
        return c.json({ error: 'Invalid function name' }, 400); const pref = preparePrefer(c); if ('response' in pref)
        return pref.response; const prefer = pref.prefer; try {
        const url = new URL(c.req.url), routines = await routineCache.get(activeSchema, fn), preliminary = partitionGetRpcParams(url.searchParams), match = matchRoutineByNamedArgs(routines, preliminary.candidateArgNames);
        if (match.ambiguous)
            return c.json(ambiguousRpc(match.candidates.map(routineSignature)), 300);
        if (!match.routine)
            return c.json(noRpc(activeSchema, fn, preliminary.candidateArgNames), 404);
        const partition = partitionGetRpcParams(url.searchParams, match.routine), badLimit = negativeLimitDetails(partition.resultParams);
        if (badLimit)
            return rangeFailure(c, badLimit);
        const query = parser.parse(partition.resultParams), reqRange = parseRangeRequest(c.req.header('Range'));
        if (reqRange.kind === 'invalid')
            return rangeFailure(c, reqRange.details);
        if (reqRange.kind === 'valid') {
            query.offset = reqRange.offset;
            if (reqRange.limit !== undefined)
                query.limit = reqRange.limit;
        }
        if (prefer.count && prefer.count !== 'none')
            query.count = prefer.count;
        const enforceMax = prefer.handling === 'strict' && prefer.maxAffected !== undefined;
        if (enforceMax && match.routine.returnsVoid)
            return c.json(maxAffectedRpcUnsupported(), 400);
        if (enforceMax && !hasTransactionCapability(sql))
            return c.json(atomicCapabilityBody('max-affected'), 501);
        const built = buildRpcEnvelopeQuery(fn, partition.args, query, { schema: activeSchema, maxLimit, defaultLimit }), envelope = await inTx(c, activeSchema, prefer, async (execute) => { const envelope = decodeRpcEnvelope((await execute(built.sql, built.params)).rows[0]); if (enforceMax && envelope.affected > prefer.maxAffected)
            throw new MaxAffectedMismatch(envelope.affected); return envelope; });
        const totalCount = prefer.count && prefer.count !== 'none' ? envelope.count : undefined, offset = query.offset ?? 0;
        if (totalCount !== undefined && offset > 0 && envelope.rows.length === 0 && offset >= totalCount)
            return rangeFailure(c, offsideOffsetDetails(offset, totalCount), totalCount);
        const meta = { offset, rowCount: envelope.rows.length };
        if (totalCount !== undefined)
            meta.totalCount = totalCount;
        if (query.limit !== undefined)
            meta.limit = query.limit;
        setResponseHeaders(c.res.headers, meta, responsePreferences(prefer, 'rpc'));
        c.header('Content-Profile', activeSchema);
        const status = readStatus(offset, envelope.rows.length, totalCount);
        if (acceptsSingularObject(c.req.header('Accept')))
            return singular(c, envelope.rows, status);
        const setLike = match.routine.returnsSet || /^\s*(SETOF|TABLE)/i.test(match.routine.resultType);
        return c.json(setLike ? envelope.rows : formatRpcResult(envelope.rows), status);
    }
    catch (error) {
        return handleError(c, error);
    } });
    return router;
}
//# sourceMappingURL=router.js.map