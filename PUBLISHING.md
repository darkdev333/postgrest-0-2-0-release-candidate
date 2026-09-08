# npm publishing

This package is published as `@sci-ence/postgrest-compat` through GitHub Actions. No local npm CLI workflow is required.

## Package identity

- npm package: `@sci-ence/postgrest-compat`
- npm scope owner: the `sci-ence` npm user (or organization if converted later)
- package access: public
- source repository: `darkdev333/postgrest-0-2-0-release-candidate`
- workflow: `.github/workflows/publish-npm.yml`

`package.json` carries `publishConfig.access = "public"` and provenance metadata so the publish command itself stays minimal.

## First publication

npm Trusted Publishing can be configured after the package exists on npm. Bootstrap the first release with a short-lived/granular npm automation token:

1. Create an npm token that can publish `@sci-ence/postgrest-compat`.
2. Add it to the GitHub `npm` environment (preferred) or repository secrets as `NPM_TOKEN`.
3. Merge the publishing setup.
4. Ensure `package.json` has the intended version, initially `0.2.0`.
5. Create and publish a GitHub Release whose tag is exactly `v<version>` (for example `v0.2.0`).
6. The workflow installs dependencies, runs tests/typecheck/build, inspects `npm pack --dry-run`, verifies the release tag matches `package.json`, and publishes.

The workflow can also be started manually with `workflow_dispatch` when needed.

## Switch to Trusted Publishing

After the first npm package exists:

1. Open the package settings on npmjs.com.
2. Configure GitHub Actions as a Trusted Publisher for:
   - repository owner: `darkdev333`
   - repository: `postgrest-0-2-0-release-candidate`
   - workflow: `publish-npm.yml`
   - environment: `npm`
3. Delete the `NPM_TOKEN` secret from GitHub.

The workflow grants only `contents: read` and `id-token: write`, which is the permission needed for npm's GitHub OIDC trusted publishing flow.

## Normal releases

For every later release:

1. Merge production-ready compatibility work to `main`.
2. Change the version in `package.json` to a new semver version.
3. Create and publish the matching GitHub Release/tag, e.g. `v0.2.1`.
4. GitHub Actions publishes that exact version to npm.

Published npm versions are immutable, so every release gets a new version.

## DiagramCraft integration

Once DiagramCraft switches from vendored source to the npm package, it should import `@sci-ence/postgrest-compat` through its normal dependency graph. Until then, the existing source-vendoring path can remain in place while the npm release is validated.
