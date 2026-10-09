# Working on the baseten fork

This repository is a fork of [pixijs/pixi-react](https://github.com/pixijs/pixi-react).
Keep upstream attribution and the MIT license when moving code or documentation.

## Setup and verification

This is a pnpm workspace orchestrated by Turborepo:

- `packages/react` is the published `@pixi/react` library.
- `apps/docs` is the private Docusaurus site. It depends on the local library
  through `workspace:*`.
- `packages/conformance` is the private renderer conformance suite: scenarios,
  a fake Pixi backend and a runner. See its README.
- `apps/examples` is the private example app: the deterministic docs examples,
  one route each, built against the local packages. The docs embed the same
  files, and its routes are the browser-test fixtures. See its README.
- The root `package.json` is private. It holds only workspace tooling.

Use the Node version in `.nvmrc` and the pnpm version in the root
`packageManager` field. `corepack enable` selects that pnpm automatically.
Install with `pnpm install --frozen-lockfile`. `pnpm-lock.yaml` is the only
lockfile; do not add a `package-lock.json` or `yarn.lock`.

The root scripts run Turbo tasks, which build workspace dependencies first:

| Command | Turbo task | Notes |
| --- | --- | --- |
| `pnpm build` | `build` (every package except docs) | `@pixi/react`: Rollup ESM/CJS output plus declarations. `core`/`renderer`/`pixi-8`: one CJS implementation plus an ESM wrapper (D6, see `packages/core/README.md`; `pixi-8` binds each entry to its own pixi.js instance, see `packages/pixi-8/README.md`) |
| `pnpm test:types` | `typecheck` | Excludes the docs app (see below) |
| `pnpm test:lint` | `lint` | Library and docs, shared root `eslint.config.mjs` |
| `pnpm test:unit` | `test:unit` | jsdom/Node unit tests; for `core`/`renderer`/`pixi-8` also the D6 entry test and the built dependency-graph check |
| `pnpm test:e2e` | `test:e2e` | Vitest browser mode with Playwright Chromium, including the conformance suite, and the example app's build, bundle check and route smoke test; never cached |
| `pnpm test:conformance` | `test:conformance` | The conformance suite alone: against the baseline facade and the Pixi 8 adapter (pixi.js 8.2.6 and 8.22.0) in Chromium, and against core + renderer in jsdom; never cached |
| `pnpm build:docs` | `build` (`docs`) | Builds the library, then the Docusaurus site |
| `pnpm test:contract` | design-contract package | Type-level adapter contract under NodeNext and Bundler resolution |
| `pnpm test:release` | none (Node script) | Offline: the release tooling tests and the release-policy check on the pending Changesets plan. `pnpm release:dry-run` runs the whole release in a disposable checkout and publishes nothing. See `design/release.md` |
| `pnpm test:compatibility` | none (Node script) | The required PR-tier compatibility check, locally: audit probes, packed-adapter cells in isolated projects, and the deliberately incompatible pairs. Run `pnpm build` first. See `design/compatibility/cells/README.md` |

Browser tests need Chromium:
`pnpm --filter @pixi/react exec playwright install chromium`. Outside CI, set
`CI=true` to run them headless. The local docs server is `pnpm start:docs`.

Use `pnpm --filter <package> <script>` for package-specific work, for example
`pnpm --filter @pixi/react test:watch`. Declare every dependency in the manifest
of the package that imports it. Packages depend on each other through
`workspace:` manifest entries, not tsconfig `paths`. `design/**` is excluded
from ESLint because its audit probes import packages that are not installed.

The docs `typecheck` script (`pnpm --filter docs typecheck`) already failed
before the migration: TypeScript 5.7.3 crashes with an internal "Debug Failure".
It is not part of `pnpm test:types` or CI.
Package documentation belongs in its package README; avoid shared README churn.

## Agent workflow

Both `AGENTS.md` and `CLAUDE.md` point here as the shared guidance source.
Use the owner's installed skills: `validate-backlog` before a backlog run,
`swarm` for explicitly authorized delegation, `implement-issue-core` for one
issue through implementation and a durable PR, and `create-pr` for exact tracker
linkage and review initiation. `backlog-orchestrator` coordinates a bounded run;
`supervise-prs` owns CI/review monitoring and `repair-pr` handles bounded repairs.
The standalone `implement-issue` composes implementation and supervision.
Read the installed skills and their references; do not replace them with a
repository-local imitation. Use honest attribution for the actual agent runtime.

Use a dedicated branch/worktree per issue, preserve the supplied base, and link
PRs with the full canonical issue URL. Commit and push meaningful checkpoints
before long checks. Report the complete gate results to the calling workflow.
When delegation is active, the parent owns supervision unless explicitly assigned.

There is **no autonomous merge authority** by default. Do not merge, enable
automatic merge, change branch protection, publish packages, or deploy without
explicit owner authorization. A policy change granting authority requires an
owner-authored change in a later run. This document grants no such authority.
Edits to `.github/workflows` and `.github/actions` require explicit owner approval
for the invocation; an implementation assignment does not otherwise grant it.

## Publication is opt-in

Ordinary pushes and PRs retain all seven verification jobs (typecheck, lint, unit, E2E, conformance, contract, docs), without path filters. The separate **Compatibility** workflow adds the aggregate check `Compatibility (required)`; an owner makes it a required status check in branch protection. The **Compatibility nightly** workflow is not a PR check.
By default, neither publishes packages nor deploys docs. PR runs cancel an older
run for the same PR, including an opted-in preview. Manual release and deployment
runs have timeouts and are not cancelled by newer PR runs. Unset publication
variables disable their respective publication paths.

In Actions, manually run **Handle Release Branch Push** with `publish_release`
left false, or **Deploy Docs** with `deploy` left false, to inspect configuration
without publishing. The first prints destinations and permissions; the second
also builds docs. Locally, `node .github/actions/fork-safety/check.cjs review`
provides the same destination report without credentials or network access.
This review never invokes a release tool. Workflow permissions default to
`contents: read`; only the explicitly requested release/deploy jobs receive
`contents: write`. Checkout does not persist a write credential.

Only an owner configuring an intended publication should set these repository
Actions variables:

| Operation | Required configuration | Additional gate |
| --- | --- | --- |
| npm and GitHub release | `FORK_RELEASE_ENABLED=true`; `FORK_PACKAGE_NAME` exactly matches the renamed `packages/react/package.json` name and is outside `@pixi/`; `NPM_TOKEN` secret authorized for that package | Manual `publish_release=true` on `main`, `alpha`, or `beta`; verification must pass |
| Package preview | `FORK_PREVIEW_ENABLED=true`; the same `FORK_PACKAGE_NAME` check | PR from a branch within `baseten/pixi-react` targeting `main`; verification must pass |
| Docs | `FORK_DOCS_ENABLED=true`; `FORK_DOCS_REPOSITORY=baseten/pixi-react` | Manual `deploy=true` on `main`; docs build must pass |

Release and preview remain blocked while `packages/react/package.json` is named
`@pixi/react`, even if their enablement variable is set. The guards read that
manifest; the private workspace root is never published. semantic-release
publishes from `packages/react` (`pkgRoot`), and previews publish
`./packages/react` with `pkg.pr.new`. This is still the inherited
single-package flow. The multi-package release policy (independent Changesets
versions, public names from `release.packages.json`, staged and verified
tarballs) is in [design/release.md](design/release.md) (issue 15). It publishes
nothing: `publish.enabled` in `release.packages.json` is false, the modular
packages stay private, and the facade's `prepublishOnly` guard fails every
`npm publish` of it, including the semantic-release path above, until an owner
enables publishing there. Previews require the `pkg.pr.new` app to be configured for this fork.
Release uses `https://registry.npmjs.org` and GitHub releases in
`baseten/pixi-react`. No command in the review path publishes an artifact.

Docs target only `baseten/pixi-react` branch `gh-pages`, with public URL
`https://baseten.github.io/pixi-react/`. The upstream custom domain is not used.
An owner must configure GitHub Pages to serve that branch before enabling docs.
For another destination, make an owner-reviewed code change; no arbitrary remote
or upstream npm scope is accepted through configuration.

If a destination check fails, leave publication disabled and correct the manifest
or configuration through review. Re-run the read-only review, then explicitly
request a new publication only after its destination and authority are settled.
Never work around the guards by adding upstream credentials.
