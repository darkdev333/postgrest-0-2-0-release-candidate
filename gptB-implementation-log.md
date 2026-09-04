# GPT-B implementation log

Append-oriented working log for the delegated PostgREST compatibility implementation lane.

## 2026-09-03 - Batch 1: wire contract + browser portability

Read `PROJECT-BACKGROUND.md`, `CLAUDE-TASK.md`, DiagramCraft import guidance, the live package tree, and current upstream PostgREST singular/range references.

Implemented and checkpointed:

- `src/errors.ts`: browser-safe PostgreSQL/PostgREST error normalization.
- `src/media.ts`: singular object Accept negotiation.
- `src/router.ts`: removed `process.env`, added normalized error responses, singular reads, one-row singular mutation representations, plural default insert representations, removed mandatory PATCH/DELETE filters, empty-body response cleanup.
- `src/headers.ts`: canonical Content-Range syntax, Range-Unit, invalid reversed-range rejection, empty-body Content-Type handling.
- `src/index.ts`: compatibility helper exports.
- `src/__tests__/compatibility.test.ts`: wire-level regression tests.
- `src/__tests__/pagination.test.ts`: replaced old permissive RED-phase coverage with strict canonical range/count tests.
- `tsconfig.json`, `PARITY.md`, `INTEGRATION.md`, `CHANGELOG-DIAGRAMCRAFT.md`.

Upstream checks:

- `SingularSpec.hs`: exact `PGRST116` singular-cardinality contract and rollback requirement for mutations.
- `RangeSpec.hs` / pagination docs: canonical `Content-Range`, separate `Range-Unit`, and `PGRST103`/416 for count-known invalid offsets.

Validation limitation: npm registry access times out in this execution environment, so dependencies cannot be installed and Vitest cannot run here. Standalone compatibility helpers compile. Forced project emit produces JS but reports unresolved external package typings; emitted runtime JS was inspected rather than treated as a passing typecheck.

Important open design issue: wrong-cardinality singular mutations must be atomic/rollback-safe. The one-call `SQLExecutor` cannot perform mutate -> inspect row count -> rollback. Do not mark that parity item complete until an atomic SQL pattern or transaction-capable executor extension exists.

## 2026-09-03 - Batch 1.1: package-entrypoint synchronization

The package publishes `dist`, so source-only changes were insufficient. Synchronized runtime `dist/router.js`, `dist/headers.js`, `dist/index.js`, new `dist/errors.js`, `dist/media.js`, and declaration exports. Node syntax-check passed on the corrected compact runtime router before publishing it.

Also replaced the legacy pagination RED-phase test file rather than preserving assertions that expected the obsolete `items ` prefix inside `Content-Range`. The new suite retains strict coverage for range parsing, range headers, limit/offset, count query generation, exact count integration, unknown totals, and Range precedence.

DiagramCraft write discipline: every checkpoint was merged under `PostgREST Compatibility Comparison/postgrest-0.1.1`; no project-root replacement and no DiagramCraft production source changes.

## 2026-09-03 — Batch 2: strict range + HEAD fidelity

Implemented `PGRST103` range failures, including descending Range headers, negative limits, and exact-count offsets beyond the collection with `Content-Range: */total`. Added open-ended range parsing and partial-content status selection when a known total proves the response is partial.

Corrected HEAD semantics: it now executes the same row query as GET so response range metadata matches the requested slice, discards only the body, and does not force `count=exact` unless requested. Added `range.ts`, `range.test.ts`, and `range-router.test.ts`; synchronized `dist/router.js`, `dist/errors.js/.d.ts`, and `dist/range.js/.d.ts`.

Upstream reference checked against current `RangeSpec.hs`. Remaining important caveat: planned/estimated counts are not planner estimates yet, and singular mutation rollback still requires a transactional executor extension.

## 2026-09-03 — Batch 3: schema profiles

Implemented PostgREST/Supabase schema switching. `PostgRESTRouterOptions` now accepts ordered `schemas`; GET/HEAD select with `Accept-Profile`, writes select with `Content-Profile`, and the first configured schema remains the default. Each active schema gets its own `SchemaCache` and `QueryBuilder` schema, preventing metadata bleed between profiles.

