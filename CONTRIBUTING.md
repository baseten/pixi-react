# Working on the baseten fork

This repository is a fork of [pixijs/pixi-react](https://github.com/pixijs/pixi-react).
Keep upstream attribution and the MIT license when moving code or documentation.

## Setup and verification

Use the Node version selected by `.github/actions/setup/action.yml`. Until the
workspace migration lands, install with `npm ci --ignore-scripts` and use
`npm run test:types`, `npm run test:lint`, `npm run test:unit`,
`npm run test:e2e`, and `npm run build:docs`. Browser tests require
`npx playwright install chromium`; the local docs server is `npm run start:docs`.

After the pnpm workspace migration, use the committed `packageManager` version,
`pnpm install --frozen-lockfile`, and the root pnpm scripts documented by that
migration. Use `pnpm --filter <package> <script>` for package-specific work.
Do not create a second lockfile or assume the migration has already happened.
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

Ordinary pushes and PRs retain all five verification jobs, without path filters.
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
| npm and GitHub release | `FORK_RELEASE_ENABLED=true`; `FORK_PACKAGE_NAME` exactly matches the renamed root package and is outside `@pixi/`; `NPM_TOKEN` secret authorized for that package | Manual `publish_release=true` on `main`, `alpha`, or `beta`; verification must pass |
| Package preview | `FORK_PREVIEW_ENABLED=true`; the same `FORK_PACKAGE_NAME` check | PR from a branch within `baseten/pixi-react` targeting `main`; verification must pass |
| Docs | `FORK_DOCS_ENABLED=true`; `FORK_DOCS_REPOSITORY=baseten/pixi-react` | Manual `deploy=true` on `main`; docs build must pass |

Release and preview remain blocked while the root manifest is `@pixi/react`,
even if their enablement variable is set. The workspace migration must define
its own package publication policy before enabling releases for a package split;
the inherited single-package release flow is not a workspace release strategy.
Previews use `pkg.pr.new` and require its app to be configured for this fork.
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
