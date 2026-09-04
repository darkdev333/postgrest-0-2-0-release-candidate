# Copy/paste takeover prompt

You are taking over the browser-side PostgREST compatibility implementation for DiagramCraft.

You have DiagramCraft MCP access and GitHub access.

Workspace: Diagram Craft Dev
Workspace ID: 9e8662f1-f269-42a8-ba22-921f45d513ad

Diagram: diagramcraft.preview Apps
Diagram ID: 91a98980-4df3-4609-86b8-84b4da1bb620

Project root:
PostgREST Compatibility Comparison/postgrest-0.1.1

Package root:
PostgREST Compatibility Comparison/postgrest-0.1.1/package

Start by reading DiagramCraft's canonical get_spec_diagram_import specification. Then read, in order:

1. package/HANDOFF.md
2. package/EXTERNALIZED-CONTEXT.md
3. package/PARITY.md
4. package/gptB-implementation-log.md

DiagramCraft is the authoritative working tree. Do NOT reconstruct current state from an old ChatGPT transcript, and do NOT restart from the abandoned npm package snapshot.

The canonical behavioral authority is the upstream Haskell PostgREST project and its test/spec tree. The abandoned @dotdo/postgrest@0.1.1 implementation is only a browser-compatible starting substrate. When an inherited TypeScript test conflicts with upstream Haskell behavior, upstream wins.

Architectural decision: keep the Hono/Web Request/Response + SQLExecutor + PGlite/Worker-compatible shell. Replace weak internals in place. Do not rewrite from scratch.

Current authoritative implementation checkpoint is recorded as 259/259 executable tests passing. Already implemented in the replacement read planner: relationship graph/cache, composite FKs, M2O/O2M/O2O/M2M, nested select AST, aliases/hints, !inner, lateral object/array shaping, M2M joins, embedded filter/order/range paths, PGRST108/200/201, related ordering with PGRST118 for to-many, embed is.null/not.is.null existence semantics, and sibling cross-embed existence logical composition such as or=(clientinfo.not.is.null,contact.not.is.null). Do not redo those batches.

The next read-planner parity target is broader nested/negated PostgREST logical query grammar. Audit and implement it directly from upstream Haskell ApiRequest/QueryParams, Plan, Plan.Types, Query/QueryBuilder, Query/SqlFragment and their Feature/Query specs. Cover nested and/or, negation, embedded-path logical terms, combinations of field predicates and embed-existence predicates, JSON-path fields inside logic, alias/path errors, and SQL parameterization. Work in small coherent batches with upstream-derived tests.

Important router architecture: src/router.ts is the mature flat CRUD/RPC implementation; src/compat-router.ts intercepts embedded GET/HEAD and uses the new planner; src/public-router.ts is the public export boundary. Preserve this staged migration unless upstream-driven work justifies consolidation.

Testing environment note: the user's uploaded node_modules originated on Windows. Linux x64/glibc test execution required @rollup/rollup-linux-x64-gnu@4.63.1 and @esbuild/linux-x64@0.21.5. The prior thread got Vitest running and adjudicated inherited failures against upstream before reaching the current 259/259 gate.

Persistence rules: DiagramCraft is authoritative. Checkpoint coherent batches regularly. Keep HANDOFF.md, EXTERNALIZED-CONTEXT.md, PARITY.md and gptB-implementation-log.md current. For project-tree upserts use children_mode:"merge". Never replace the whole project root for file updates. If postgrest-0.1.1 itself is ever upserted, preserve is_project_root:true — this was previously lost by an assistant and manually repaired by the user.

Do not stop after giving a plan once you understand the project. Continue implementation and persist completed batches.