Unconfigured profiles return HTTP 406 / `PGRST106` with the canonical allowed-schema message. Added `profiles.ts`, unit coverage, and `profile-router.test.ts` assertions that profile selection changes both information-schema introspection parameters and generated schema-qualified SQL. Updated `INTEGRATION.md`, `PARITY.md`, public router declarations, and published `dist` runtime/profile helpers.

Current client/upstream references checked: `@supabase/postgrest-js` sets `Accept-Profile` on GET/HEAD and `Content-Profile` otherwise; PostgREST documents the same behavior and `PGRST106` for non-exposed schemas.


## 2026-09-03 — Batch 4: insert defaults + upsert

- Added `src/insert.ts` as an isolated PostgREST INSERT/UPSERT compiler and synchronized `dist/insert.js` + declarations.
- Corrected a semantic inversion in the inherited builder path: absent keys in heterogeneous JSON inserts are now NULL by default; only `Prefer: missing=default` emits SQL `DEFAULT`.
- Added `resolution=merge-duplicates` -> `ON CONFLICT (...) DO UPDATE` and `resolution=ignore-duplicates` -> `DO NOTHING`.
- POST parses `on_conflict`, validates every target against the selected schema-cache table, and returns a PGRST-shaped missing-column error before SQL execution.
- Merge-upsert without explicit `on_conflict` falls back to the table primary key.
- Added focused compiler tests for NULL/default behavior, compound conflict targets, merge and ignore modes.
- Published `dist/router.js` now imports and uses the insert compiler.
- Important remaining boundary: PATCH `columns=...` + `missing=default` semantics are not part of this batch; upsert status 200/201 nuance still lacks execution metadata.


## 2026-09-03 — Batch 5: optional transaction/session executor

- Added `executor.ts` with backwards-compatible callable `SQLExecutor`, optional `transaction(callback, context)`, `SQLStatementExecutor`, and `SQLTransactionContext`.
- Added router `transactionContext(request, schema)` hook for verified role/request-local PostgreSQL settings.
- GET row+count, mutations, and RPC now execute through one optional request transaction when available; legacy executors continue direct execution.
- Updated INTEGRATION.md with the adapter responsibility boundary: PGlite-specific BEGIN/COMMIT/ROLLBACK, SET LOCAL role, and set_config live in the executor adapter, not the PostgREST router.
- Added executor regression tests and synchronized `dist/executor.js`, declarations, router runtime, and router declarations.
- This seam is now ready for atomic singular-cardinality and max-affected rollback in the next batch.


## 2026-09-03 — Batch 6: atomic singular mutations

- Singular POST/PATCH/DELETE now require rollback-capable transaction semantics, force `RETURNING` internally, and inspect cardinality inside the transaction.
- Wrong cardinality throws inside the callback so the executor can roll back, then maps to canonical 406 / `PGRST116`.
- Valid singular minimal mutations still return empty 201/204 semantics while using returned rows internally for validation.
- Non-transactional executors are refused before any singular mutation with a 501 adapter-capability response; regression test asserts zero mutation calls.
- Source and published router runtime synchronized.

## 2026-09-03 — Batch 7: strict max-affected

- Added `handling=strict|lenient` preference parsing and canonical applied-header behavior.
- Added `PGRST124` (`The query affects N rows`) and `PGRST128` error helpers from current upstream specs.
- PATCH/DELETE with `handling=strict, max-affected=N` force `RETURNING`, count rows inside the transaction, and roll back with 400 / `PGRST124` when over limit.
- Lenient handling ignores max-affected and echoes only `handling=lenient`.
- Strict enforcement without transaction capability is refused before mutation.
- Added max-affected rollback/header/capability regression tests and synchronized headers/errors/router/index runtime + declarations.
- RPC max-affected return-type fidelity remains separate because current schema cache has no routine return metadata needed to distinguish SETOF/TABLE from void (`PGRST128`).


## 2026-09-03 — Batch 8: RPC max-affected metadata/enforcement

