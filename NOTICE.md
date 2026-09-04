# Notices and provenance

This project is an independent PostgREST compatibility implementation maintained as `postgrest-0.2.0`.

## Historical TypeScript substrate

Portions of this repository are derived from the published npm package `@dotdo/postgrest@0.1.1`, which was distributed under the MIT license and identified `dot.do` as its author in package metadata.

The `@dotdo/postgrest@0.1.1` package distribution used as the historical substrate did not contain a standalone `LICENSE` file or a more specific copyright notice. This repository therefore preserves the provenance and the original package's MIT license designation here rather than inventing an unverified copyright attribution.

Original package information:

- Package: `@dotdo/postgrest@0.1.1`
- Historical repository metadata: `https://github.com/dot-do/postgres`
- License metadata: MIT
- Historical author metadata: `dot.do`

Beginning with the `0.2.x` line, substantial compatibility and architectural work has been developed independently for this repository. New contributions are licensed under the repository's MIT `LICENSE`.

## Compatibility references

The upstream Haskell PostgREST project (`https://github.com/PostgREST/postgrest`) is used as the behavioral compatibility authority. Its source and tests are consulted to reproduce public protocol behavior; PostgREST source code is not copied into this TypeScript implementation unless separately identified and licensed.

PostgREST, Supabase, dot.do, PGlite, DiagramCraft, and SCI-ENCE are names of their respective projects or organizations. This repository is not an official project of PostgREST, Supabase, or dot.do.
