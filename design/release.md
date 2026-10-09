# Release policy, packaging and installation (issues 15 and 40)

This page defines how the facade and the modular packages are versioned, packed and installed. It covers the release
plan for Release 1, the checks that run before any release, and how consumers install each package. **Nothing is
published.** Publishing stays disabled until the owner configures a destination (see
[Enabling publication](#enabling-publication)).

Owner rulings of 2026-10-09 applied here:

- the public names use upstream's `@pixi` scope, pending agreement with the pixijs maintainers
  ([issue 41](https://github.com/baseten/pixi-react/issues/41)), so the scope must stay switchable;
- in Release 1 the facade is `8.1.0`;
- the conformance kit stays private (issue 20 publishes it later), and Pixi 7 is deferred.

Owner rulings for [issue 40](https://github.com/baseten/pixi-react/issues/40) (2026-10-09), applied here:

- Release 1 is the facade `@pixi/react` 8.1.0 plus the modular packages at 1.0.0. The facade keeps D1: its React peer
  is `^19.3.0`, with a runtime warning on another React 19 minor ([migration guide](../apps/docs/docs/migrating-to-8.1.mdx),
  [release notes](release-1-notes.md)).
- The facade's major tracks the Pixi major; its minor and patch versions are independent. The modular packages use
  plain semver. Peer ranges are widened only with matrix evidence.
- Dependency-update automation (Renovate or Dependabot) is deferred until there is agreement to move to the upstream
  repository (issue 41). New React and Pixi versions follow the [manual flow](#adding-a-react-or-pixi-version-the-manual-flow).
- Release 1 calls its versions **tested**, not certified ([below](#what-tested-means)).
- Bundle size ([#58](https://github.com/baseten/pixi-react/issues/58)) does not block Release 1; the release notes
  state it.

## Packages and public names

| Workspace | Workspace name | Public name (target) | Release 1 |
| --- | --- | --- | --- |
| `packages/react` | `@pixi/react` | `@pixi/react` (the facade) | 8.1.0 |
| `packages/core` | `@pixi-react-provisional/core` | `@pixi/react-core` | 1.0.0 |
| `packages/renderer` | `@pixi-react-provisional/renderer` | `@pixi/react-renderer` | 1.0.0 |
| `packages/react-19.0` … `react-19.3` | `@pixi-react-provisional/react-19.x` | `@pixi/react-19.0` … `@pixi/react-19.3` | 1.0.0 |
| `packages/react-18` | `@pixi-react-provisional/react-18` | `@pixi/react-18` | 1.0.0 |
| `packages/pixi-8` | `@pixi-react-provisional/pixi-8` | `@pixi/react-pixi-8` | 1.0.0 |

These packages are never published: `react-shared` (bundled into each React adapter at build time), `conformance`,
`type-consumers`, `design/contract`, every `*-fixture-*` package and `apps/docs`. Each of them is `"private": true`, and
Changesets ignores exactly this set.

### One source of truth: `release.packages.json`

[`release.packages.json`](../release.packages.json) maps each publishable workspace directory to its public name. It
also holds the selected namespace, the Release 1 versions, the never-published set, the publish switch and the
released ABI. Every release script reads it through `scripts/release/config.mjs`; nothing else maps a workspace name to
a public one.

- `namespace: "target"` resolves to the ruling above: the facade is `@pixi/react` and each module is `@pixi/react-<suffix>`.
- `namespace: "fallback"` is a placeholder for a fork-owned scope (`@baseten/pixi-react`, `@baseten/pixi-react-<suffix>`),
  to be used if issue 41 does not grant `@pixi`. The owner has not chosen this name.
  `PIXI_REACT_RELEASE_NAMESPACE=fallback` (or `--namespace fallback`) selects it for one run without editing the file.

### Why the workspace keeps its provisional names (option b)

The workspace keeps the `@pixi-react-provisional/*` names, and `scripts/release/stage.mjs` writes the public names
into the release tarballs. The alternative, (a), would rename the workspace packages now. Option (b) is less likely
to cause errors:

- **It changes one file, not about 190.** The provisional names appear in about 190 files: the #13 compatibility
  manifest (`design/compatibility/seed.json`), the cell harness, `type-consumers`, the conformance suite, the
  dependency-graph checks, tests, fixtures and design records. A rename would touch all of them. It would also conflict
  with work running in parallel, and it would have to be repeated if issue 41 ends with the fallback scope. With (b),
  the #13 matrix, `type-consumers` and `check-dependency-graph.mjs` keep working unchanged, and switching the scope is
  a one-word change.
- **The rewrite is narrow, and it is verified.** It replaces only whole package names: `@…/react-19` never matches
  inside `@…/react-19.3`, and fixture names never match. Longer names are tried first. It also handles the three
  non-name tokens listed in `textRewrites`. Staging fails if `@pixi-react-provisional` remains anywhere in a tarball
  (code, declarations, source maps, README or manifest). The renamed tarballs are then inspected and installed in
  clean consumers (below).
- **The cost.** The compatibility cells and `type-consumers` test tarballs with provisional names. The two sets of
  tarballs differ only in the rewritten names and the release manifest fields: stage.mjs drops `scripts` and
  `devDependencies` and sets `private` and `publishConfig`. Nothing else changes. The release consumers repeat the install, load, declaration, type and composition checks on the
  renamed tarballs, but not the browser conformance suite.

The rewrite also renames the names that the shipped code prints in messages. For example, React 18's
`UNSUPPORTED_TUPLE` error names `@pixi/react-19.1`, and each adapter's `certification` names its own public package.
Consumers therefore see the names they install.

## Version policy

Versions are independent: each package has its own version and changelog, and Changesets has no `fixed` or `linked`
groups.

### The facade's major tracks the Pixi major

- `@pixi/react` 8.x is for Pixi 8; a future 9.x is for Pixi 9. The facade's minor and patch versions are independent of
  Pixi's: the tested React and Pixi versions are carried by the peer ranges and the
  [compatibility table](release-compatibility.md), never by the version number. `policy.mjs` fails if the facade would
  release a major other than the Pixi major its `pixi.js` peer names.
- Breaking facade changes (the deferred D4 corrections, for example) are batched into the next Pixi major, behind an
  opt-in where practical. A facade-only major with a migration guide is the escape hatch, for rare cases only.
- Adding a React major (a new adapter and a wider peer range) is a facade minor. Dropping a React major is breaking, so
  it waits for the next Pixi major.
- Widening a peer range to a newly tested React or Pixi minor is a facade minor. A fix inside a tested minor is a
  patch. A patch regression in a dependency is handled with a facade patch release or by excluding that version from
  the range, as 8.5.0 is.

### The facade continues upstream's line

The facade's workspace version is upstream's last release, `8.0.5`. Release 1 is a minor changeset, which makes it
`8.1.0`. The facade follows semver for upstream's public API (D4): a behaviour change that a working upstream program
can observe is held for the documented future major. The facade has no runtime dependency on any modular package: it
bundles their code. Its own versions are therefore independent of theirs.

### The modular packages start at 1.0.0: core's major is the ABI major

Adapters and core negotiate through the adapter ABI (`CORE_ABI = { major: 1, minor: 0 }` in
`packages/core/src/abi.ts`, and each adapter manifest's `abi`). The rule is that **core's major version equals the ABI
major**. Release 1 is ABI 1, so core is `1.0.0`. The other modular packages also start at `1.0.0`, so the first
generation reads as one. After Release 1, each adapter versions on its own.

`1.0.0` is chosen over `0.1.0` because npm's caret ranges handle `0.x` differently. `^0.1.0` means `<0.2.0`, so under
`0.x` every minor would act as a major, and the ABI major would be encoded in core's minor. Then `^0.1.0` could not
express "any ABI 1 core". With `1.0.0`, `^1.0.0` means exactly that, and an ABI major is an npm major. A version number
is not a certificate: support is still exactly the tested peers (D5) and the #13 matrix, and `1.0.0` adds no claim
beyond that.

### Dependency ranges

| Dependency | In the workspace | Published as | Why |
| --- | --- | --- | --- |
| A modular package on core | `workspace:^` | `^<core version at release>` | Any core of the same ABI major satisfies it, so npm installs **one** core for every adapter. Core identity matters: one registry, one `CompatibilityError` class. The floor is the core the adapter was built and tested against, so it already implements every ABI minor the adapter needs |
| A React adapter on `react-reconciler`, `its-fine` | exact | exact | Each reconciler is pinned in the adapter that owns it (D2 reversed). The policy check rejects a reconciler anywhere except the React adapters and the facade |
| `react`, `react-dom`, `pixi.js` | peer | peer | Never a dependency of any published package. The React adapters' peers list exact tested versions (D5). The facade's React peer is `^19.3.0` (D1 as amended by issue 49) |
| The facade on modular packages | devDependencies | none | The facade bundles our adapter code. Non-default adapters are never facade dependencies |

### When an ABI changes

`scripts/release/policy.mjs` enforces these rules on the pending Changesets plan:

| Change | Required release | Enforced by |
| --- | --- | --- |
| A new ABI method or capability that adapters may require (`CORE_ABI.minor` +1) | At least a **minor** core release. An adapter that starts to require it is released with the new core as its floor (`workspace:^` writes it) | `CORE_ABI minor rose … core needs at least a minor changeset` |
| An incompatible ABI change (`CORE_ABI.major` +1) | A **major** core release, so core's major again equals the ABI major. Every published package that depends on core (renderer, every React adapter, pixi-8) also needs **its own explicit major changeset**, so that no adapter keeps a range on the old ABI. Changesets alone would only patch-bump dependents | `core will be X, but its major must equal the ABI major` and `… depends on core and needs its own major changeset` |
| An adapter's manifest ABI major differs from core's | Not allowed | `declares ABI major …, core implements …` |
| Removing an ABI method within a major (`CORE_ABI.minor` −1) | Not allowed; it is an ABI major change | `CORE_ABI minor fell …` |

`abi.released` in `release.packages.json` records the ABI of the last release. `pnpm release:version` sets it, so
the next run can tell whether the ABI moved.

### Peer ranges move only with matrix evidence

The facade's peers are not edited by hand: `policy.mjs` (through `scripts/release/compat.mjs`) requires that

| Rule | Checked against |
| --- | --- |
| The facade's `pixi.js` peer equals the Pixi adapter's `declaredPeers["pixi.js"]` in the compatibility manifest | `design/compatibility/seed.json` (`adapterMatrix.pixiAdapters.pixi8`) |
| That declared range is exactly the one the manifest's evidence supports: from `pixiEpochs.pixi8.minimum` to below the minor after `current`, minus `excludedVersions` | the same manifest; a newer `current` needs audited probe tuples and cells (`validate.mjs`) |
| The facade's `react` peer is `^<newest tested React>` of the React epoch it builds in, and that epoch is the manifest's newest (D1) | `adapterMatrix.reactAdapters.<epoch>.declaredPeers.react`, `reactEpochs` |
| The facade's runtime warning (`TESTED_REACT` in `packages/react/src/runtime/reactVersion.ts`) names exactly those tested versions | the same row |
| The facade's `react-reconciler` and `its-fine` equal those of the adapter package it builds in | `packages/react-19.3/package.json` |
| The facade's major equals the Pixi major of its `pixi.js` peer | the pending plan |

Each React adapter's packed `peerDependencies` must equal its manifest row's `declaredPeers`, which every compatibility
cell already checks (`tree` command). So a peer can only widen after the manifest does, and the manifest only widens
with audited tuples and passing cells.

### What "tested" means

Release 1 calls the versions it supports **tested**, not **certified**:

- **Tested:** the exact React and pixi.js versions that the #13 compatibility cells run. The PR tier (the required
  check **Compatibility (required)**) runs each React adapter at its newest audited patch (React 18.3.1, 19.0.8, 19.1.9,
  19.2.8 and 19.3.0) with pixi.js 8.2.6 and 8.22.0, plus probes at every named Pixi 8 boundary, on every pull request
  and every push to `main`. The nightly tier covers the newest audited patch of every Pixi 8 minor.
- **Certified:** a range promoted into `advertisedRanges` in `design/compatibility/seed.json`. That list is empty, and
  `validate.mjs` asserts it stays empty.

Why Release 1 does not promote the PR-tier cells (issue 40, option 2 of the #55 review item):

1. The promotion rules in [compatibility.md](compatibility.md#certification-policy) need more than the PR tier
   provides: a certificate covers an advertised *interval*, so pixi.js `>=8.2.6 <8.23.0` needs the nightly cells over
   every minor in it. The nightly workflow was added on 2026-10-09 and has not run yet (it runs at 02:37 UTC, or by
   `workflow_dispatch`). The rules also ask for individually validated render backends (WebGL and WebGPU) and an
   integrity-recorded certificate record, which the cells do not produce yet.
2. The seed is the #3 audit record (`status: audit-seed-not-support-certificate`), which D7 keeps as-is, and promotion
   needs the owner's review.

The PR-tier cells did run green on every merge to `main` since #52 (for example run 37967937172 at `10d704e`), so
"tested" is accurate. Every user-facing surface says "tested": the facade's runtime warning, the facade README, the
getting-started page, the adapter READMEs, the adapters' manifest `certification` strings and the
[compatibility table](release-compatibility.md).

To certify later: let the nightly tier pass over the range, record the certificate as `compatibility.md` describes,
add the range to `advertisedRanges` (and relax the `validate.mjs` assertion with a schema for the entry), then change
"tested" to "certified" on the surfaces above in the same pull request.

### Other changes

| Change | Bump |
| --- | --- |
| A React adapter tests an additional React patch (peer gains an exact version) | minor |
| The Pixi adapter's peer range gains tested Pixi versions | minor |
| A peer version is dropped, or the reconciler or its-fine changes in a way consumers can observe | major. A reconciler bump is an adapter release that needs its matrix again (D2) |
| A failure-path repair or an internal fix | patch |
| A new export, option or capability | minor |

## Release procedure

Nothing below publishes. Publishing needs the [owner approvals](#before-publishing-owner-approvals) first.

1. **Describe each change.** In every pull request with a consumer-visible change, run `pnpm changeset` and choose the
   bump per the tables above. Never-published packages are ignored.
2. **Check the policy.** `pnpm test:release` runs the release tooling tests and `pnpm release:policy`: classification,
   manifests, ABI, Release 1 versions, the [peer rules](#peer-ranges-move-only-with-matrix-evidence), and whether the
   generated [compatibility table](release-compatibility.md) and [docs pins](#docs-versions-and-pins) are current.
3. **Dry run.** `pnpm release:dry-run` versions, builds, stages and verifies everything in a disposable copy; this
   checkout is never modified (steps below). Read `dry-run.md` and `bundles.json` in its output.
4. **Version.** On a release branch, `pnpm release:version` (never `changeset version` alone), then `pnpm install` if a
   lockfile entry moved, and commit the result as "Version packages": versions, CHANGELOGs, version constants,
   `abi.released`, the regenerated compatibility table and docs pins. `pnpm test:release` must pass on that commit.
5. **Stage.** `pnpm build && pnpm release:stage --out .release/tarballs`, then `inspect.mjs`, `consumers.mjs` and
   `bundles.mjs` on those tarballs (or take the tarballs of a passing dry run of the same commit).
6. **Publish (not enabled).** After the owner approvals, a reviewed release workflow publishes the staged tarballs of a
   passing dry run, never a fresh build ([Enabling publication](#enabling-publication)).
7. **Release notes.** Draft from the CHANGELOGs and the compatibility table; Release 1's draft is
   [release-1-notes.md](release-1-notes.md).

`pnpm release:dry-run` (`scripts/release/dry-run.mjs`) runs these steps:

1. It copies the working tree to a temporary directory, makes the copy a one-commit git repository, and runs
   `pnpm install --frozen-lockfile`.
2. `changeset status --output`: the release plan.
3. `pnpm release:version` (`scripts/release/version.mjs`) runs the policy check, then `changeset version`. It then
   copies each new version into the source constant that the adapter manifests report (`packageVersion`), which
   `changeset version` cannot see; each package's unit test keeps the two equal. It records the released ABI, and
   regenerates the [compatibility table](release-compatibility.md) and the [docs pins](#docs-versions-and-pins) for the
   new versions. Always use this command; never run `changeset version` alone.
4. It checks that every package reached its planned version, that the changesets were consumed and that each package
   has a CHANGELOG. It then commits the result as "Version packages" and runs the policy check again.
5. `pnpm build`, then `pnpm release:stage` (`scripts/release/stage.mjs`), which writes the tarballs with public names
   and `release-manifest.json` (name, version, sha512, dependencies) to the output directory.
6. `scripts/release/inspect.mjs`: tarball inspection, [below](#what-is-checked-before-a-release).
7. `scripts/release/consumers.mjs`: packed consumers.
8. `scripts/release/bundles.mjs`: bundle assertions.

The output (tarballs, `dry-run.json`, `dry-run.md`, `consumers.json`, `bundles.json`) goes to
`<os tmpdir>/pixi-react-release-dry-run/tarballs`, or to the directory given with `--work`.
The work directory is deleted and recreated on each run, so `--work` refuses the source checkout, any directory
inside or above it, and a non-empty directory without the `.pixi-react-release-output` marker an earlier run left.
The same guard covers `release:stage --out` (which may also be a new or marked directory under `.release/`) and
each consumer project directory.

### The dry run in CI (needs owner approval)

The dry run is not in CI yet: workflows under `.github/` need the owner's approval, so issue 40 proposes this job
instead of adding it. It runs on pull requests that touch the release inputs, on `main` and by hand; it publishes
nothing, has read-only permissions and no secrets, and keeps the dry run's report as an artifact. It is ready to apply
as `.github/workflows/release-dry-run.yml`:

```yaml
name: Release dry run

# The release dry run of design/release.md (issue 40): version, build, stage, inspect, packed consumers and bundle
# assertions in a disposable copy. It never publishes: no secrets, read-only token.

on:
  pull_request:
    paths:
      - '.changeset/**'
      - 'release.packages.json'
      - 'scripts/release/**'
      - 'design/compatibility/seed.json'
      - 'packages/**'
      - 'apps/docs/**'
      - 'pnpm-lock.yaml'
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  TURBO_TELEMETRY_DISABLED: 1

jobs:
  dry-run:
    name: Release dry run
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          # `changeset status` (the policy check's release plan) compares against main.
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - name: Release tooling tests and policy
        run: pnpm test:release
      - name: Dry run (version, build, stage, inspect, consumers, bundles)
        run: node scripts/release/dry-run.mjs --work "$RUNNER_TEMP/release-dry-run"
      - name: Keep the report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: release-dry-run
          path: |
            ${{ runner.temp }}/release-dry-run/tarballs/*.json
            ${{ runner.temp }}/release-dry-run/tarballs/*.md
          if-no-files-found: warn
          retention-days: 14
```

The full dry run took about 4 minutes locally with warm caches (13 consumer projects, 7 bundle fixtures); the
45-minute timeout leaves room for cold npm caches.

### What is checked before a release

**Tarballs** (`inspect.mjs`, no install):

- names and versions follow `release.packages.json`;
- no `workspace:` range, no provisional name, no never-published package;
- a dependency on another package of ours is `^<its staged version>`;
- peers never appear as dependencies, and reconcilers are exact and only in their owning adapter;
- the facade depends on no modular package;
- every `exports` subpath resolves for both `import` and `require` to a JS file and a declaration file that exist;
- every bare specifier in the shipped JS and declarations is declared (as a dependency, a peer, a `@types/` peer, a
  mapped `#import` or a Node built-in);
- no install lifecycle script, `bin` or `binding.gyp`, so installing runs nothing.

**Packed consumers** (`consumers.mjs`): each scenario is a clean npm project outside the repository. It installs only
the staged tarballs and exact registry versions, with `npm install --ignore-scripts --strict-peer-deps`. No consumer
postinstall, build step, filesystem discovery or adapter guessing is needed.

| Scenario | Installs | Must hold |
| --- | --- | --- |
| `facade` | `@pixi/react`, React 19.3.0, pixi.js 8.22.0 | No modular package in the tree. One react-reconciler (0.34.0). `extend` works through `import` and `require`. Declarations are the same under both and match the runtime exports. `tsc` NodeNext `.mts` and `.cts` |
| `explicit-<cell>` (10: each PR-tier cell of the #13 matrix) | core, renderer, that cell's React adapter, pixi-8, with the cell's exact React, types and pixi.js | `npm ls` is clean. Exactly one version of each of our packages. Only that epoch's reconciler and its-fine. No facade and no other adapter. React 18 consumers get no React 19 package. Both formats compose with `createRenderer` and register `Container` and `Sprite`. Manifests report the package's own version and ABI. Declarations hold for each entry, including the `jsx` subpaths |
| `renderer-only` | core, renderer | No React, reconciler, its-fine or pixi.js is installed: the neutral factory is consumable with only the chosen adapters |
| `core-only` | core | Zero transitive dependencies |

The scenarios are generated from `design/compatibility/seed.json` and `release.packages.json`; none is listed by hand.

**Bundles** (`bundles.mjs`): fixed fixtures (`scripts/release/fixtures/bundle/`) are bundled with esbuild 0.21.5 (the
workspace's version) inside those consumer projects:

- **Unused adapter implementations are absent.** Only the chosen packages contribute bytes. Exactly one
  react-reconciler is bundled: the chosen epoch's, at its exact version. No other epoch's reconciler version string
  appears in the output. The facade bundle contains no non-default adapter. The neutral factory bundles only core and
  renderer (29.5 KiB minified, 8.9 KiB gzip).
- **Necessary registration side effects remain.** Each fixture is also bundled for Node and executed. The explicit
  fixture must report `pixiContainer` and `pixiSprite` registered and the expected adapter ids. The facade fixture must
  evaluate and run `extend`.
- **Unused Pixi constructors can be eliminated.** `NineSliceSprite`, which no fixture imports or registers, must be
  absent from the output. A pixi.js-only control fixture shows that the bundler does eliminate it (146 of 633 pixi.js
  modules kept).
- **The Pixi code kept is no more than upstream's.** The facade fixture is also bundled against upstream
  `@pixi/react` 8.0.5 from the registry, in its own clean project with the same React, pixi.js and esbuild. The facade
  and explicit fixtures may keep no more pixi.js modules and no more pixi.js bytes than that baseline. See Pixi
  constructor elimination below.

Bundle sizes come from fixed fixtures and pinned versions. They describe those fixtures only. Tree shaking never
resolves a peer-version conflict: two React or Pixi versions cannot coexist because of it, and nothing here promises
that.

### Pixi constructor elimination

Until issue 57, the Pixi 8 adapter's ESM entry ran `import * as peer from 'pixi.js'; bindPixi(peer)`, and the
facade's `lib/index.mjs` did the same. A namespace object passed to a function keeps every export alive in every
bundler, so no Pixi constructor could be eliminated (633 pixi.js modules, 1125 KiB minified and 330 KiB gzip for the
facade fixture).

Now every entry imports only the adapter's binding exports (`PIXI8_BINDING_EXPORTS`: `Application`, `Container`,
`Filter`, `Graphics`, `ObservablePoint`, `Point`, `TextStyle`, `VERSION`, `extensions`) by name, and the D6 binding is
unchanged otherwise: one CJS implementation, bound per Pixi instance. The adapter reads optional features from
`VERSION`, and it recognizes the built-ins it treats specially (Particle, RenderLayer, Mesh, Sprite, Text, ...) from
the constructors an application registers, by their prototype signatures, instead of importing them
(`packages/pixi-8/src/builtins.ts`). Measured with the facade fixture, esbuild 0.21.5, pixi.js 8.22.0 and production
React:

| Bundle | Minified | Gzip | pixi.js modules kept | pixi.js bytes | `NineSliceSprite` |
| --- | --- | --- | --- | --- | --- |
| Upstream `@pixi/react` 8.0.5 (the bound) | 663.6 KiB | 196.2 KiB | 381 | 501.5 KiB | eliminated |
| This facade (8.1.0 candidate) | 751.7 KiB | 222.9 KiB | 381 | 501.4 KiB | eliminated |
| Explicit React 19.3 + pixi-8 | 738.3 KiB | 217.8 KiB | 381 | 501.4 KiB | eliminated |
| Explicit React 18 + pixi-8 | 693.1 KiB | 205.0 KiB | 381 | 501.3 KiB | eliminated |
| pixi.js alone (`Container`, `Sprite`) | 203.9 KiB | 60.3 KiB | 146 | 189.5 KiB | eliminated |
| Before issue 57: this facade | 1125 KiB | 330 KiB | 633 | 807 KiB | kept |

The Pixi part now matches upstream's: the same 381 pixi.js modules and no more pixi.js bytes. The rest of the facade
bundle is larger than upstream's (+88 KiB minified, +27 KiB gzip). That is not Pixi code: react-reconciler 0.34.0
(React 19.3) is larger than upstream's 0.31.0, and the modular core, renderer and adapters bundled into `@pixi/react`
are larger than upstream's single package and CommonJS (D6), which bundlers do not tree shake. `bundles.mjs` asserts
the Pixi bound only.

### Development and production reconciler builds

Since issue 49 no React adapter bundles a reconciler: each per-minor package ships one small CommonJS file (about
27–30 KiB) that `require`s `react-reconciler` through its `#reconciler` import alias, and react-reconciler's own entry
chooses its production or development build by `NODE_ENV`. A production bundle therefore contains only the
production reconciler, so the dev/prod split proposed for the old `react-19` package (issue 40, comment of
2026-10-09) is not needed. `bundles.mjs` checks this on every dry run: its bundles are built with
`NODE_ENV=production`, and it fails unless exactly one react-reconciler (the chosen epoch's) contributes code, no
other reconciler version string appears, and no `*.development.js` file of react, react-reconciler or scheduler
contributes (`DEVELOPMENT_BUILD`, added by issue 40). Bundling each adapter tarball of the Release 1 dry run with
esbuild confirmed it: with `NODE_ENV=production` only `react-reconciler.production.js` and `scheduler.production.js`
are kept (React 18: the `.production.min.js` files), with `development` only the development files. The facade does the same for `lib/`; its self-contained `dist/` bundles ship
separate development (`pixi-react.js`, `.mjs`) and production (`pixi-react.min.js`, `.min.mjs`) files, as upstream's
did.

## The compatibility table

[release-compatibility.md](release-compatibility.md) is generated by `node scripts/release/compat-table.mjs --write`
from the compatibility manifest and `release.packages.json`: for the facade release, its React and pixi.js peers, the
versions tested on every pull request and nightly, and the adapter versions it builds in; for each modular package, its
version, peers, exact dependencies and PR-tier cells. `pnpm release:version` regenerates it, and `policy.mjs` fails
while it is stale. Earlier releases' tables stay in the history of their "Version packages" commits.

## Adding a React or Pixi version: the manual flow

Dependency-update automation is deferred (owner ruling, 2026-10-09): no Renovate or Dependabot configuration is added
until there is agreement to move to the upstream repository (issue 41). The `repository_dispatch` and `workflow_call`
hooks of `compatibility-nightly.yml` stay in place for whichever bot is chosen later. Until then, a new React or Pixi
release is handled by hand:

1. **Bump the compatibility manifest.** In `design/compatibility/seed.json`, add the audited probe tuple for the new
   version (run the #3 audit runner for it, with its registry entry and integrity), and move `pixiEpochs.pixi8.current`
   (a new Pixi minor) or add the React epoch (below). Run `node design/compatibility/validate.mjs`,
   `node --test design/compatibility/cells/*.test.mjs` and regenerate `COMPATIBILITY.md`.
2. **Run the nightly matrix.** Push the branch and start **Compatibility nightly** with `workflow_dispatch`, with
   `cells` set to the new version (for example `pixi-8.23` or `react-19.4`) and `patches: all`. The PR tier runs
   on the pull request as usual.
3. **Widen the peer range only if the matrix passes.** Then update `declaredPeers` in the manifest and the package
   peers (the Pixi adapter, a React adapter, and the facade), add a minor changeset for each package whose peer widens,
   and regenerate the table and the pins (`node scripts/release/compat-table.mjs --write`,
   `node scripts/release/docs-pins.mjs --write`; if the docs app's `react`, `react-dom` or `pixi.js` moved, edit
   `apps/docs/package.json` and run `pnpm install`). `pnpm test:release` fails until every one of these agrees.

A failing cell is not a reason to widen part of the range: exclude the version instead (as 8.5.0 is), or wait for a
fix.

### Checklist for a new React minor (a new epoch)

A new React minor gets its own adapter package only when it ships a new reconciler (every 19.x minor so far has). The
epoch is tested only when all of these hold:

- [ ] **react-reconciler**: the exact version for the minor, as an exact dependency of the new package; the root
  factory's argument shape tested (from 0.33, argument 10 is `onDefaultTransitionIndicator`).
- [ ] **its-fine**: the bundled context bridge reads React's internal fiber tree, so the exact `its-fine` version must
  be tested with the new reconciler and React, in the same cells, and pinned exactly. A reconciler that passes with an
  untested its-fine does not make the epoch tested.
- [ ] **scheduler**: the version react-reconciler brings is the one React DOM uses, or the difference is understood.
- [ ] **Manifest rows**: a `reactEpochs` row, an `adapterMatrix.reactAdapters` row (`declaredPeers` exact),
  an `artifacts` row and audited probe tuples (lowest and highest patch).
- [ ] **Cells**: the PR tier and the nightly tier pass for the new epoch against pixi.js 8.2.6 … current, including the
  conformance suite in Chromium, and the incompatible-pair cells still fail as expected.
- [ ] **Packaging**: a `release.packages.json` entry, a 1.0.0 (or next) changeset, and the release consumers and
  bundles of a dry run.
- [ ] **The facade (D1)**: moving the facade to the new epoch is a facade minor; `policy.mjs` then requires its React
  peer, `TESTED_REACT`, reconciler and its-fine to follow.

### Checklist for a new Pixi minor

- [ ] Audited probe tuple and boundary review (declaration and capability deltas, `pixiEpochs.capabilityBoundaries`).
- [ ] `pixiEpochs.pixi8.current` moved; the nightly cells pass for every React adapter.
- [ ] `declaredPeers["pixi.js"]` equals the derived range, and the Pixi adapter's and the facade's peers follow
  (`policy.mjs`).

## Docs versions and pins

- **Versioned docs follow facade majors.** The current docs (`apps/docs/docs`) are the 8.x docs. When a new facade
  major starts (9.x with Pixi 9), cut a Docusaurus snapshot of the 8.x docs (`pnpm --filter docs docusaurus
  docs:version 8.x`), add its `label` and `path` to `docusaurus.config.ts`, and freeze its pins (below). Minor and patch
  releases update the current docs only. No snapshot is cut for Release 1: the 7.x snapshot (upstream's v7 docs) is
  the only one, and 8.1 is not a new major.
- **One source file for every example's versions.** `apps/docs/src/release-pins.json` pins the exact `@pixi/react`,
  `react`, `react-dom` and `pixi.js` versions for each docs version. `current` is generated by
  `node scripts/release/docs-pins.mjs --write` from the release: the facade's release version and the newest React
  and pixi.js it is tested with. `frozen` has one entry per snapshot in `apps/docs/versions.json` and never changes
  (7.x: `@pixi/react` 7.1.2, pixi.js 7.4.3, React 18.3.1). A snapshot's examples that need more packages list them
  with `extras` (exact versions in that entry's `extras`).
- **The Sandpack examples** (`apps/docs/src/components/Editor`) take their dependencies from that file only: an
  example chooses a docs version and, if needed, named extras, never a version. The Monaco editor loads the pixi.js
  declarations of the pinned version.
- **Page text follows the pins too.** The generator rewrites `react@…`, `react-dom@…`, `pixi.js@…` and
  `@pixi/react@…` in the current docs pages and the facade README (lines about the modular packages are left alone).
- **The docs app** builds against the workspace facade and pins exact `react`, `react-dom` and `pixi.js` equal to the
  current pins.
- **Checks.** `docs-pins.mjs --check`, run by `policy.mjs`, fails when the pins file or a page is stale, when an
  example sets its own versions, when a pinned package appears without a version or as `latest`, `beta`, `next` or
  `canary` (`npm create pixi.js@latest` is allowed: it is the scaffolder, not a pinned package), or when the docs app's
  versions differ from the pins.
- **Before Release 1 is published** the current pins name `@pixi/react` 8.1.0, which is not on npm yet, so the Sandpack
  examples cannot load it until publication. The docs are not deployed (owner ruling for #18/#19); docs E2E (#19)
  should install the facade from the staged tarball until then.

## Before publishing: owner approvals

Nothing is published until the owner approves each of these, in a reviewed change:

1. **The namespace** ([issue 41](https://github.com/baseten/pixi-react/issues/41)): agreement with the pixijs
   maintainers for the `@pixi` scope, or a decision for a fork-owned scope (`namespace` in `release.packages.json`). The
   docs pages and the migration guide name the target `@pixi/react-*` packages and need editing if the fallback is
   chosen.
2. **The publish switch**: `publish.enabled` and `publish.registry` in `release.packages.json`, removing the modular
   packages' `"private": true`, and reconciling the fork-safety guard (it rejects every `@pixi/` name today)
   ([Enabling publication](#enabling-publication)).
3. **The CI workflows**: the [release dry run job](#the-dry-run-in-ci-needs-owner-approval), then a release workflow
   that publishes the staged tarballs of a passing dry run. Both live under `.github/`.
4. **Tested or certified**: whether Release 1 ships as "tested" ([above](#what-tested-means)) or waits for a promoted
   range.
5. **Bundle size** ([#58](https://github.com/baseten/pixi-react/issues/58)): ruled not to block Release 1; the notes
   state it.

## Enabling publication

Publication is impossible today, for four reasons:

1. `release.packages.json` has `"publish": { "enabled": false, "registry": null }`.
2. The modular packages stay `"private": true` in the workspace. npm refuses to publish a private package even with
   `--ignore-scripts`, and `changeset publish` skips private packages. Staged tarballs keep `"private": true` while
   publishing is disabled.
3. The facade, the only publishable workspace package that is not private, has a `prepublishOnly` guard
   (`scripts/release/guard-publish.mjs`). The guard fails unless publishing is enabled with a registry. npm, pnpm,
   `changeset publish` and semantic-release all run it.
4. No workflow runs `changeset publish`. The inherited single-package flow (`release.config.js`,
   `.github/actions/fork-safety`) remains blocked while the facade is named `@pixi/react` (see CONTRIBUTING.md).

To publish, the owner makes a reviewed change that does the following:

- sets `namespace` (after issue 41) and `publish.enabled`/`publish.registry`;
- removes the modular packages' `"private": true`;
- reconciles the fork-safety guard, which today rejects every `@pixi/` name, with the namespace decision;
- adds a release workflow that publishes the staged tarballs of a passing dry run, never a fresh build.

## Installing

The names below are the target names (pending issue 41). Until publication they install only from staged tarballs.

### Default: the facade

The facade's install and getting-started section lives in the [facade README](../packages/react/README.md#getting-started)
(issue 50). Install `@pixi/react` with `pixi.js` and React 19.3. The facade composes the React 19.3 adapter and the
Pixi 8 adapter, bundled; it installs no modular package. On another React 19 minor it logs one warning and suggests the
explicit route below.

### Explicit composition: choose the adapters

Install the neutral factory, the React adapter for the installed React minor, the Pixi adapter, and the exact React
version the adapter is tested with. Core comes as their dependency. Add it to your own dependencies only if you import it,
for example for `CompatibilityError`.

```sh
# React 19.1, for example; use @pixi/react-19.0, -19.2 or -19.3 with a React version from that package's peer range
npm install @pixi/react-renderer @pixi/react-19.1 @pixi/react-pixi-8 pixi.js react@19.1.9 react-dom@19.1.9
# React 18
npm install @pixi/react-renderer @pixi/react-18 @pixi/react-pixi-8 pixi.js react@18.3.1 react-dom@18.3.1
```

```ts
import { createRenderer } from '@pixi/react-renderer';
import { React19Adapter } from '@pixi/react-19.1'; // or: import { React18Adapter } from '@pixi/react-18'
import { Pixi8Adapter } from '@pixi/react-pixi-8';
import { Container, Sprite } from 'pixi.js';

export const { Application, extend, useApplication, useTick, createRoot, component } =
    createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });

extend({ Container, Sprite });
```

Each React adapter rejects an installed React of another minor with `CompatibilityError` (`UNSUPPORTED_TUPLE`). The
error names the package to install instead. Nothing is selected automatically.

For JSX element types, add one of these to a `.d.ts` file in your program: `import '@pixi/react-pixi-8/jsx/react-19';`
or `import '@pixi/react-pixi-8/jsx/react-18';`. Then declare the catalogue you registered (see the
[pixi-8 README](../packages/pixi-8/README.md)).

### Tested pairs

Each React adapter's peer lists exactly the React versions its fixtures test (D5):

| Package | React peer | Reconciler / its-fine (exact dependencies) |
| --- | --- | --- |
| `@pixi/react-19.0` | `19.0.0 \|\| 19.0.8` | 0.31.0 / 2.1.1 |
| `@pixi/react-19.1` | `19.1.0 \|\| 19.1.9` | 0.32.0 / 2.1.1 |
| `@pixi/react-19.2` | `19.2.0 \|\| 19.2.8` | 0.33.0 / 2.1.1 |
| `@pixi/react-19.3` | `19.3.0` | 0.34.0 / 2.1.1 |
| `@pixi/react-18` | `18.3.1` | 0.29.2 / 1.2.5 |
| `@pixi/react-pixi-8` | pixi.js `>=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0` | — |

[COMPATIBILITY.md](compatibility/cells/COMPATIBILITY.md) lists the pairs CI runs: each React adapter at its newest
patch with pixi.js 8.2.6 and 8.22.0 on every PR, and every Pixi 8 minor nightly. These versions are *tested*; they
stay candidate-not-certified until the owner promotes a range ([What "tested" means](#what-tested-means)). The
generated [release compatibility table](release-compatibility.md) lists them per package and release.

### Custom registration

- `extend({ Name: Ctor })` registers raw constructors under JSX names (`pixiName`), as upstream does. Registration is
  explicit: nothing scans `pixi.js` or the filesystem.
- `component(Ctor, name?)` (modular packages only) returns a typed component for one constructor, without JSX
  augmentation.
- `runtime.registry.register(definition)` is the descriptor route for nodes that need custom attach rules. A
  third-party adapter subclasses `ReactAdapter` or `PixiAdapter` from `@pixi/react-core` and depends on it with
  `^<ABI major>` (see the [architecture](adapter-architecture.md#composition-classes-and-open-extension)).

### Migrating from upstream `@pixi/react`

| You use | Do this |
| --- | --- |
| `@pixi/react` 8.0.x with React 19.3 | Upgrade to 8.1.0. Same API and documented behaviour (D4), with failure-path repairs |
| `@pixi/react` 8.0.x with React 19.0, 19.1 or 19.2 | 8.1.0's React peer is `^19.3.0` (upstream's was `>=19.0.0`). Either upgrade React to 19.3, or stay on your minor with the explicit composition and that minor's package |
| `@pixi/react` with a React 19 minor newer than 19.3 | 8.1.0 installs and logs one warning naming the tested 19.3.0 and how to pin |
| `@pixi/react` 7.x (React 17/18, Pixi 7) | Pixi 7 is not supported yet (deferred). On Pixi 8 with React 18.3.1, use the explicit composition with `@pixi/react-18` |
| `useContextBridge`, `component(Ctor)`, root error props, `Root.status` | Only in the modular packages: compose with `createRenderer` (D4) |

The explicit composition returns the same names (`Application`, `extend`, `useApplication`, `useTick`, `createRoot`,
`applyProps`, `useExtend`), so imports from `'@pixi/react'` can move to a module of yours that exports the
`createRenderer` result. Create it once at module level: each call has its own runtime. The composition has the
modular behaviour, not the facade's upstream-parity shims (D4): `extend` rejects a conflicting name, and `extensions`
and `defaultTextStyle` are reference-counted and restored on unmount (see the facade parity shims in
[compatibility.md](compatibility.md#facade-parity-shims-issue-10)). Review those differences when you move from the
facade to a composition.

## Validation commands

```sh
pnpm test:release                 # tooling unit tests + policy check (peers, generated table and docs pins) on the pending plan
node scripts/release/compat-table.mjs --write   # regenerate design/release-compatibility.md
node scripts/release/docs-pins.mjs --write      # regenerate apps/docs/src/release-pins.json and the pinned page versions
pnpm release:dry-run              # disposable checkout: version plan, build, stage, inspect, consumers, bundles
node scripts/release/stage.mjs --out .release/tarballs && node scripts/release/inspect.mjs --tarballs .release/tarballs
node scripts/release/consumers.mjs --tarballs .release/tarballs [--only facade]
node scripts/release/bundles.mjs --tarballs .release/tarballs     # after consumers.mjs
```

The dry run never publishes and never modifies this checkout. `.release/` is git-ignored.
