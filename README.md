# PostgREST TypeScript Compatibility Adapter

A browser- and Worker-friendly TypeScript implementation of the PostgREST HTTP contract, designed to sit in front of a PostgreSQL-compatible executor such as PGlite.

This project exists to make applications written for PostgREST and Supabase-style REST APIs portable into environments where running the Haskell PostgREST server itself is not practical — including fully local, in-browser application backends.

> **Status:** active compatibility work. This project implements a substantial and growing portion of PostgREST behavior, but it does **not** yet claim complete PostgREST parity. See [`PARITY.md`](./PARITY.md) for the current compatibility ledger.

## Why this exists

The immediate use case is [DiagramCraft](https://diagramcraft.com), where Application Preview is being developed to run generated applications against a local browser backend built around technologies such as Service Workers, SharedWorkers, IndexedDB/OPFS, and PGlite.

The intended request path is conceptually:

```text
@supabase/supabase-js
  -> @supabase/postgrest-js
  -> fetch / HTTP
  -> this Hono-based PostgREST compatibility adapter
  -> SQLExecutor
  -> PGlite or another PostgreSQL-compatible executor
```

The adapter is intentionally not coupled directly to PGlite. Its database boundary is a small `SQLExecutor` interface so it can also be used with other PostgreSQL-compatible runtimes.

## Project history and provenance

This repository began from the published MIT-licensed `@dotdo/postgrest@0.1.1` package, an unfinished TypeScript/Cloudflare-oriented PostgREST implementation associated with the postgres.do / dot.do ecosystem.

That package provided useful substrate — particularly its Hono/Web API shell, basic parser/query code, schema utilities, and SQL execution abstraction — but it was not sufficiently compatible with real PostgREST behavior for the browser-local backend work we needed.

Rather than discard the useful browser-safe foundation, this project was salvaged and substantially refactored in place.

Beginning with the `0.2.x` line, compatibility decisions are made against the **upstream Haskell PostgREST project**, not against historical behavior of the original TypeScript package. The authority order used by this project is:

1. upstream [PostgREST/PostgREST](https://github.com/PostgREST/postgrest) source and test/spec suites;
2. real PostgREST / Supabase wire behavior where useful for confirmation;
3. compatibility tests maintained in this repository;
4. original `@dotdo/postgrest` behavior only as historical regression coverage when it agrees with upstream.

This is an independent compatibility project. It is not an official PostgREST, Supabase, or dot.do project, and those projects do not endorse this repository merely by being compatibility targets or historical sources.

## Development and contributors

Current development is being performed in support of DiagramCraft Application Preview, with engineering contributions from [SCI-ENCE](https://sci-ence.com).

[DiagramCraft](https://diagramcraft.com) is the primary real-world integration target and the environment that motivated the browser-local PostgREST/PGlite architecture. The project is being released publicly so it can also be used, tested, and improved by anyone who needs a lightweight TypeScript PostgREST-compatible HTTP layer.

Contributions, compatibility reports, upstream-derived tests, and fixes are welcome.

## Design goals

- **PostgREST wire compatibility.** Existing clients such as `@supabase/postgrest-js` should not require adapter-specific branches for supported features.
- **Upstream-derived behavior.** When historical TypeScript behavior conflicts with Haskell PostgREST, Haskell PostgREST wins.
- **Browser and Worker compatibility.** Runtime code uses Web-standard `Request`, `Response`, `Headers`, and URL APIs and avoids Node server/filesystem/process assumptions.
- **Database independence at the adapter boundary.** The HTTP/PostgREST layer talks to a `SQLExecutor`, not directly to PGlite.
- **Safe parameterized SQL.** User values are passed as query parameters rather than interpolated into generated SQL.
- **Incremental compatibility.** Complex PostgREST behavior is implemented in coherent, upstream-tested slices rather than approximated silently.

## Current capabilities

The implementation already includes substantial compatibility work across:

- table GET/HEAD/POST/PATCH/DELETE;
- range and count semantics, including PostgREST-style `Content-Range` behavior;
- singular object media negotiation;
- schema profiles via `Accept-Profile` and `Content-Profile`;
- `Prefer` parsing and response application for supported preferences;
- transactional request execution and request-local session context through an optional executor capability;
- insert/upsert behavior and conflict targets;
- RPC GET/POST handling and overload resolution for common named-argument cases;
- PostgREST-shaped errors for many compatibility paths;
- schema and relationship caching;
- composite foreign keys and relationship ambiguity preservation;
- many-to-one, one-to-many, one-to-one, and common many-to-many relationship planning;
- nested resource embedding using lateral SQL;
- `!inner` embeds;
- embedded filters, ordering, limits, and offsets;
- related parent ordering through to-one relationships;
- embed `is.null` / `not.is.null` existence semantics;
- nested and negated logical query trees;
- JSON-path filtering and ordering;
- spread relations, including schema-backed spread-star expansion.

This list is intentionally not a claim of complete parity. See [`PARITY.md`](./PARITY.md) for implemented behavior, known deviations, upstream adjudications, and the next compatibility targets.

## Architecture

The public runtime keeps the original browser-safe routing concept while replacing compatibility-critical internals where necessary.

```text
src/index.ts
  -> public-router.ts
  -> compat-router.ts
      -> replacement relationship/read planner for advanced reads
      -> mature flat router for established CRUD/RPC paths
  -> SQLExecutor
```

The replacement embedded-read path is built around:

```text
relationship graph
  -> nested select AST
  -> relationship resolution
  -> read plan
  -> lateral SQL
```

The staged router boundary is intentional: advanced planner work can evolve without destabilizing mature flat CRUD and RPC behavior.

## SQLExecutor

The core database contract is deliberately small:

```ts
export type SQLStatementExecutor = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Record<string, unknown>[] }>

export type SQLExecutor = SQLStatementExecutor & {
  transaction?<T>(
    callback: (execute: SQLStatementExecutor) => Promise<T>,
    context?: {
      schema?: string
      role?: string
      settings?: Record<string, string>
      transactionEnd?: 'commit' | 'rollback'
    },
  ): Promise<T>
}
```

The executor adapter owns database-specific transaction handling and session setup. For a Supabase-like local backend, that can include request-local PostgreSQL role/settings such as verified JWT claims used by RLS policies.

See [`INTEGRATION.md`](./INTEGRATION.md) for the integration contract and browser-runtime notes.

## Basic usage

```ts
import { createPostgRESTRouter } from './src/index.js'

const sql = Object.assign(
  async (statement: string, params?: unknown[]) => {
    const result = await pglite.query(statement, params)
    return { rows: result.rows as Record<string, unknown>[] }
  },
  {
    async transaction<T>(callback: (execute: typeof sql) => Promise<T>) {
      return pglite.transaction(async tx => {
        return callback(async (statement, params) => {
          const result = await tx.query(statement, params)
          return { rows: result.rows as Record<string, unknown>[] }
        })
      })
    },
  },
)

const api = createPostgRESTRouter(sql, {
  schemas: ['public'],
})
```

The returned Hono application speaks in Web-standard `Request`/`Response` objects, making it suitable for Workers, Service Workers, browser relays, and conventional Hono hosting environments.

## Development

```bash
npm test
npm run typecheck
npm run build
```

The repository includes compatibility-focused Vitest coverage derived from upstream PostgREST behavior. When adding or changing behavior, contributors should locate the corresponding Haskell implementation/spec first and use it as the behavioral authority.

For the current detailed implementation checkpoint, read:

- [`PARITY.md`](./PARITY.md) — compatibility ledger and known gaps;
- [`INTEGRATION.md`](./INTEGRATION.md) — runtime/executor integration contract;
- [`CHANGELOG-DIAGRAMCRAFT.md`](./CHANGELOG-DIAGRAMCRAFT.md) — development history of the compatibility fork.

## Compatibility is not identity

PostgREST is a mature Haskell server with a much larger feature surface than this TypeScript adapter currently implements. The goal here is protocol and behavioral compatibility for supported functionality, not a line-for-line port of its implementation.

Unsupported behavior should be tracked and implemented deliberately. This project should not silently invent alternate semantics merely to satisfy an old test or make a particular request appear to work.

## Versioning

The project is moving to the `0.2.x` line to distinguish the actively maintained compatibility fork from the historical `@dotdo/postgrest@0.1.1` substrate.

Until `1.0.0`, minor releases may add substantial compatibility surface and may include API changes as the adapter converges on upstream PostgREST behavior and the public integration contract stabilizes.

## License and provenance

This repository is released under the [MIT License](./LICENSE).

Portions of the codebase derive from the MIT-licensed `@dotdo/postgrest@0.1.1` package. The historical npm distribution identified `dot.do` as its author and MIT as its license, but did not include a standalone license file or a more specific copyright notice in the package distribution used for this fork. We preserve that provenance in [`NOTICE.md`](./NOTICE.md) without inventing an attribution that was not present in the source distribution.

New work in the `0.2.x` line is contributed under this repository's MIT license.

## Related projects

- [PostgREST](https://postgrest.org/) — behavioral compatibility target and upstream authority.
- [PostgREST source](https://github.com/PostgREST/postgrest) — source/spec/test authority used during compatibility work.
- [Supabase](https://supabase.com/) — ecosystem whose JavaScript clients are an important interoperability target.
- [PGlite](https://pglite.dev/) — PostgreSQL-compatible browser runtime targeted by the DiagramCraft local backend.
- [DiagramCraft](https://diagramcraft.com/) — primary application and integration use case.
- [SCI-ENCE](https://sci-ence.com/) — contributing company.


## Repository

The public development repository is [darkdev333/postgrest-0.2.0](https://github.com/darkdev333/postgrest-0.2.0). The package is not currently published to npm under a new name; `package.json` is marked `private` to prevent accidental publication while the public package identity is decided.
