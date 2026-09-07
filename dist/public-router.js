import { Hono } from 'hono';
import { createPostgRESTRouter as createCompatibilityRouter } from './compat-router.js';
import { acceptsSingularObject, SINGULAR_MEDIA_TYPE } from './media.js';
import { emitObserver, observedExecutor, requestHeadersForObserver } from './telemetry.js';
function responseErrorBody(response) {
    if (response.status < 400 || response.status === 404 && response.headers.get('content-type') == null)
        return Promise.resolve(undefined);
    return response.clone().json().then(body => {
        if (!body || typeof body !== 'object' || typeof body.message !== 'string')
            return undefined;
        return body;
    }).catch(() => undefined);
}
/**
 * Public package boundary.
 *
 * The compatibility router owns behavioral routing (flat vs embedded planner).
 * This boundary normalizes negotiated response media types and owns the optional
 * observer lifecycle so both router paths share one request/SQL/response stream.
 */
export function createPostgRESTRouter(sql, options = {}) {
    const { observer, observerOptions = {}, ...compatibilityOptions } = options;
    const observedSql = observedExecutor(sql, observer, observerOptions);
    const compatibility = createCompatibilityRouter(observedSql, compatibilityOptions);
    const app = new Hono();
    app.all('*', async (c) => {
        const started = Date.now();
        const method = c.req.method;
        const url = c.req.url;
        const headers = requestHeadersForObserver(c.req.raw.headers, observerOptions);
        emitObserver(observer, {
            type: 'request.received', at: started, method, url,
            ...(headers && { headers }),
        });
        try {
            const parsed = new URL(url);
            emitObserver(observer, {
                type: 'request.parsed', at: Date.now(), method, url,
                query: { path: parsed.pathname, params: [...parsed.searchParams.entries()] },
            });
            const response = await compatibility.fetch(c.req.raw);
            if (acceptsSingularObject(c.req.header('Accept')) &&
                response.status >= 200 && response.status < 300 &&
                response.status !== 204) {
                response.headers.set('Content-Type', SINGULAR_MEDIA_TYPE);
            }
            const normalized = await responseErrorBody(response);
            if (normalized) {
                emitObserver(observer, {
                    type: 'error', at: Date.now(), stage: 'response', message: normalized.message,
                    ...(normalized.code && { code: normalized.code }), normalized,
                    durationMs: Date.now() - started,
                });
            }
            emitObserver(observer, { type: 'response.created', at: Date.now(), method, url, status: response.status, durationMs: Date.now() - started });
            return response;
        }
        catch (error) {
            const err = error;
            emitObserver(observer, {
                type: 'error', at: Date.now(), stage: 'request', message: err?.message ?? String(error),
                ...(err?.code && { code: err.code, sqlState: err.code }), durationMs: Date.now() - started,
            });
            throw error;
        }
    });
    return app;
}
//# sourceMappingURL=public-router.js.map