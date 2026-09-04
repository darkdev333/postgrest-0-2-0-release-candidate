# GPT-B externalized context — PostgREST compatibility

## Authority and objective

The canonical behavioral authority is the upstream Haskell PostgREST project and its `test/spec/Feature/**` suites. The abandoned npm `@dotdo/postgrest@0.1.1` package is only an implementation substrate. Its inherited tests are regression artifacts, not normative behavior. When they conflict with Haskell PostgREST, change the TypeScript implementation/tests to match upstream.

Target runtime: real `@supabase/supabase-js` -> real `@supabase/postgrest-js` -> HTTP -> Hono adapter -> `SQLExecutor` -> PGlite inside DiagramCraft browser/Worker runtime.

## Architectural decision: salvage, do not restart

Do **not** abandon the TypeScript/Hono package. Keep the outer architecture: Hono/Web `Request`/`Response`, router boundary, browser portability, `SQLExecutor`, optional transaction/session capability, CRUD/RPC/error/profile work already completed.

Replace/refactor weak internal subsystems in place where the abandoned implementation diverges from PostgREST, especially the read/query/relationship planner. A rewrite would discard substantial compatible work and likely recreate the same browser architecture.

## Embedding decision

Resource embedding is required parity work. DLR currently avoids `select("*, clients(*)")` and performs multiple flat queries joined in TypeScript only as a temporary Application Preview compatibility workaround. This is **not** a product decision to omit embeddings.

The current abandoned embed code is not trustworthy: it effectively chooses a first matching FK and cannot faithfully model PostgREST cardinality, ambiguity, `!inner`, relationship hints, nested filters, or many-to-many joins.

Upstream Haskell models relationships explicitly as M2O, O2M, O2O and M2M (junction), plus self/computed relationships and ordered column-pair mappings. The replacement TypeScript planner should mirror those concepts, not the Haskell server architecture line-for-line.

Implementation sequence: richer relationship schema cache -> nested select AST -> relationship resolution/disambiguation -> read-plan tree -> SQL generation/JSON shaping -> upstream-derived tests for to-one, to-many, aliases, `!inner`, ambiguity and M2M.

## Readiness / workstream interaction

DLR's current flat-query surface means embeddings need not block the first integration candidate, but they remain mandatory for trustworthy general Application Preview parity. Integration/runtime relay work can proceed concurrently.

The project is materially advanced; prior batches cover browser-safe errors, range/HEAD, singular media, schema profiles, inserts/upserts, transactions, strict preferences/max-affected, RPC shaping/overloads, PATCH columns/defaults, and preference applicability. These should be re-audited selectively against Haskell rather than rewritten wholesale.

## Current high-risk audit areas

- Upsert inserted-vs-updated 200/201 execution metadata.
- RPC SQL/result-envelope edge semantics, especially volatility and scalar/composite returns.
- HEAD/count aggregate execution fidelity.
- Singular mutation combinations.
- Preference parser token semantics beyond already-verified application rules.
- Type-aware RPC overload resolution.
- SQLSTATE -> HTTP/PostgREST error mapping.
- Detailed response headers/statuses (`Content-Location`, mutation `Content-Range`, profile headers, 200/206 distinctions).
- Query grammar: nested and/or, JSON paths/operators, embedding, `!inner`, disambiguation.

## Test authority rule

Authority order: upstream Haskell PostgREST source/specs/tests -> real Supabase/PostgREST client behavior -> adapter-specific TypeScript regression tests. Do not modify behavior merely to make an inherited dotdo test green.

### Upstream-adjudicated test status

Linux-native Rollup/esbuild packages now allow Vitest to execute locally. The inherited executable suite is **238/238 passing** after resolving every prior failure against canonical Haskell PostgREST behavior, not against the abandoned npm package's expectations. Key locked conclusions: singular success => `application/vnd.pgrst.object+json`; known partial range with exact count => HTTP 206; disabled tx override => no tx Preference-Applied echo. The public exported router now normalizes singular media types while deeper router/planner consolidation continues.


## Current implementation checkpoint

Upstream-related ordering is now part of the replacement read planner, not the abandoned builder: to-one related order, aliases, nested order, null ordering, JSON-path order, `PGRST108`, and `PGRST118` are implemented and generated runtime artifacts synchronized. The current executable hybrid suite is 250/250 green. Next required embedding work is relationship existence filtering (`embed=is.null` / `embed=not.is.null`), followed by cross-embed logical filters and other advanced upstream read-plan cases.


## Embed existence checkpoint

Selected relationship null/existence filtering is now upstream-derived and implemented: `embed=is.null` / `embed=not.is.null` works across to-one, to-many, M2M, aliases, nested embeds and exact-count queries without hijacking ordinary same-name column filters. Current executable suite is 256/256 green. The next read-plan parity target is logical expressions combining embed-existence predicates across sibling embeds and richer embedded logical-tree behavior.


## Cross-embed logic checkpoint

The replacement planner now supports upstream sibling-embed logical existence composition such as `or=(clientinfo.not.is.null,contact.not.is.null)` while keeping child field filters scoped to each embedded lateral query. The read-plan uses an explicit `ReadLogicTerm` AST and exact-count queries retain the same logical tree. Current executable suite is 259/259 green. Full nested/negated PostgREST logical grammar is still explicitly unclaimed pending parser audit.


## Thread-transfer readiness checkpoint — 2026-09-04

A full takeover handoff is now maintained in `HANDOFF.md`, with a copy/paste bootstrap prompt in `NEXT-THREAD-PROMPT.md`. Important: the authoritative DiagramCraft tree is ahead of some visible chat context. Resume from the current **259/259** checkpoint; related ordering, embed existence (`is.null` / `not.is.null`), and sibling cross-embed existence logic are already implemented. The next planner target is broader nested/negated PostgREST logical-query grammar, derived directly from upstream Haskell. Do not redo completed embedding batches merely because an old conversation ended earlier in the sequence.
