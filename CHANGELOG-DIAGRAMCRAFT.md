# DiagramCraft compatibility changelog

## 2026-09-03 - GPT-B batch 1

- Removed browser-incompatible `process.env.NODE_ENV` use from the runtime router.
- Added PostgREST/PostgreSQL error normalization preserving `code`, `message`, `details`, and `hint`.
- Corrected `Content-Range` wire syntax and added `Range-Unit: items`.
- Added singular object media negotiation for reads and one-row mutation representations.
- Added upstream-compatible `PGRST116` read cardinality errors.
- Corrected default insert representation from object to array.
- Removed mandatory PATCH/DELETE filter restriction.
- Removed JSON Content-Type from empty minimal mutation responses.
- Added TypeScript build config and compatibility-focused tests.
- Documented the unresolved transaction/rollback requirement for wrong-cardinality singular mutations.

## 2026-09-03 — GPT-B batch 2

- Added HTTP 416 / `PGRST103` range failures for descending ranges, negative limits, and exact-count offside offsets.
- Added open-ended Range parsing and HTTP 206 for known-total partial reads.
- Corrected HEAD to mirror GET range metadata without forcing exact count.
- Added dedicated range helper and router compatibility tests.
- Synchronized changed source behavior into published `dist` runtime/declarations.

## 2026-09-03 — GPT-B batch 3

- Added ordered multi-schema exposure with `schemas`.
- Added `Accept-Profile` / `Content-Profile` routing matching PostgREST and `postgrest-js`.
- Added per-schema metadata caches and schema-qualified query generation.
- Added HTTP 406 / `PGRST106` for unexposed schemas.
- Added profile unit/integration tests and synchronized `dist` runtime/declarations.


## 2026-09-03 — GPT-B batch 4

- Corrected POST missing-column semantics: absent JSON keys now map to NULL unless `Prefer: missing=default` is requested.
- Added isolated INSERT/UPSERT compiler with `merge-duplicates`, `ignore-duplicates`, primary-key fallback, and compound `on_conflict` targets.
- Added schema-cache validation for `on_conflict` columns and PGRST-shaped pre-execution errors.
- Added insert/upsert regression tests and synchronized published `dist` runtime artifacts.


## 2026-09-03 — GPT-B batches 5–7

- Added optional transaction/session executor capability and request-local schema/role/settings context hook.
- Added atomic singular POST/PATCH/DELETE rollback with canonical `PGRST116`; unsafe nontransactional singular writes are refused before mutation.
- Added `handling=strict|lenient` and rollback-capable PATCH/DELETE `max-affected` enforcement with canonical `PGRST124` and upstream-compatible Preference-Applied behavior.
- Added transaction, singular-mutation, and max-affected regression suites; synchronized public runtime/declaration exports.


## 2026-09-03 — GPT-B batch 8

- Added PostgreSQL routine metadata cache (`proretset`, void return, result type).
- Added transactional RPC `max-affected` overflow rollback with `PGRST124` and known-void `PGRST128` preflight behavior.
- Added RPC max-affected regression tests and synchronized routine runtime/declarations/public exports.


## 2026-09-03 — GPT-B batch 9

- Added single-execution POST RPC result shaping with materialized function result, flat select/filter/order/page support, filtered count, and unpaged affected count.
- Range/count/max-affected now operate over one RPC invocation; body arguments remain separate from result query parameters.
- Added RPC shaping/range/count regression tests and synchronized runtime/declaration/public exports.


## 2026-09-03 — GPT-B batch 10

- Added PATCH `columns=` target shaping, schema validation, omitted-key DEFAULT/NULL semantics, and empty-body no-op behavior.
- Corrected canonical `missing=default` applied-preference ordering for mutation responses.
- Added PATCH column/default regression tests and synchronized runtime/declaration/public exports.

- Batch 11: added strict preference validation (`PGRST122`), invalid-token retention, opt-in `dbTxEnd`, and transactional `tx=commit|rollback` propagation via `SQLTransactionContext.transactionEnd`; synchronized source, runtime, declarations, exports, and tests.

