# PostgREST Compatibility — active implementation handoff

## READ THIS FIRST

Durable transfer point for the DiagramCraft PostgREST compatibility implementation lane.

Workspace: `Diagram Craft Dev`
Workspace ID: `9e8662f1-f269-42a8-ba22-921f45d513ad`
Diagram: `diagramcraft.preview Apps`
Diagram ID: `91a98980-4df3-4609-86b8-84b4da1bb620`
Project root: `PostgREST Compatibility Comparison/postgrest-0.1.1`
Package root: `PostgREST Compatibility Comparison/postgrest-0.1.1/package`

DiagramCraft is the authoritative working tree. Read the canonical DiagramCraft authoring/import spec, then `NEXT-THREAD-PROMPT.md`, this file, `EXTERNALIZED-CONTEXT.md`, `PARITY.md`, `INTEGRATION.md`, `gptB-implementation-log.md`, `CHANGELOG-DIAGRAMCRAFT.md`, and `PostgREST Compatibility Comparison/CLAUDE-TASK.md` for original intent. `CLAUDE-TASK.md` is not inside `package`.

## Behavioral authority

1. upstream Haskell `PostgREST/postgrest` source/specs/tests
2. real Supabase/PostgREST behavior where useful
3. this adapter's upstream-derived compatibility tests
4. abandoned dotdo behavior/tests only as historical regression substrate

Never change behavior merely to satisfy an old dotdo test when upstream disagrees.

## Architecture — DO NOT RESTART

Salvage/refactor, not rewrite. Preserve the browser-safe Hono/Web `Request`/`Response`/`SQLExecutor` shell, optional transaction/session context, and mature CRUD/RPC/profile/error/range/preference work.

Migration seam:

`src/index.ts -> public-router.ts -> compat-router.ts -> router.ts`

`compat-router.ts` intercepts embedding/read-planner GET/HEAD traffic. Flat/non-embed traffic delegates to the mature base router. Keep the seam unless there is a demonstrated reason to migrate another route.

Target:

`supabase-js -> postgrest-js -> HTTP/fetch -> Hono/PostgREST adapter -> SQLExecutor -> PGlite`

Runtime must stay browser/Worker compatible. Do not couple this package to Service Worker/SharedWorker/IndexedDB/OPFS/PGlite APIs; those belong to the Application Preview backend adapter.

## Current planner checkpoint

Implemented:

- explicit ambiguity-preserving relationship graph and catalog-backed relationship cache
- composite FK mappings, M2O/O2M/O2O/common M2M modeling
- nested select AST, aliases, hints, `!inner`
- recursive relationship resolution and lateral SQL object/array shaping
- embedded filter/order/limit/offset
- PGRST108/200/201 and PGRST118 paths for implemented relationship/query slices
- related parent ordering through to-one relationships
- embed `is.null` / `not.is.null` existence semantics and exact-count preservation
- sibling cross-embed logical existence expressions
- recursive/negated `and`/`or` grammar including root and embedded `not.and`/`not.or`
- JSON-path filter/order expressions, including nested logical trees
- explicit-field spread semantics for to-one and to-many
- schema-backed spread-star (`...relation(*)`) expansion through the existing `SchemaCache`

### Spread-star architecture

New `expandSpreadStars` in `read-plan.ts` expands `*` only when the containing embed is spread. Ordinary `relation(*)` stays untouched.

`compat-router.ts` invokes the expansion after relationship planning and before query modifiers/SQL compilation. It resolves target columns from the already-existing per-schema `SchemaCache`; that cache obtains columns in `ordinal_position` order and preserves order in its `Map`.

This keeps `read-sql.ts` pure: it receives an explicit plan and never introspects the database. The compiler retains a guard against receiving an unexpanded spread-star directly.

Nested spread-star relations expand independently.

## Changed/current files to inspect before modifying this path

- `src/public-router.ts`
- `src/compat-router.ts`
- `src/read-plan.ts`
- `src/read-query.ts`
- `src/read-logic.ts`
- `src/read-sql.ts`
- `src/select.ts`
- `src/relationships.ts`
- `src/relationship-cache.ts`
- `src/schema.ts`
- `src/errors.ts`
- `src/headers.ts`
- `src/router.ts`
- `src/executor.ts`
- `src/index.ts`