- Added `RoutineCache` backed by `pg_proc` / `pg_namespace`, caching `proretset`, void-return status, and `pg_get_function_result` by schema+routine name.
- Strict RPC `max-affected` now requires rollback capability, counts returned set/table rows inside the transaction, and rolls back with canonical `PGRST124` on overflow.
- If all known overloads for a routine return void, strict max-affected returns canonical `PGRST128` before invoking the function.
- Added RPC max-affected tests for overflow rollback, known-void preflight rejection, and successful in-limit applied preferences.
- Synchronized `src`, `dist`, declarations, and public exports for routine metadata.
- Overload selection remains unresolved; metadata currently describes candidate overloads rather than choosing by argument signature.


## 2026-09-03 — Batch 9: single-execution POST RPC shaping

- Added `rpc.ts` envelope compiler: function invocation is materialized once; result filtering/select/order/page occurs over that materialized result.
- Envelope returns JSON page rows plus filtered count and unpaged affected count in one SQL statement.
- POST RPC JSON body remains named function arguments; URL params are parsed as result-query modifiers.
- Range header overrides RPC limit/offset; count uses filtered count; strict max-affected uses unpaged affected count.
- Set/table routine metadata keeps set-like responses plural while scalar routines preserve scalar result formatting.
- Updated RPC max tests so paging cannot evade max-affected; added SQL/integration tests for one invocation, argument/filter separation, Range and Content-Range.
- Synchronized `src/rpc.ts`, `dist/rpc.js`, router runtime, declarations, and public exports.


## 2026-09-03 — Batch 10: PATCH columns + missing defaults

- Added dedicated PATCH compiler for explicit `columns=` targets and mutation defaults.
- Explicit columns ignore extra payload keys, validate against schema cache, and return `PGRST204` before mutation for unknown columns.
- Listed-but-omitted keys compile to SQL DEFAULT under `missing=default`; otherwise NULL.
- Empty update targets are no-ops rather than builder errors.
- Central applied preference ordering now places `missing=default` before return and after conflict resolution, matching UpdateSpec/UpsertSpec examples.
- Added update compiler/router tests and synchronized source, published runtime/declarations, and public exports.
- Method-aware preference applicability remains the next cleanup; current central header helper can still echo an irrelevant parsed preference on an operation where it does not apply.

## Batch 11 — strict preferences + transaction-end semantics

- `Prefer` parser now retains invalid tokens.
- `handling=strict` returns canonical HTTP 400 / `PGRST122` before request SQL; lenient/default handling ignores unknown tokens.
- Added `dbTxEnd` router option mirroring PostgREST opt-in transaction-end preferences.
- Added `SQLTransactionContext.transactionEnd: 'commit'|'rollback'` and propagate enabled `tx=` requests to transactional executors.
- Disabled `tx=` requests are stripped and not echoed; enabled `tx=` against a nontransactional executor fails before SQL rather than falsely claiming rollback/commit.
- Added batch-11 regression coverage and synchronized `src`, `dist`, declarations, public exports, and `PARITY.md`.

## Batch 12 — GET RPC signature-aware shaping

- Routine cache now records OID, named input args, input types, defaultable/required args, and return shape.
- Added conservative named-argument overload matching and typed routine signatures.
- Added GET RPC parameter partitioning: named raw values become function args; reserved modifiers/operator-prefixed filters remain result query parameters.
- Uniquely matched GET RPC now uses the single-execution RPC envelope for select/filter/order/range/count/max-affected behavior.
- Ambiguous named overloads return HTTP 300 / `PGRST203` with the upstream overload-resolution hint.
- Added unit + router-level GET RPC tests and synchronized `src`, `dist`, declarations, exports, and `PARITY.md`.
- Exact `PGRST202` no-match fidelity and type-aware overload preference remain open.

## Batch 13 — canonical GET RPC no-match

- Replaced the remaining unmatched GET-RPC raw-call fallback with canonical schema-cache rejection.
- Added `noRpc()` helper for HTTP 404 / `PGRST202` common named-argument behavior.
- Unknown GET RPC args now fail before function SQL execution; regression test asserts the function body is never invoked.
- Synchronized source, published `dist`, declarations, exports, tests, and `PARITY.md`.
- Fuzzy hints and unnamed-body overload nuances remain open.

