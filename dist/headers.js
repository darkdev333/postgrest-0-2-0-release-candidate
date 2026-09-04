/** PostgREST response/preference header helpers. */
const DEFAULT_CORS_METHODS = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_CORS_ALLOW_HEADERS = ['Authorization', 'Content-Type', 'Prefer', 'Range', 'Accept-Profile', 'Content-Profile'];
const DEFAULT_CORS_EXPOSE_HEADERS = ['Content-Range', 'Content-Profile', 'Location', 'Preference-Applied'];
const RANGE_HEADER_PATTERN = /^(?:items=)?(\d+)-(\d+)$/;
export function parsePreferHeader(header) { const result = {}; const invalid = []; if (!header)
    return result; for (const pref of header.split(',').map(v => v.trim()).filter(Boolean)) {
    const i = pref.indexOf('=');
    if (i < 0) {
        invalid.push(pref);
        continue;
    }
    const key = pref.substring(0, i).trim(), value = pref.substring(i + 1).trim();
    let valid = true;
    switch (key) {
        case 'return':
            if (value === 'representation' || value === 'minimal' || value === 'headers-only')
                result.return = value;
            else
                valid = false;
            break;
        case 'count':
            if (value === 'exact' || value === 'planned' || value === 'estimated' || value === 'none')
                result.count = value;
            else
                valid = false;
            break;
        case 'resolution':
            if (value === 'merge-duplicates' || value === 'ignore-duplicates')
                result.resolution = value;
            else
                valid = false;
            break;
        case 'missing':
            if (value === 'default' || value === 'null')
                result.missing = value;
            else
                valid = false;
            break;
        case 'tx':
            if (value === 'commit' || value === 'rollback')
                result.tx = value;
            else
                valid = false;
            break;
        case 'handling':
            if (value === 'strict' || value === 'lenient')
                result.handling = value;
            else
                valid = false;
            break;
        case 'max-affected': {
            const n = Number(value);
            if (Number.isInteger(n) && n >= 0)
                result.maxAffected = n;
            else
                valid = false;
            break;
        }
        default: valid = false;
    }
    if (!valid)
        invalid.push(pref);
} if (invalid.length)
    result.invalid = invalid; return result; }
export function appliedPreferences(prefer, operation, options = {}) { const applied = {}; if (operation === 'insert' && options.hasConflictTarget && prefer.resolution)
    applied.resolution = prefer.resolution; if (operation === 'insert' || operation === 'update' || operation === 'delete')
    if (prefer.return)
        applied.return = prefer.return; if ((operation === 'insert' || operation === 'update') && prefer.missing)
    applied.missing = prefer.missing; if ((operation === 'update' || operation === 'delete' || operation === 'rpc') && prefer.maxAffected !== undefined && prefer.handling === 'strict')
    applied.maxAffected = prefer.maxAffected; if (prefer.count)
    applied.count = prefer.count; if (prefer.tx)
    applied.tx = prefer.tx; if (prefer.handling)
    applied.handling = prefer.handling; return applied; }
/** Alias used by the router; mirrors upstream Response.responsePreferences terminology. */
export const responsePreferences = appliedPreferences;
export function buildContentRange({ offset = 0, rowCount = 0, totalCount }) { const total = totalCount !== undefined ? String(totalCount) : '*'; return rowCount === 0 ? `*/${total}` : `${offset}-${offset + rowCount - 1}/${total}`; }
export function setResponseHeaders(headers, options, prefer) { if (!options.headersOnly)
    headers.set('Content-Type', options.contentType || 'application/json');
else
    headers.delete('Content-Type'); headers.set('Content-Range', buildContentRange(options)); headers.set('Range-Unit', 'items'); if (!prefer)
    return; const applied = []; if (prefer.resolution)
    applied.push(`resolution=${prefer.resolution}`); if (prefer.missing)
    applied.push(`missing=${prefer.missing}`); if (prefer.tx)
    applied.push(`tx=${prefer.tx}`); if (prefer.handling)
    applied.push(`handling=${prefer.handling}`); if (prefer.maxAffected !== undefined && prefer.handling === 'strict')
    applied.push(`max-affected=${prefer.maxAffected}`); if (prefer.return)
    applied.push(`return=${prefer.return}`); if (prefer.count)
    applied.push(`count=${prefer.count}`); if (applied.length)
    headers.set('Preference-Applied', applied.join(', ')); }
export function parseRangeHeader(header) { if (!header)
    return null; const m = header.match(RANGE_HEADER_PATTERN); if (!m?.[1] || !m[2])
    return null; const start = parseInt(m[1], 10), end = parseInt(m[2], 10); return end < start ? null : { offset: start, limit: end - start + 1 }; }
export function buildLocationHeader(basePath, table, pk) { return `${basePath}/${table}?${Object.entries(pk).map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`).join('&')}`; }
export function buildHeadersOnlyResponse(headers, options) { setResponseHeaders(headers, options); if (options.location)
    headers.set('Location', options.location); headers.set('Content-Length', '0'); }
export function getResponseStatus(method, _rowCount, prefer, execution = {}) { if (method === 'POST') {
    if (prefer?.resolution === 'merge-duplicates' && execution.insertedCount !== undefined && execution.insertedCount <= 0)
        return 200;
    return 201;
} if (method === 'PATCH' || method === 'PUT' || method === 'DELETE')
    return prefer?.return === 'representation' ? 200 : 204; return 200; }
export function setCORSHeaders(headers, options) { if (!options)
    return; const { origin, allowedOrigins, originPattern, requestOrigin, credentials, methods, allowHeaders, exposeHeaders, maxAge } = options; let allowedOrigin = null; if (origin !== undefined)
    allowedOrigin = origin;
else if (originPattern && requestOrigin) {
    if (originPattern.test(requestOrigin))
        allowedOrigin = requestOrigin;
    headers.set('Vary', 'Origin');
}
else if (allowedOrigins?.length && requestOrigin) {
    if (allowedOrigins.includes(requestOrigin))
        allowedOrigin = requestOrigin;
    headers.set('Vary', 'Origin');
} if (allowedOrigin !== null)
    headers.set('Access-Control-Allow-Origin', allowedOrigin); headers.set('Access-Control-Allow-Methods', (methods || DEFAULT_CORS_METHODS).join(', ')); headers.set('Access-Control-Allow-Headers', (allowHeaders ? [...DEFAULT_CORS_ALLOW_HEADERS, ...allowHeaders] : DEFAULT_CORS_ALLOW_HEADERS).join(', ')); headers.set('Access-Control-Expose-Headers', (exposeHeaders ? [...DEFAULT_CORS_EXPOSE_HEADERS, ...exposeHeaders] : DEFAULT_CORS_EXPOSE_HEADERS).join(', ')); if (maxAge !== undefined)
    headers.set('Access-Control-Max-Age', String(maxAge)); if (credentials && allowedOrigin !== null && allowedOrigin !== '*')
    headers.set('Access-Control-Allow-Credentials', 'true'); }
//# sourceMappingURL=headers.js.map