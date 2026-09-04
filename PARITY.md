# PostgREST compatibility parity

Resumable ledger for the browser/Worker-compatible `postgrest-compat` project used by DiagramCraft Application Preview.

## Authority and target

Behavioral authority is upstream Haskell PostgREST source/specs/tests. Real Supabase/PostgREST behavior is useful confirmation. The abandoned dotdo implementation/tests are only substrate/regression artifacts.

Runtime target:

`@supabase/supabase-js -> @supabase/postgrest-js -> HTTP/fetch -> Hono adapter -> SQLExecutor -> PGlite`

DiagramCraft is the authoritative working tree. The uploaded execution ZIP is only a Linux dependency/test bootstrap and contains an older source snapshot.

## Current checkpoint — 2026-09-04

### Mature flat/runtime compatibility already implemented

- Browser-safe Web `Request`/`Response`/Hono runtime; no Node server/filesystem/process dependency in the runtime path.
- PostgreSQL/PostgREST-shaped errors and major PGRST compatibility work.
- Canonical range/count/HEAD behavior including `PGRST103`, 416, open-ended Range, 206, `Content-Range`, and `Range-Unit`.
- Singular media behavior and `PGRST116` reads/mutations.
- Schema profiles, per-schema caches, schema-qualified SQL, and `PGRST106`.
- INSERT missing/default semantics, upsert/on_conflict, PATCH `columns=`, `missing=default`, and empty-body no-op behavior.
- Optional transactional/session SQLExecutor boundary with request-local schema/role/settings/transaction disposition.
- Atomic singular mutations and strict `max-affected` rollback, including RPC `PGRST124` and known-void `PGRST128`.
- Strict preference validation (`PGRST122`) and opt-in `tx=commit|rollback` behavior.
- RPC metadata/cache, named-argument matching, GET/POST result shaping, `PGRST202` no-match and `PGRST203` ambiguity behavior.
- Method-aware `Preference-Applied` projection.

### Replacement relationship/read planner implemented

Architecture remains an intentional salvage/refactor:

`src/index.ts -> public-router.ts -> compat-router.ts -> router.ts`

Implemented read-planner foundation:

- Explicit relationship graph preserving ambiguity instead of selecting the first FK.
- Catalog-backed relationship cache with ordered composite FK mappings.
- M2O, O2M, O2O and common M2M/junction modeling.
- Nested PostgREST select AST, aliases, relationship hints and `!inner`.
- Recursive relationship resolution with canonical `PGRST200` and `PGRST201` states.
- Lateral SQL with object-vs-array shaping by relationship cardinality.
- Many-to-many junction SQL path.
- Embedded filter/order/limit/offset routing with selected-alias path validation and `PGRST108`.
- Related parent ordering through to-one relationships, including aliases, nesting, null ordering and JSON paths; to-many related ordering returns `PGRST118`.
- `embed=is.null` / `embed=not.is.null` existence semantics across to-one, to-many, M2M, aliases and nested embeds.
- Exact-count preservation of embed-existence predicates.
- Sibling cross-embed logical existence composition.

### Recursive / negated logical grammar

Upstream `ApiRequest/QueryParams.hs` and `AndOrParamsSpec.hs` were used as the oracle.

Implemented:

- Recursive `and(...)` and `or(...)` groups.
- Nested `not.and(...)` / `not.or(...)` groups.
- Negated logical operators in query keys such as `not.and=(...)`.
- Embedded/aliased path negated logic such as `info.not.or=(...)`.
- Ordinary field predicates and embed-existence predicates in the same logical tree.
- Comma splitting that preserves commas inside quoted values and PostgreSQL array literals.

Still open: strict malformed-logic parse failures and exact canonical `PGRST100` diagnostics. The compatibility parser currently drops an unparseable child rather than reproducing upstream parse positions/messages.

### JSON-path filter/order SQL

Implemented:

- `json_data->>blood_type=eq.A-` and similar filters compile as PostgreSQL arrow expressions rather than quoted pseudo-column names.
- Mixed object/array paths preserve `->` / `->>` and numeric indexes.
- The same formatter is used for order expressions and nested/negated logical predicates.

Still open:

- JSON-path/cast handling in SELECT projection.
- Full upstream cast grammar and aggregate/select expression behavior.

### Spread SQL, including spread-star

Upstream `SpreadQueriesSpec.hs` was used as the oracle.

Implemented:

- To-one `...relation(field,alias:field)` flattening.
- To-many spread where each projected field becomes its own JSON array.
- Aliases on spread fields.
- Nested non-spread embed outputs underneath a spread-to-many parent.
- `...relation(*)` through schema-backed expansion before SQL compilation.

Spread-star design:

- `expandSpreadStars` walks the resolved `ReadPlan` before query modifiers/SQL compilation.
- Only plans whose containing embed has `spread:true` expand `*`; ordinary non-spread `relation(*)` remains row/object projection.
- The compat router resolves target columns through the existing per-schema `SchemaCache`.
- `SchemaCache` already queries `information_schema.columns` ordered by ordinal position and stores columns in insertion-ordered `Map`s, so expansion is deterministic and database-agnostic.
- Nested spread-star relations expand independently.
- `read-sql.ts` retains an invariant guard against receiving an unexpanded spread `*` directly.

Remaining spread audit items:

- Field-name collision/shadowing behavior against upstream.
- Direct PostgreSQL/PGlite execution coverage for spread `!inner` and zero-row behavior.
- More nested/M2M spread combinations.

## Validation status

Fresh `postgrest-0.2.0` scope export was reconciled with the preserved Linux dependency bootstrap on 2026-09-04. During that gate, `src/router.ts` was found truncated in both the scope export and DiagramCraft source element; its complete tail was recovered from the immediately preceding executable scope and the newer upstream-adjudicated preference/upsert changes were reapplied.

Current verified gate:

- **31/31 Vitest files passing**
- **312/312 tests passing**
- production TypeScript `tsc --noEmit`: passing
- clean production `tsc` build: passing
- generated `dist` rebuilt from the verified source tree
- `npm pack --dry-run`: passing

The singular-media compatibility regression is exercised through the public router boundary (`public-router.ts`), matching the staged migration architecture; the internal flat router is not the public compatibility contract.

This supersedes the earlier 259/259 + focused-probe checkpoint.

## Important upstream-adjudicated conclusions — do not regress

- Successful singular response media type is `application/vnd.pgrst.object+json`.
- A known-total partial exact-count range such as `20-29/100` is HTTP 206.
- If transaction-end override is disabled, `tx=rollback` is ignored and no tx token is emitted in `Preference-Applied`.
- RPC `max-affected` must throw inside the transaction callback so rollback actually occurs.
- Merge-upsert 200 vs 201 depends on actual inserted-vs-updated execution metadata, not returned row count.
- Related ordering is legal only through to-one relationships; to-many related ordering => `PGRST118`.

## Remaining high-value parity work

1. JSON paths/casts in SELECT projection plus aggregate/select expression grammar.
2. Strict nested-query parse errors (`PGRST100`) instead of permissive dropping.
3. Remaining spread edge cases: collisions, `!inner`/zero-row execution, deeper M2M/nested combinations.
4. Deeper relationship parity: self relationships, computed relationships, views and remaining disambiguation/introspection cases.
5. Exact count/read-plan edge behavior and HEAD optimization/fidelity.
6. RPC overload type-coercion nuances and scalar/composite/volatility edge semantics.
7. Remaining SQLSTATE -> PostgREST error/status catalog and response-header edge cases.

DLR currently uses flat queries plus TypeScript joins as a temporary Application Preview integration workaround. That does not waive embedding parity for generated applications in general.


### Dependency cleanup gate (2026-09-04)

Before the browser smoke-test phase, the inherited `@dotdo/postgres-shared` runtime dependency was removed. CSP exports remain locally source-compatible, API-key comparison is local, and resource validation was aligned with PostgREST's quoted-identifier/schema-cache model rather than the abandoned package's unquoted-identifier regex. The full suite and production build are re-run after this change.

### Application Preview bound-parameter integration fix (2026-09-04)

The first real browser/PGlite smoke run found that bound-value SQL reached `SQLExecutor` with the `$` prefix stripped from PostgreSQL placeholders despite source and compiled `dist` containing valid `` `$${n}` `` JavaScript. To avoid any source/bundle interpolation ambiguity, every placeholder generator now uses `'$' + n` instead. This covers flat queries, replacement read-plan SQL, INSERT/PATCH/DELETE, and RPC. Public-router boundary coverage now asserts both SQL `$1` and the matching parameter array.

Current verified gate after this integration fix: **32/32 test files, 316/316 tests**, production typecheck passing, clean production build passing.