## Batch 14 — executable regression pass (in progress)

User supplied a populated npm dependency tree and ran the suite: 233/238 tests passed; 5 failed. The visible RPC max-affected failure exposed a real atomicity bug: POST/GET RPC decoded the single-execution envelope inside the transaction but compared `__pgrst_affected` only after the transaction callback returned, so `PGRST124` was emitted without causing rollback. `src/router.ts` now performs strict RPC max-affected comparison and throws `MaxAffectedMismatch` inside the transaction callback for both POST and GET RPC. Do not mark batch complete until the full five-failure suite is reproduced, remaining failures fixed, and `dist` regenerated from TypeScript.


## Batch 15 — upstream-grounded Preference-Applied projection

- Confirmed behavior directly from upstream `Response.hs::responsePreferences`; existing local tests are treated as regression signals, not behavioral authority.
- Added `responsePreferences()` plan projection: resolution only for inserts with a conflict target; return only for mutations; missing only for insert/update; max-affected only for update/delete/RPC; count/tx/handling remain request-wide.
- Routed table reads/writes and RPC responses through the projection and removed the insert-only ad hoc applied-header path.
- Added focused applicability tests and targeted runtime assertions.
- User-provided Windows `node_modules` can run TypeScript here but Vitest is blocked on Linux because Rollup's Linux native optional package is absent; the user's pre-fix Windows run was 233/238.
- Batch-14 RPC max-affected rollback fix is included in the compiler-generated published router: the overflow check now throws inside the transaction callback.
- Regenerated `dist/headers.js`, `dist/router.js` and their declarations from TypeScript rather than hand-editing runtime output.


## 2026-09-03 — architecture re-audit / relationship planner decision

Authority clarified: upstream Haskell PostgREST source and `test/spec/Feature/**` are normative. The abandoned npm package and inherited tests are non-authoritative regression artifacts.

Decision: **salvage the package; do not restart.** Keep Hono/Web APIs, router, browser portability, `SQLExecutor`, transaction/session seam, and completed CRUD/RPC/error/profile compatibility work. Replace weak internals in place where dotdo diverges, especially relationship/read planning.

Embedding remains required parity. DLR's current flat-select + TypeScript-join workaround only avoids making embeds a first-integration blocker; it is not a product decision. Existing embed logic is too simplistic to extend safely because it effectively picks a first FK and does not model cardinality, ambiguity, hints, `!inner`, nested filters, M2M, etc.

Upstream `SchemaCache.Relationship` explicitly models O2M, M2O, O2O, M2M/junction, self/computed relationships, FK constraint identity and ordered column pairs. Next implementation track: richer relationship cache -> nested select AST -> relationship resolution -> read-plan tree -> SQL/JSON shaping -> upstream-derived embed tests.

Created `EXTERNALIZED-CONTEXT.md` and `HANDOFF.md` so this decision and the DLR workaround context survive thread loss. Standing DiagramCraft write rule: if root `postgrest-0.1.1` is upserted, preserve `is_project_root: true` and use `children_mode: merge`.


## 2026-09-03 — relationship/read-planner foundation

Implemented and published a replacement relationship/read-planning foundation without disturbing the flat CRUD path.

- Added `src/relationships.ts` + `dist` exports. It groups FK rows by constraint, preserves composite column pairs, exposes direct/inverse cardinality, preserves ambiguous candidates instead of choosing `[0]`, and conservatively discovers common M2M junctions whose FK column union forms the junction primary key.
- Added relationship tests covering ambiguity, hints by constraint/column, composite FK grouping, M2O/O2M shaping, and M2M discovery.
- Added `src/select.ts`: new nested PostgREST select AST parser grounded against upstream `QueryParams.hs`, including canonical `alias:relation!inner!hint(*)`, field `alias:column`, nested embeds, relationship hints, join type and spread marker.
- Added `src/read-plan.ts`: resolves parsed embeds recursively against relationship candidates and raises `PGRST200`/`PGRST201` states rather than silently selecting the first relationship.
- Added select/read-plan tests for upstream alias/hint/inner syntax, nested trees, disambiguation, and no-relationship behavior.
- Source-only TypeScript 5.0.2 compilation passes for these new modules. Published JS/declarations and package entrypoint exports are synchronized.

