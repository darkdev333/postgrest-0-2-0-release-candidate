# DiagramCraft integration contract

This package is intentionally independent of DiagramCraft production application source. It should be mountable in browser/Worker runtimes behind the DiagramCraft preview gateway.

## Core adapter

```ts
import { createPostgRESTRouter } from 'postgrest-compat'

const sql = Object.assign(
  async (statement: string, params?: unknown[]) => {
    const result = await pglite.query(statement, params)
    return { rows: result.rows as Record<string, unknown>[] }
  },
  {
    async transaction<T>(callback, context) {
      return pglite.transaction(async tx => {
        // Adapter-specific responsibility: apply context as request-local
        // PostgreSQL role/settings before invoking callback.
        // e.g. SET LOCAL ROLE + set_config(..., true)
        return callback(async (statement, params) => {
          const result = await tx.query(statement, params)
          return { rows: result.rows as Record<string, unknown>[] }
        })
      })
    },
  },
)

const api = createPostgRESTRouter(sql, {
  schemas: ['public', 'api'],
  transactionContext(request, schema) {
    return {
      schema,
      // The gateway/auth layer may derive these from a verified session.
      role: 'authenticated',
      settings: {
        'request.jwt.claims': JSON.stringify({ sub: 'verified-user-id' }),
      },
    }
  },
})
```

## SQLExecutor contract

The executor remains directly callable, preserving compatibility with the original package:

```ts
type SQLStatementExecutor = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Record<string, unknown>[] }>

type SQLTransactionContext = {
  schema?: string
  role?: string
  settings?: Record<string, string>
}

type SQLExecutor = SQLStatementExecutor & {
  transaction?<T>(
    callback: (execute: SQLStatementExecutor) => Promise<T>,
    context?: SQLTransactionContext,
  ): Promise<T>
}
```

When `.transaction` is absent, the router behaves exactly like the original callable executor. When present, one HTTP data operation is executed through that transaction callback; GET row+count queries share the transaction snapshot, and writes/RPC execute in the same request-local session.

The executor adapter—not the PostgREST router—owns `BEGIN/COMMIT/ROLLBACK`, `SET LOCAL ROLE`, `set_config`, and any PGlite-specific transaction APIs. Throwing from the transaction callback must roll the transaction back.

## Request-local context

`transactionContext(request, schema)` is intentionally generic. It lets the DiagramCraft gateway/runtime relay pass **verified** authentication/session information into the database adapter without teaching this package about Supabase Auth, DiagramCraft secrets, JWT verification, or Service Worker protocols.

Useful PostgreSQL settings for a Supabase/PostgREST-compatible PGlite adapter can include `request.jwt.claims`, `request.headers`, `request.cookies`, and request-specific application settings. Do not decode an unverified bearer token inside this router and treat its claims as trusted database identity; verification belongs in the auth/gateway layer.

## Schema profiles

Real `@supabase/postgrest-js` sends `Accept-Profile` for GET/HEAD and `Content-Profile` for writes when `.schema(name)` is used. Configure exposed schemas through `schemas`; the router defaults to the first entry, maintains an independent `SchemaCache` per selected schema, and returns `PGRST106`/406 for profiles outside the configured list.

Generated SQL is schema-qualified. A transaction adapter may additionally set request-local `search_path` when function/session semantics require it.

## Worker/browser constraints

- Use Web-standard `Request`, `Response`, `Headers`, and URL APIs.
- Do not use `process`, filesystem APIs, Node HTTP servers, or Node-only environment access in the runtime path.
- Hono is the HTTP router, not a Node server dependency.
- The gateway/runtime relay can forward a request to the Hono app and return its Web `Response` directly.

## Compatibility note

`@supabase/postgrest-js` relies on wire details, not only SQL correctness. Preserve PostgREST media types, HTTP status codes, `Content-Range`, `Range-Unit`, `Preference-Applied`, schema-profile headers, and error object fields closely enough that the real client does not need adapter-specific branches.

The replacement read planner now handles recursive/negated PostgREST boolean groups, JSON-path filter/order SQL, relationship embeds, related ordering, embed-existence predicates, explicit-field spread shaping, and spread-star shaping. This improves compatibility for generated Supabase clients without changing the integration boundary: callers still use ordinary HTTP/PostgREST query parameters, and the PGlite adapter still only sees parameterized SQL through `SQLExecutor`.

### Spread-star integration

`...relation(*)` is expanded **before SQL compilation** using the existing per-schema `SchemaCache`. `information_schema.columns` is already fetched in ordinal-position order and stored in an insertion-ordered `Map`, so spread-star receives a deterministic ordered field list without adding any PGlite-specific dependency to the compiler.

Only spread contexts expand `*`. Ordinary non-spread `relation(*)` remains `table.*` and keeps object/array row shaping. Nested spread relations expand independently. The pure SQL compiler retains a guard against an unexpanded spread `*`; that is an invariant check, not a public HTTP limitation when requests flow through `compat-router.ts`.