Focused tests now include `embed-logic.test.ts`, `read-sql.test.ts`, `spread-sql.test.ts`, `select-read-plan.test.ts`, `compat-router.test.ts`, plus earlier relationship/cache/query/public-router suites.

## Validation state — report precisely

Current fully reconciled publish gate: **312/312 tests passing across 31/31 Vitest files**, with production `tsc --noEmit` and a clean `tsc` build passing.

The supplied `postgrest-thread-execution-env-2026-09-04.zip` is a Linux dependency/test bootstrap whose source snapshot predates the authoritative planner tree. Linux x64/glibc native packages are:

- `@rollup/rollup-linux-x64-gnu@4.63.1`
- `@esbuild/linux-x64@0.21.5`

The earlier focused bootstrap validation (14/14) has now been superseded by a full reconstructed-tree run. Historical focused coverage included:

- 5 recursive/negated logic probes
- 3 JSON-path SQL probes
- 4 explicit-field spread probes
- 2 spread-star expansion/compiler probes

The earlier focused TypeScript `--noEmit` gate for changed logic/query/SQL files passes.

DiagramCraft also contains authoritative planner/router tests for spread-star integration (`select-read-plan.test.ts` and a `compat-router.test.ts` request using `...clients(*)`). Those cannot be executed against the stale ZIP without reconstructing its missing current relationship-cache/planner files.

A fresh `postgrest-0.2.0` scope export was reconciled with the preserved Linux dependencies. `src/router.ts` was discovered truncated in the export/DiagramCraft tree, recovered from the previous executable scope, and updated with the newer preference/upsert behavior. The resulting source now has a real full-suite gate: 312/312.

`src` and generated `dist` are synchronized for `read-logic`, `read-query`, `read-sql`, `read-plan`, and `compat-router` changes.

## Already adjudicated upstream conclusions — DO NOT REGRESS

- singular success media type: `application/vnd.pgrst.object+json`
- known-total partial exact-count range such as `20-29/100`: HTTP 206
- ignored tx preference does not emit a tx `Preference-Applied` token
- RPC `max-affected` must throw inside the transaction callback to roll back
- merge-upsert 200/201 depends on actual inserted-vs-updated execution metadata
- related ordering is valid only through to-one relationships; to-many => `PGRST118`

## Next implementation targets

Current highest-value read-plan gaps:

1. JSON paths/casts in SELECT projection and aggregate/select expression grammar.
2. Strict malformed query/logical parsing with canonical `PGRST100` diagnostics.
3. Remaining spread edge cases: output-name collisions, `!inner`/zero-row execution, deeper M2M/nested combinations.
4. Self relationships, computed relationships, views and remaining relationship disambiguation/introspection gaps.
5. Exact-count/read-plan and HEAD fidelity edge cases.

Other selective audits remain: type-aware RPC overload matching, RPC scalar/composite/volatility nuances, SQLSTATE error mapping completeness, and response/preference edge cases.

## Integration context

DLR intentionally uses flat queries plus TypeScript joins today so Application Preview integration can proceed concurrently. This is a temporary workaround, not a waiver of embedding parity for generated applications.

## DiagramCraft persistence rules

Always resolve exact paths before mutations. For normal source files use one full `edit_source_code`; append only to append-only logs. Never replace the project root merely to update children. If `postgrest-0.1.1` itself is ever upserted, preserve `is_project_root:true` and use `children_mode:"merge"`.

Keep current after coherent batches: `PARITY.md`, `INTEGRATION.md`, `CHANGELOG-DIAGRAMCRAFT.md`, `gptB-implementation-log.md`, `HANDOFF.md`; update `EXTERNALIZED-CONTEXT.md` only when architecture/context materially changes.

## Resume behavior

Inspect upstream first, implement the smallest coherent parity slice, add upstream-derived tests, run the executable gate available, synchronize `src`/`dist`, persist the checkpoint, then continue. Do not stop at a proposal when implementation can proceed.

## 2026-09-04 integration feedback checkpoint

Application Preview has now proven the real client path through Supabase/PostgREST clients -> Hono adapter -> `SQLExecutor` -> browser PGlite. The first blocker was placeholder transport: template-literal placeholder generation (`` `$${n}` ``) was observed as bare `1`, `2`, ... at the executor boundary in the preview pipeline. All placeholder generators were changed to `'$' + n`, with a public-router executor-boundary regression. Verified gate is now **316/316** plus clean typecheck/build. Re-run the exact smoke suite before expanding integration coverage.