Next: cardinality-aware embedded SQL generation (to-one object vs to-many array, LATERAL joins, `!inner` filtering), then wire the new planner into GET while retaining flat behavior as the safe fallback during migration.


## Batch 15 — upstream adjudication of executable regression failures

All four remaining failures from the first runnable Vitest pass were settled against the canonical Haskell PostgREST tree before changing behavior/tests.

- **Singular media type:** upstream `SingularSpec.hs` requires successful `Accept: application/vnd.pgrst.object+json` responses to return the singular media type. This was a real adapter defect. The public package boundary now normalizes successful singular responses to `SINGULAR_MEDIA_TYPE`; error responses remain ordinary JSON. A focused `public-router.test.ts` was added.
- **Pagination status:** upstream `RangeSpec.hs` uses HTTP **206** whenever an exact/known total proves the returned non-empty range is partial (for example `20-29/100`). The inherited pagination test expecting 200 was stale and is corrected to 206.
- **Transaction preference disabled:** upstream `RollbackSpec.hs` shows that when transaction override is disallowed, `Prefer: tx=rollback` is ignored and no `Preference-Applied: tx=...` token is emitted. The inherited test had a malformed Chai assertion against `null`; it now asserts the header is absent.
- **Insert test matcher:** `toEndWith` is not a Vitest/Chai matcher. This was test harness drift, not PostgREST behavior; replaced with `built.sql.endsWith(...)=true`.

Executable result on the uploaded dependency snapshot after these upstream-grounded corrections: **17 test files passed, 238/238 tests passed**. The previous RPC max-affected transaction rollback failure is also confirmed green in this run.

Publication cleanup in the same batch:
- added `src/public-router.ts` as the package boundary for negotiated response normalization while the older flat router is incrementally retired;
- added `dist/public-router.js` and `.d.ts`;
- switched `src/index.ts`, `dist/index.js`, and `dist/index.d.ts` to export the public boundary;
- synchronized `dist/index.d.ts` with the newer relationship/read-planner/error exports that had drifted from source.

Authority rule remains: Haskell PostgREST source/specs override inherited npm tests whenever they disagree.


## Batch 15 — upstream related ordering

Implemented PostgREST related ordering from Haskell `RelatedQueriesSpec.hs` / `Plan.addRelatedOrders` / `QueryBuilder` rather than extending the abandoned parser heuristically.

- `order=clients(name).asc|desc[.nullsfirst|nullslast]` is represented explicitly in the read-plan AST.
- Related ordering is alias-aware (`client:clients(...)` => `order=client(name)`).
- The related resource must be present in `select`; otherwise canonical `PGRST108` is returned.
- Only to-one M2O/O2O relationships may be used for parent related ordering; to-many emits canonical `PGRST118`/400.
- SQL ordering resolves to the selected relationship's lateral alias, mirroring upstream `addRelatedOrders`.
- Nested related order such as `tasks.order=projects(id).desc` is supported.
- JSON-path related order such as `trash_details(jsonb_col->key).asc` is compiled with PostgreSQL `->` / `->>` semantics.
- `src` and generated `dist` surfaces were synchronized.

Executable gate on the current hybrid tree: **19 test files / 250 tests passed**. Source-only TypeScript compilation is clean. Remaining `npm run typecheck` complaints are inherited test-mock generic typing, not production source.


## Batch 16 — embed null/existence filtering

Implemented upstream `Plan.addNullEmbedFilters` behavior for FK-backed embeds.

