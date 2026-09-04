import { Hono } from 'hono';
import { createPostgRESTRouter as createCompatibilityRouter } from './compat-router.js';
import { acceptsSingularObject, SINGULAR_MEDIA_TYPE } from './media.js';
/**
 * Public package boundary.
 *
 * The compatibility router owns behavioral routing (flat vs embedded planner).
 * This boundary normalizes negotiated response media types so successful
 * application/vnd.pgrst.object(+json) requests match upstream PostgREST even
 * while the older flat-router implementation is being retired internally.
 */
export function createPostgRESTRouter(sql, options = {}) {
    const compatibility = createCompatibilityRouter(sql, options);
    const app = new Hono();
    app.all('*', async (c) => {
        const response = await compatibility.fetch(c.req.raw);
        if (acceptsSingularObject(c.req.header('Accept')) &&
            response.status >= 200 && response.status < 300 &&
            response.status !== 204) {
            response.headers.set('Content-Type', SINGULAR_MEDIA_TYPE);
        }
        return response;
    });
    return app;
}
//# sourceMappingURL=public-router.js.map