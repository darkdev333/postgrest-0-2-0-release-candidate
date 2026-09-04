import { Hono } from 'hono'
import { createPostgRESTRouter as createCompatibilityRouter, type PostgRESTRouterOptions } from './compat-router.js'
import type { SQLExecutor, SQLStatementExecutor, SQLTransactionContext } from './executor.js'
import { acceptsSingularObject, SINGULAR_MEDIA_TYPE } from './media.js'

/**
 * Public package boundary.
 *
 * The compatibility router owns behavioral routing (flat vs embedded planner).
 * This boundary normalizes negotiated response media types so successful
 * application/vnd.pgrst.object(+json) requests match upstream PostgREST even
 * while the older flat-router implementation is being retired internally.
 */
export function createPostgRESTRouter(sql: SQLExecutor, options: PostgRESTRouterOptions = {}): Hono {
  const compatibility = createCompatibilityRouter(sql, options)
  const app = new Hono()

  app.all('*', async c => {
    const response = await compatibility.fetch(c.req.raw)
    if (
      acceptsSingularObject(c.req.header('Accept')) &&
      response.status >= 200 && response.status < 300 &&
      response.status !== 204
    ) {
      response.headers.set('Content-Type', SINGULAR_MEDIA_TYPE)
    }
    return response
  })

  return app
}

export type { PostgRESTRouterOptions, SQLExecutor, SQLStatementExecutor, SQLTransactionContext }