- A selected embed filtered with `embed=not.is.null` is rewritten to an embed-existence predicate rather than treated as a physical column filter.
- `embed=is.null` is the corresponding non-existence predicate.
- SQL uses the internal lateral/aggregate alias with upstream-compatible `IS DISTINCT FROM NULL` / `IS NOT DISTINCT FROM NULL` semantics.
- Works for M2O/O2O, O2M, M2M, selected aliases, and nested paths such as `child_entities.grandchild_entities=not.is.null`.
- Ordinary filters on a column that happens to share the relationship name remain ordinary unless the operator is specifically `is.null` / `not.is.null`, matching upstream's documented distinction.
- Exact-count SQL preserves the existence predicate.
- Added `EmbedNullFilter` to the read-plan AST and public types.

Executable gate after this batch: **20 test files / 256 tests passed**; source-only TypeScript compilation remains clean.


## Batch 17 — logical trees across embedded resources

Implemented the upstream sibling-embed logical pattern from `RelatedQueriesSpec.hs`, including the canonical case where child filters are applied to separate embedded plans and a parent `or=(embed1.not.is.null,embed2.not.is.null)` combines their existence predicates.

- Added an explicit `ReadLogicTerm` AST so logical expressions can distinguish ordinary field filters from selected-embed null/existence predicates.
- Child filters remain scoped to their child lateral queries; parent logical expressions reference the corresponding internal embed aliases.
- `and` / `or` trees compile recursively and retain negation state supplied by the parser.
- Ordinary field predicates inside logical expressions remain ordinary predicates.
- Exact-count SQL preserves the logical/existence tree.
- Public type declarations now export `ReadLogicTerm`.
- `src` and generated `dist` runtime/declaration surfaces are synchronized.

Executable gate after this batch: **21 test files / 259 tests passed**. Source-only TypeScript compilation is clean.

This is not yet a claim of full PostgREST logical-query grammar parity: the inherited parser still needs a direct upstream audit for deeper nested logical syntax and negated logical operators before that broader claim is made.


## Handoff hardening — 2026-09-04

Refreshed durable transfer state because the active chat appeared to stall while upstream-auditing the next planner slice. Verified the DiagramCraft tree itself is ahead of that visible chat position: related ordering, embed existence semantics, and sibling cross-embed existence logic are already present, with the recorded executable gate at **259/259**. Replaced `HANDOFF.md` with a complete takeover document and added `NEXT-THREAD-PROMPT.md` for copy/paste delegation. Next thread must resume from broader nested/negated logical-query grammar, not reimplement completed batches. Reiterated authority order (Haskell PostgREST first), staged router architecture, Linux native test deps, and the `is_project_root:true` preservation rule for any root upsert.


## 2026-09-04 — PostgREST js2: recursive logic, JSON paths, explicit-field spread

Authority consulted before each behavior change: upstream Haskell PostgREST, especially `ApiRequest/QueryParams.hs`, `Query/SqlFragment.hs`, `AndOrParamsSpec.hs`, and `SpreadQueriesSpec.hs`.

Implementation:

- Added `src/read-logic.ts`, a recursive logical-query parser scoped to the replacement compatibility read planner rather than rewriting the abandoned global parser. It handles nested `and`/`or`, `not.and`/`not.or`, root negated logical keys, embedded/aliased negated logical keys, and comma-safe quoted/array values.
- Updated `src/read-query.ts` to route ordinary and negated logical keys to the resolved read-plan path and feed the existing `ReadLogicTerm` tree.
- Updated `src/read-sql.ts` with a shared PostgreSQL JSON field-expression formatter used by filters/order and therefore nested logical predicates; mixed `->`/`->>` and numeric array indexes are preserved.
- Extended `src/read-sql.ts` with explicit-field spread shaping. To-one spread flattens child projections; to-many spread aggregates each projected output field into its own JSON array. Nested non-spread embed outputs are valid projected values under spread-to-many.
- Deliberately reject spread `*` with `Spread embeds with * require schema-backed field expansion`; upstream supports it, but guessing output columns would be incorrect.
- Updated `src/__tests__/embed-logic.test.ts` and `src/__tests__/read-sql.test.ts`; added `src/__tests__/spread-sql.test.ts`.
- Synchronized generated `dist/read-logic.*`, `dist/read-query.*`, and `dist/read-sql.js` runtime/declarations where public types changed.