- Batch 12: added routine argument/type metadata, conservative named-argument overload matching, GET RPC argument/result partitioning and single-execution result shaping, plus HTTP 300 / `PGRST203` ambiguity handling; synchronized source/runtime/declarations/tests.

- Batch 13: replaced unmatched GET RPC raw-call fallback with canonical HTTP 404 / `PGRST202` schema-cache rejection; added regression coverage proving no function invocation occurs on an unknown named signature.


## 2026-09-03 — GPT-B batches 14–15

- Fixed RPC strict `max-affected` atomicity: overflow is now raised inside the transaction callback, so `PGRST124` causes rollback.
- Added upstream `Response.hs`-grounded, method-aware `Preference-Applied` projection and focused regression coverage.
- Regenerated changed published runtime/declarations from TypeScript using the uploaded dependency tree.
- Validation note: user's Windows test run was 233/238 before the rollback fix; Linux Vitest execution remains blocked only by Rollup's platform-native optional package mismatch in the Windows-installed `node_modules` snapshot.


## 2026-09-04 — PostgREST js2 read-planner parity batches

- Added a read-planner-local recursive logical parser grounded in upstream `ApiRequest/QueryParams.hs` / `AndOrParamsSpec.hs`.
- Added recursive `and`/`or`, nested `not.and`/`not.or`, root `not.and=...`, embedded alias negated logic, and comma-safe quoted/array logical values.
- Added PostgreSQL JSON-path expression compilation for filters/order, including mixed `->`/`->>` chains and numeric array indexes, and reused it inside nested logical trees.
- Added upstream `SpreadQueriesSpec.hs`-derived explicit-field spread shaping: to-one flattening, to-many per-field JSON arrays, aliases, and nested non-spread object outputs under spread-to-many parents.
- `...relation(*)` remains explicitly unsupported until schema-backed spread-star field expansion is implemented; no guessed column behavior was introduced.
- Added/expanded `embed-logic.test.ts`, `read-sql.test.ts`, and new `spread-sql.test.ts` coverage.
- Synchronized `src` and generated `dist` for `read-logic`, `read-query`, and `read-sql` changes.
- Validation: prior full authoritative checkpoint remains 259/259; new focused upstream-derived gate is 12/12 plus focused TypeScript compile. The supplied Linux execution ZIP contains an older source snapshot, so no fabricated merged full-suite total is claimed.

### 2026-09-04 — spread-star completion follow-up

- Added `expandSpreadStars` to the resolved read-plan path. It expands `*` only for spread embeds and leaves ordinary `relation(*)` row/object projection unchanged.
- Wired spread-star expansion through the existing per-schema `SchemaCache`, using ordinal-position column order before SQL compilation.
- Added planner coverage for top-level/nested spread-star expansion and public compat-router coverage for `select=client_id,...clients(*)`.
- Synchronized `dist/read-plan.*` and `dist/compat-router.js`.
- Focused executable bootstrap gate is now 14/14 (the prior 12 probes plus 2 spread-star helper/compiler probes). Public compat-router integration coverage is persisted in DiagramCraft but cannot run against the stale source snapshot in the bootstrap without reconstructing current relationship-cache/planner files.


## 2026-09-04 — 0.2.0 public-repository readiness

- Renamed public line to `0.2.0` and prepared repository metadata for `darkdev333/postgrest-0.2.0`.
- Added an MIT `LICENSE`, provenance-focused `NOTICE.md`, and `.gitignore`; removed package metadata that incorrectly presented the fork as a dot.do-authored/publication target.
- Kept npm publication disabled (`private: true`) while the eventual public package name remains undecided.
- Fresh scope reconciliation exposed a truncated `src/router.ts`; recovered the complete implementation from the preceding executable scope and reapplied the newer method-aware Preference-Applied + inserted-vs-updated status work.
- Corrected the inherited singular-media compatibility test to exercise the documented public router boundary.
- Production TypeScript config no longer emits test files into `dist`.
- Verified publish gate: **31/31 test files, 312/312 tests**, production `tsc --noEmit` passing, clean `tsc` build passing, and `npm pack --dry-run` passing.