Validation:

- Previous complete authoritative checkpoint: 259/259.
- New focused upstream-derived probes: 12/12 passing (5 logic, 3 JSON path, 4 spread).
- Focused TypeScript `--noEmit` compile for changed planner/compiler files passes.
- Supplied Linux execution ZIP is a dependency bootstrap with an older source snapshot. A merged authoritative full-suite total has not been fabricated; full rerun remains pending reconstruction/export of the current DiagramCraft tree.

Remaining next targets:

1. schema-backed `...relation(*)` spread-star expansion and remaining spread edge cases;
2. JSON path/casts in SELECT projection and aggregate/select grammar;
3. strict malformed logical/query parsing with canonical `PGRST100` diagnostics;
4. deeper self/computed/view relationship parity.

### Spread-star follow-up

The existing `SchemaCache` already supplies the missing information for upstream `...relation(*)` semantics: columns are queried by `ordinal_position` and stored in insertion order. Added `expandSpreadStars(plan, resolveColumns)` in `read-plan.ts` and call it from `compat-router.ts` after relationship resolution and before query modifiers/SQL generation. Only a spread containing plan expands `*`; ordinary non-spread `relation(*)` stays as `table.*`. Nested spread contexts are handled recursively. `read-sql.ts` keeps its unexpanded-star guard as an invariant check.

Tests persisted in DiagramCraft cover planner expansion and public compat-router SQL shape. Two isolated helper/compiler probes run successfully in the Linux bootstrap, moving the focused executable gate from 12/12 to 14/14. The bootstrap's stale `relationships.ts` lacks the authoritative resolver and therefore cannot execute the new public-router integration test without broader source reconstruction.


## 2026-09-04 — public 0.2.0 reconciliation

Reconciled the user-provided renamed `postgrest-0.2.0` scope with the preserved Linux node_modules/native Rollup+esbuild bootstrap. The full run discovered that `src/router.ts` had been truncated at the PATCH/DELETE builder call in both DiagramCraft and the export. Recovered the complete router from the immediately preceding executable scope and reapplied the newer `responsePreferences` projections plus insert execution metadata (`insertedCount`) status behavior.

Public-repo hygiene was also completed: MIT LICENSE, provenance NOTICE, corrected repository/version/author metadata, `.gitignore`, npm publication guard, and README licensing/provenance language. The old compatibility test was changed to exercise `public-router.ts`, where singular response media normalization is intentionally owned by the staged migration architecture. `tsconfig.json` now excludes `src/__tests__` from production `dist`.

Final gate: 31/31 Vitest files, 312/312 tests, production no-emit typecheck, clean production build, and npm pack dry-run all pass.

## 2026-09-04 — `@dotdo/postgres-shared` dependency removal

Audited all active uses of the inherited package before the browser smoke-test phase. CSP helpers were peripheral public exports, API-key comparison was a tiny Web-platform utility, and the identifier validator was stricter than PostgREST's schema-cache/quoted-SQL model. The dependency was removed. CSP helpers are retained locally with provenance in NOTICE, constant-time comparison is local, and default resource validation now permits names requiring quoted PostgreSQL identifiers while rejecting empty/whitespace/NUL names. Added focused validation coverage and retained the configurable `validateTable`/`validateFunction` hooks for applications that want stricter policies.

## 2026-09-04 — Application Preview placeholder integration fix

Received first end-to-end smoke feedback from the Application Preview thread. The real Supabase/PostgREST client -> Hono -> adapter -> SQLExecutor -> PGlite chain worked for unparameterized operations, but every bound-value query arrived at SQLExecutor with `$N` rewritten to bare `N`. Source and checked-in `dist` used valid JavaScript template literals (`` `$${n}` ``), so the adapter was hardened against the preview source/bundle pipeline by replacing all placeholder template interpolation with string concatenation (`'$' + n`) across `builder.ts`, `insert.ts`, `update.ts`, `rpc.ts`, and `read-sql.ts`. Added exact executor-boundary/public-router and embedded SQL assertions. Linux gate: 32 files / 316 tests green; production typecheck and clean build green.
