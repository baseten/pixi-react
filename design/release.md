# Release policy, packaging and installation (issues 15, 40 and 62)

This page defines how the facade and the modular packages are versioned, packed and installed. It covers the release
plan for Release 1, the checks that run before any release, and how consumers install each package. **Nothing is
published.** Publishing stays disabled until the owner configures a destination (see
[Enabling publication](#enabling-publication)).

Owner rulings of 2026-10-09 applied here:

- the public names use upstream's `@pixi` scope, pending agreement with the pixijs maintainers
  ([issue 41](https://github.com/baseten/pixi-react/issues/41)), so the scope must stay switchable;
- in Release 1 the facade is `8.1.0`;
- the conformance kit stays private (issue 20 publishes it later), and Pixi 7 is deferred. (Issue 16 has since added
  the Pixi 7 adapter, `pixi-7`, as one more lockstep package; the facade stays on Pixi 8.)

Owner rulings for [issue 40](https://github.com/baseten/pixi-react/issues/40) (2026-10-09), applied here:

- Release 1 is the facade `@pixi/react` 8.1.0 plus the modular packages, also at 8.1.0 (issue 62, below). The facade keeps D1: its React peer
  is `^19.3.0`, with a runtime warning on another React 19 minor ([migration guide](../apps/docs/docs/migrating-to-8.1.mdx),
  [release notes](release-1-notes.md)).
- The facade's major tracks the Pixi major; its minor and patch versions are independent of Pixi's. Peer ranges are
  widened only with matrix evidence.
- Dependency-update automation (Renovate or Dependabot) is deferred until there is agreement to move to the upstream
  repository (issue 41). New React and Pixi versions follow the [manual flow](#adding-a-react-or-pixi-version-the-manual-flow).
- Release 1 calls its versions **tested**; issue 17 (2026-10-10) adds **verified** for the tuples a dated verification
  record backs ([below](#tested-and-verified)). Verification is evidence, not a support guarantee.
- Bundle size ([#58](https://github.com/baseten/pixi-react/issues/58)) does not block Release 1; the release notes
  state it.

Owner rulings for [issue 62](https://github.com/baseten/pixi-react/issues/62) (2026-10-10), applied here. They replace
the independent versions of issue 15:

- **Lockstep versions.** Every published package releases together at the facade's version: the facade, core, the
  renderer, `react-19.0` … `react-19.3`, `react-18.0` … `react-18.3`, `pixi-8` and `pixi-7`. Release 1 is 8.1.0 for all of them,
  `pixi-7` included: it targets Pixi 7, but its version is the facade's, not a Pixi version.
- **The major still tracks the Pixi major**, so an ABI-breaking change between core and the adapters may ship in a
  minor, documented in the changelog.
- **Exact dependencies between our packages.** The renderer and every adapter depend on core at exactly the same
  version (`"8.1.0"`, not `^8.1.0`). Users install all `@pixi/react-*` packages at the same version. The runtime ABI
  check stays as the backstop.
- **The release dry run is a required CI check** ([below](#the-dry-run-in-ci)).

## Packages and public names

| Workspace | Workspace name | Public name (target) | Release 1 |
| --- | --- | --- | --- |
| `packages/react` | `@pixi/react` | `@pixi/react` (the facade) | 8.1.0 |
| `packages/core` | `@pixi-react-provisional/core` | `@pixi/react-core` | 8.1.0 |
| `packages/renderer` | `@pixi-react-provisional/renderer` | `@pixi/react-renderer` | 8.1.0 |
| `packages/react-19.0` … `react-19.3` | `@pixi-react-provisional/react-19.x` | `@pixi/react-19.0` … `@pixi/react-19.3` | 8.1.0 |
| `packages/react-18.0` | `@pixi-react-provisional/react-18.0` | `@pixi/react-18.0` | 8.1.0 |
| `packages/react-18.1` | `@pixi-react-provisional/react-18.1` | `@pixi/react-18.1` | 8.1.0 |
| `packages/react-18.2` | `@pixi-react-provisional/react-18.2` | `@pixi/react-18.2` | 8.1.0 |
| `packages/react-18.3` | `@pixi-react-provisional/react-18.3` | `@pixi/react-18.3` | 8.1.0 |
| `packages/pixi-8` | `@pixi-react-provisional/pixi-8` | `@pixi/react-pixi-8` | 8.1.0 |
| `packages/pixi-7` | `@pixi-react-provisional/pixi-7` | `@pixi/react-pixi-7` | 8.1.0 (targets Pixi 7; lockstep with the facade) |

These packages are never published: `react-shared` (bundled into each React adapter at build time), `conformance`,
`type-consumers`, `design/contract`, every `*-fixture-*` package, `apps/docs` and `apps/examples`. Each of them is `"private": true`, and
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
`UNSUPPORTED_TUPLE` error names `@pixi/react-19.1`, and each adapter's `verification` pointer names its own public package.
Consumers therefore see the names they install.

## Version policy

### Lockstep versions

Every published package releases at the facade's version (issue 62). The ten packages of `release.packages.json` form
one Changesets `fixed` group, so a changeset for any of them releases all of them, at the highest bump among the pending
changesets; never-published packages stay ignored. Each package still has its own CHANGELOG.

`policy.mjs` checks the group (exactly the publishable packages, nothing `linked`), and that once the pending plan is
applied every publishable package is at one version whose major is the Pixi major of the facade's `pixi.js` peer.
`inspect.mjs` checks the same on the staged tarballs.

Why lockstep: one number tells a user which packages belong together, and the exact dependencies below make a release
a tested set. Core and the adapters can then change their ABI in any release without encoding the ABI in core's version.

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
`8.1.0`; the modular packages' workspace versions are `0.0.0`, and the `fixed` group releases them from the group's
highest version, so they reach `8.1.0` too (`changeset status` reports them as `8.0.5 -> 8.1.0`). The facade follows
semver for upstream's public API (D4): a behaviour change that a working upstream program can observe is held for the
documented future major. The facade has no runtime dependency on any modular package: it bundles their code.

### The ABI version is independent of the npm version

Adapters and core negotiate through the adapter ABI (`CORE_ABI = { major: 1, minor: 0 }` in
`packages/core/src/abi.ts`, and each adapter manifest's `abi`). The ABI stays in the adapter manifests, and core still
rejects an adapter of another ABI major (`ABI_MISMATCH`) before anything is allocated. But no npm version encodes it:
before issue 62, core's major was the ABI major (Release 1 would have been `1.0.0`, and an ABI break a core major).
Under lockstep, core's major is the Pixi major like every other package's, so an ABI change, even a breaking one, can
ship in a minor. That is safe because every package depends on the others at the exact same version: a consistent
install never mixes ABIs.

Mixing versions is not supported. A second version of an adapter brings its own exact core, so npm installs a second
copy of core. If the two cores' ABIs differ, composition fails with `ABI_MISMATCH`, naming the adapter. If they do not,
the composition may work, but each copy has its own `CompatibilityError` class; nothing is promised for that install.

### Dependency ranges

| Dependency | In the workspace | Published as | Why |
| --- | --- | --- | --- |
| A package of ours on another (the renderer and every adapter on core) | `workspace:*` | `<version>`: exactly the release's version, never `^` or `~` | pnpm pack writes the exact version. Packages of one release share one core: one registry, one `CompatibilityError` class, and the ABI the release was tested with. `policy.mjs` rejects any other workspace range, `inspect.mjs` any other published one |
| A React adapter on `react-reconciler`, `its-fine` | exact | exact | Each reconciler is pinned in the adapter that owns it (D2 reversed). The policy check rejects a reconciler anywhere except the React adapters and the facade |
| `react`, `react-dom`, `pixi.js` | peer | peer | Never a dependency of any published package. The React adapters' peers list exact tested versions (D5). The facade's React peer is `^19.3.0` (D1 as amended by issue 49) |
| The facade on modular packages | devDependencies | none | The facade bundles our adapter code. Non-default adapters are never facade dependencies |

### When an ABI changes

An ABI change is a change to `CORE_ABI` or to an adapter manifest's `abi` declaration (in `packages/pixi-8/src/adapter.ts`,
`packages/pixi-7/src/adapter.ts`, `packages/react-shared/src/react-18/adapter.ts` and `packages/react-shared/src/react-19/adapter.ts`). `scripts/release/policy.mjs`
enforces these rules on the pending Changesets plan:

| Change | Required release | Enforced by |
| --- | --- | --- |
| Any ABI change since the last release: a new ABI method or capability (`CORE_ABI.minor` +1), an incompatible change (`CORE_ABI.major` +1), or an adapter that declares another ABI | At least a **minor** release of the lockstep group, and a changeset of at least minor level whose summary says `ABI`: the changelog must tell users that the release changes the ABI between core and the adapters, and that mixing versions may then fail | `the adapter ABI changed since the last release (…): the lockstep packages need at least a minor changeset` and `… must document it in its summary (mention "ABI")` |
| An adapter's manifest ABI major differs from core's, or its ABI minor is newer than `CORE_ABI.minor` (core rejects it at runtime) | Not allowed: raise `CORE_ABI.minor` with the new methods first | `declares ABI major …, core implements …` and `declares ABI …, but core implements only …` |
| Removing an ABI method within a major (`CORE_ABI.minor` −1) | Not allowed; it is an ABI major change | `CORE_ABI minor fell …` |

`abi.released` in `release.packages.json` records the ABI declarations of the last release: CORE_ABI and every adapter
declaration, by source file. `pnpm release:version` sets it, so the next run can tell whether the ABI moved.

### Peer ranges move only with matrix evidence

The facade's peers are not edited by hand: `policy.mjs` (through `scripts/release/compat.mjs`) requires that

| Rule | Checked against |
| --- | --- |
| The facade's `pixi.js` peer equals the Pixi adapter's `declaredPeers["pixi.js"]` in the compatibility manifest | `design/compatibility/seed.json` (`adapterMatrix.pixiAdapters.pixi8`) |
| That declared range is exactly the one the manifest's evidence supports: from `pixiEpochs.pixi8.minimum` to below the minor after `current`, minus `excludedVersions` | the same manifest; a newer `current` needs audited probe tuples and cells (`validate.mjs`) |
| Every Pixi adapter's declared range is the one its own epoch supports (`pixiAdapters.pixi7` from `pixiEpochs.pixi7` and its `excludedVersions`: `>=7.2.0 <7.4.0 || >=7.4.2 <7.5.0`), and its `package.json` peer equals it | the same manifest |
| The facade's `react` peer is `^<newest tested React>` of the React epoch it builds in, and that epoch is the manifest's newest (D1) | `adapterMatrix.reactAdapters.<epoch>.declaredPeers.react`, `reactEpochs` |
| The facade's runtime warning (`TESTED_REACT` in `packages/react/src/runtime/reactVersion.ts`) names exactly those tested versions | the same row |
| The facade's `react-reconciler` and `its-fine` equal those of the adapter package it builds in | `packages/react-19.3/package.json` |
| The facade's major equals the Pixi major of its `pixi.js` peer | the pending plan |

Each React adapter's packed `peerDependencies` must equal its manifest row's `declaredPeers`, which every compatibility
cell already checks (`tree` command). So a peer can only widen after the manifest does, and the manifest only widens
with audited tuples and passing cells.

### Tested and verified

Owner ruling (issue 17, 2026-10-10): "verified" replaces "certified", and the versions this repository runs fall into
two tiers. **Verification is evidence, not a support guarantee.** "Supported" is reserved and not used.

- **Tested:** the exact React and pixi.js versions that the PR-tier #13 compatibility cells run. The PR tier (the
  required check **Compatibility (required)**) runs React 18.3 and each React 19 adapter at its newest audited patch
  (React 18.3.1, 19.0.8, 19.1.9, 19.2.8 and 19.3.0) with pixi.js 8.2.6 and 8.22.0, React 18.0.0 with 8.2.6, the Pixi 7
  adapter with React 18.0.0 on pixi.js 7.2.0 and React 19.3.0 on 7.4.3, plus probes at every named Pixi 8 boundary, on
  WebGL, on every pull request and every push to `main`. React 18.1.0 and 18.2.0 are tested by their packages'
  fixtures (React 18 suite and conformance in Chromium, pixi.js 8.2.6 and 8.22.0) and in the nightly tier.
- **Verified:** per tuple and per render backend (owner ruling, 2026-10-10: WebGPU is verified per version, not by
  the whole matrix). A tuple (React adapter, exact React, Pixi adapter, exact pixi.js) is verified on WebGL or WebGPU
  when its nightly cell (the nightly tier, which GitHub runs weekly by the owner's ruling of 2026-10-10) passed on that backend (every command, every conformance scenario and the render check) in a
  dated [verification record](compatibility/verification/) whose boundary probes all passed and whose incompatible
  pairs were all rejected. One backend is never inferred from the other. `verifiedRanges` in
  `design/compatibility/seed.json` lists exactly the tuples the records verified, per backend;
  `design/compatibility/verification.mjs` derives it from the records and `validate.mjs` fails when they disagree.

The [2026-10-10.2 record](compatibility/verification/2026-10-10.2.md) (297 cells: every React adapter, React 18.0 to
19.3, at every audited patch × every Pixi 8 minor's newest audited patch and pixi.js 7.2.0, 7.2.4, 7.3.0, 7.3.3, 7.4.2
and 7.4.3) supersedes the first 2026-10-10 record (184 cells) of the same machine and verifies:

- **WebGL:** every nightly tuple (297 of 297 cells).
- **WebGPU:** pixi.js 8.10.2 to 8.22.0 with every React adapter (143 of the 231 Pixi 8 cells). Pixi 7 has no WebGPU
  renderer.
- **Expected blank render, unverified:** pixi.js 8.2.6, 8.3.4, 8.4.1, 8.5.2, 8.6.6, 8.7.3, 8.8.1 and 8.9.2 on WebGPU
  (88 cells). Pixi creates a WebGPU renderer and every conformance scenario passes, but the canvas stays blank on the
  software fallback adapter. The cause is an upstream pixi.js bug before 8.10
  ([pixijs/pixijs#11389](https://github.com/pixijs/pixijs/issues/11389), fixed by
  [#11417](https://github.com/pixijs/pixijs/pull/11417), first released in 8.10.0; bisected: 8.9.2 blank, 8.10.0
  renders): Pixi sizes the WebGPU texture batch from WebGL's `MAX_TEXTURE_IMAGE_UNITS` (32 on SwiftShader) while the
  device allows 16 sampled textures per stage, so the pipeline is invalid. It is not specific to software rendering:
  real devices with that mismatch are affected too, while the full hardware record from an Apple M5 Max (WebGL
  reports 16 units there) renders 8.2.6 to 8.9.2 on WebGPU. The adapters do not work around it. These cells are on the manifest's
  `adapterMatrix.expectedBlankRender` list with that reason and evidence. Like the 8.5.0 ParticleContainer
  known-failure probe, the runner counts such a run as expected only when it fails exactly as listed (scenarios pass,
  canvas blank) and fails the cell when one starts rendering, so the list gets pruned; a conformance failure there
  still fails.

**Software rendering and a real GPU.** The 2026-10-10 records ran on software rendering: the machine has no GPU, WebGL
runs on ANGLE over SwiftShader and WebGPU on SwiftShader's fallback adapter (`isFallbackAdapter: true`), as in CI. That
counts as verification (owner ruling). A run on a real GPU (`run-cells.mjs --gpu hardware`, see the
[cells README](compatibility/cells/README.md#running-on-a-real-gpu)) adds a dated record beside the software one: the
full [2026-10-10-macos-26-apple-m5-max](compatibility/verification/2026-10-10-macos-26-apple-m5-max.md) record (Apple
M5 Max, Metal; 184 cells at main d0071c1, before the React 18 split and the Pixi 7.2 widening) passed every cell on
both backends, so it verifies React 18.3.1 (the former `react-18` package) and every React 19 adapter with pixi.js
8.2.6 … 8.22.0 on WebGL and WebGPU and with 7.4.2 and 7.4.3 on WebGL. WebGPU is therefore verified from 8.2.6 for
those adapters, and from 8.10.2 for the React 18.0–18.3 packages.

**Known issues** (`adapterMatrix.knownIssues`, owner ruling 2026-10-10: "verified + known issue"). A tuple a record
verified stays verified, and the generated tables and records show the issue beside every verified range it covers.
Today: some devices render a blank canvas on WebGPU before pixi.js 8.10
([pixijs/pixijs#11389](https://github.com/pixijs/pixijs/issues/11389), fixed by
[#11417](https://github.com/pixijs/pixijs/pull/11417) in 8.10.0); use pixi.js 8.10 or later for WebGPU, or WebGL.
`validate.mjs` requires each entry to name its version range, backend and links.

Verification never widens a peer range (D5: never broader than the evidence). The peer ranges stay exactly the tested
versions: the verified tuples include them and add the minimum React patches, every Pixi 8 minor's newest audited
patch and every audited Pixi 7 release, all inside the existing ranges.

Every user-facing surface says what it can back: "tested" for the PR-tier versions, and "verified" per backend only
where a record backs it, with the software-rendering note: the facade's runtime warning and README, the
getting-started page, the adapter READMEs, the adapters' manifest `verification` pointers and the
[compatibility table](release-compatibility.md), which is generated from `verifiedRanges` and the records.

To verify again: run the nightly tier with both React patches and both backends, the boundary probes, the incompatible
pairs and the data-only probes from one commit with no verdict cache, write the record with
`node design/compatibility/verification.mjs build`, then `ranges --write` and regenerate the tables
([cells README](compatibility/cells/README.md#verification-records)).

### Other changes

The bump of a release is the highest among its changesets, for every package of the group.

| Change | Bump |
| --- | --- |
| A React adapter tests an additional React patch (peer gains an exact version) | minor |
| The Pixi adapter's peer range gains tested Pixi versions | minor |
| A peer version is dropped, or the reconciler or its-fine changes in a way consumers can observe | breaking: like a breaking facade change, it waits for the next Pixi major (the lockstep major). A reconciler bump is an adapter release that needs its matrix again (D2) |
| A failure-path repair or an internal fix | patch |
| A new export, option or capability | minor |

## Release procedure

Nothing below publishes. Publishing needs the [owner approvals](#before-publishing-owner-approvals) first.

1. **Describe each change.** In every pull request with a consumer-visible change, run `pnpm changeset` and choose the
   bump per the tables above. Name the packages that changed; the `fixed` group releases all of them at one version.
   Never-published packages are ignored.
2. **Check the policy.** `pnpm test:release` runs the release tooling tests and `pnpm release:policy`: classification,
   manifests, lockstep versions, ABI, Release 1 versions, the [peer rules](#peer-ranges-move-only-with-matrix-evidence), and whether the
   generated [compatibility table](release-compatibility.md) and [docs pins](#docs-versions-and-pins) are current.
3. **Dry run.** `pnpm release:dry-run` versions, builds, stages and verifies everything in a disposable copy; this
   checkout is never modified (steps below). Read `dry-run.md` and `bundles.json` in its output.
4. **Version.** On a release branch, `pnpm release:version` (never `changeset version` alone), then `pnpm install` if a
   lockfile entry moved, and commit the result as "Version packages": versions, CHANGELOGs, version constants,
   `abi.released`, the regenerated compatibility table and docs pins. `pnpm test:release` must pass on that commit.
   On it, `changeset status` would fail (the manifests changed since main and the changesets are consumed), so the
   policy recognizes an **already-versioned release commit**: no pending changeset, and every publishable package's
   version above its version at the merge base with `main` (`releaseState` in `policy.mjs`). It then skips
   `changeset status`, checks the policy on an empty plan (lockstep, the Pixi major, exact dependencies, version
   constants, the generated table and pins) and also requires `abi.released` to match the source and a
   `## <version>` entry in every package's CHANGELOG. The dry run of that commit stages the versioned packages without
   versioning again. A pull request that changes a package without a changeset and without bumping the versions is
   not such a commit: `changeset status` still fails it, with a message saying to add a changeset.
   Only the versioning result itself is accepted. The policy finds the version commit (the newest commit on HEAD's
   first-parent history since the merge base whose parent had other package versions; the merge commit CI checks out
   for a pull request is followed into the pull request's side) and fails when anything that ships changed after it:
   a publishable package directory (except its CHANGELOG.md), `packages/react-shared`, `scripts/`,
   `release.packages.json`, the lockfile, the workspace file, the root `package.json` or `.nvmrc` (the Node runtime the dry run builds with). Changesets pending on top of the version commit (main's next change, arriving in a pull request's merge commit) block it too. Docs, CI and changelog edits
   after the version commit are fine. Merging main (or any branch) into the release branch after the version commit
   also fails, even when main only changed docs. To recover (no history rewrite, no revert): land any late change on
   main with its changeset, then cut a new release branch from main and run `pnpm release:version` there. The
   changesets were consumed only on the old release branch, so main still has them; close the old branch. The release
   is then the versioning of exactly what it ships.
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
   With no release planned (no pending changesets: a pull request without a changeset, or `main` after a release),
   `pnpm release:version` checks the policy and changes nothing, so there is nothing to commit; the dry run checks that
   the checkout is unchanged and the policy clean, and steps 5 to 8 run on the current versions. `dry-run.md` then says
   "No release planned".
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

### The dry run in CI

[`.github/workflows/release-dry-run.yml`](../.github/workflows/release-dry-run.yml) (approved by the owner as a
**required** check, issue 62) runs `pnpm test:release` and then the full dry run, on every pull request, every merge-queue
commit (`merge_group`), every push to `main` and by hand. It has no `paths` filter, so a required check never stays pending. It publishes nothing: the token
is read-only (`contents: read`), checkout keeps no credentials, and it uses no secrets. It fetches the full history and
creates a local `main` branch when the checkout has none (a pull request's merge commit, or a merge-queue branch),
because `changeset status` compares against `main`. `changeset status` exits non-zero when a pull request changes a
published package without any pending changeset, so the check fails until one is added; with no package change, or on
`main` itself, it passes. It installs no browser: the consumers and bundles run on Node, npm and esbuild. The reports
(`dry-run.json`, `dry-run.md`, `consumers.json`, `bundles.json`, `release-manifest.json`) are kept as the
`release-dry-run` artifact for 14 days; the tarballs are not.

Branch protection must require the check **Release dry run** (the job name) for it to block merging.

The full dry run took about 4 minutes locally with warm caches (15 consumer projects, 8 bundle fixtures); the
45-minute timeout leaves room for cold npm caches.

### What is checked before a release

**Tarballs** (`inspect.mjs`, no install):

- names and versions follow `release.packages.json`;
- no `workspace:` range, no provisional name, no never-published package;
- every tarball has the same version (lockstep), and a dependency on another package of ours is exactly that version,
  never a `^` or `~` range (nor a peer);
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
| `explicit-<cell>` (15: each PR-tier cell of the #13 matrix, the two Pixi 7 cells included, and React 18.1.0 and 18.2.0, which no PR-tier cell installs, with pixi.js 8.22.0) | core, renderer, that cell's React adapter and Pixi adapter (pixi-8, or pixi-7 for React 18.0.0 + pixi.js 7.2.0 and React 19.3.0 + pixi.js 7.4.3), with the cell's exact React, types and pixi.js | `npm ls` is clean. Exactly one copy of each of our packages, all at the release version. Only that epoch's reconciler and its-fine. No facade and no other React or Pixi adapter. React 18 consumers get no React 19 package. Both formats compose with `createRenderer` and register `Container` and `Sprite`. Manifests report the package's own version and ABI. Declarations hold for each entry, including the `jsx` subpaths |
| `renderer-only` | core, renderer | No React, reconciler, its-fine or pixi.js is installed: the neutral factory is consumable with only the chosen adapters |
| `core-only` | core | Zero transitive dependencies |

Every scenario also fails if any installed copy of one of our packages has a version other than the release's.
The scenarios are generated from `design/compatibility/seed.json` and `release.packages.json`; none is listed by hand.

**Bundles** (`bundles.mjs`): fixed fixtures (`scripts/release/fixtures/bundle/`) are bundled with esbuild 0.21.5 (the
workspace's version) inside those consumer projects:

- **Unused adapter implementations are absent.** Only the chosen packages contribute bytes, each from one copy at the
  release version. Exactly one
  react-reconciler is bundled: the chosen epoch's, at its exact version. No other epoch's reconciler version string
  appears in the output. The facade bundle contains no non-default adapter. The neutral factory bundles only core and
  renderer (23.2 KiB minified, 7.3 KiB gzip).
- **Necessary registration side effects remain.** Each fixture is also bundled for Node and executed. The explicit
  fixture must report `pixiContainer` and `pixiSprite` registered and the expected adapter ids. The facade fixture must
  evaluate and run `extend`.
- **The Pixi 7 composition** (React 19.3 + pixi-7 + pixi.js 7.4.3) is bundled and executed the same way, with the
  adapter bounds above. The two Pixi bounds below apply to Pixi 8 only: pixi.js 7 declares no `sideEffects`, so a
  bundler keeps nearly all of it whatever an application imports, with or without this adapter (esbuild keeps 350
  pixi.js 7 modules for `Container` and `Sprite` alone; the adapter's named imports add 9).
- **Unused Pixi constructors can be eliminated.** `NineSliceSprite`, which no fixture imports or registers, must be
  absent from the output. A pixi.js-only control fixture shows that the bundler does eliminate it (146 of 633 pixi.js
  modules kept).
- **The Pixi code kept is no more than upstream's.** The facade fixture is also bundled against upstream
  `@pixi/react` 8.0.5 from the registry, in its own clean project with the same React, pixi.js and esbuild. The facade
  and explicit fixtures may keep no more pixi.js modules and no more pixi.js bytes than that baseline. See Pixi
  constructor elimination below.
- **Our own code stays within its budget.** The bytes our packages contribute to each production bundle are at most
  the fixture's budget, and no development-only diagnostic text is left in it. See
  [Our own code in production bundles](#our-own-code-in-production-bundles) below.

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
| This facade (8.1.0 candidate) | 732.2 KiB | 217.2 KiB | 381 | 501.4 KiB | eliminated |
| Explicit React 19.3 + pixi-8 | 723.0 KiB | 213.9 KiB | 381 | 501.4 KiB | eliminated |
| Explicit React 18 + pixi-8 | 682.2 KiB | 201.8 KiB | 381 | 501.3 KiB | eliminated |
| pixi.js alone (`Container`, `Sprite`) | 203.9 KiB | 60.3 KiB | 146 | 189.5 KiB | eliminated |
| Before issue 57: this facade | 1125 KiB | 330 KiB | 633 | 807 KiB | kept |

The Pixi part now matches upstream's: the same 381 pixi.js modules and no more pixi.js bytes. The rest of the facade
bundle is larger than upstream's (+68.6 KiB minified, +21.0 KiB gzip). That is not Pixi code: react-reconciler 0.34.0
(React 19.3, 127.0 KiB) is larger than upstream's 0.31.0 (112.3 KiB), and the modular core, renderer and adapters
bundled into `@pixi/react` (64.4 KiB) are larger than upstream's single package (16.2 KiB).

### Our own code in production bundles

Issue 58 reduced the code our packages contribute to a production bundle, without changing behaviour:

- Diagnostic text (error messages, the Pixi adapters' warnings) is built behind `process.env.NODE_ENV !== 'production'`,
  which every published build leaves as written (the React adapters' esbuild bundles with `platform: 'neutral'`, the
  esbuild bundles of `build-dual-package.mjs`, and the facade's `lib/`), so the application's bundler drops it. Every
  check still runs in every build; see [release-1-notes.md](release-1-notes.md#production-error-messages).
- core, renderer, pixi-8 and pixi-7 ship each runtime entry as one esbuild bundle of their sources instead of tsc's file
  per module (each Pixi adapter's `index.js` requires `bind.js`, so the implementation is still one module, D6); the facade bundles
  its adapters from their sources into `lib/adapters.js` and lowers each `lib/` chunk to ES2020 once.
- Test-only data (the React adapters' host-key audit tables) is written as pure expressions, so the bundles drop it.

Measured with the same fixtures (minified, `NODE_ENV=production`), the bytes our packages contribute:

| Fixture | Before | After | Budget |
| --- | --- | --- | --- |
| Facade (`@pixi/react`) | 85,911 | 65,977 | 68,000 |
| Explicit React 19.3 + pixi-8 (core, renderer, react-19.3, pixi-8) | 72,196 | 56,463 | 58,300 |
| Explicit React 18.3 + pixi-8 (core, renderer, react-18.3, pixi-8; `react-18` before the per-minor split) | 65,962 | 54,719 | 56,600 |
| Explicit React 19.3 + pixi-7 (core, renderer, react-19.3, pixi-7; issue 16) | - | 55,668 | 57,500 |
| Renderer only (core, renderer) | 29,577 | 23,175 | 24,000 |

`bundles.mjs` fails a fixture whose own code exceeds its budget (`OWN_CODE_BUDGETS`), or whose production bundle still
contains development-only text (`DEVELOPMENT_ONLY_TEXT`). Raise a budget only deliberately, in the change that needs it.
The JSX-order insert fix (PR 67) added about 400 bytes to each fixture with a Pixi adapter (facade 66,393, React 19.3 +
pixi-8 56,854, React 18 + pixi-8 55,110, React 19.3 + pixi-7 56,059); the budgets were raised then to leave roughly
1.5 KB of headroom.

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
versions tested on every pull request and in the nightly tier, and the adapter versions it builds in; for each modular package, its
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
2. **Run the nightly matrix.** Push the branch and start **Compatibility nightly** (scheduled weekly; start it by hand) with `workflow_dispatch`, with
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
- [ ] **Packaging**: a `release.packages.json` entry (its `release1` is only for Release 1), the new package added to
  the `fixed` group in `.changeset/config.json` (it starts at the group's version), a minor changeset, and the release
  consumers and bundles of a dry run.
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
  current pins. So does the **example app** (`apps/examples`, issue 18), whose files the docs Examples page embeds and
  renders with the workspace build; those live previews are the docs' local examples, while the Sandpack editors are
  labelled as running the published packages. See `apps/examples/README.md`.
- **Checks.** `docs-pins.mjs --check`, run by `policy.mjs`, fails when the pins file or a page is stale, when an
  example sets its own versions, when a pinned package appears without a version or as `latest`, `beta`, `next` or
  `canary` (`npm create pixi.js@latest` is allowed: it is the scaffolder, not a pinned package), or when the docs app's
  or the example app's versions differ from the pins. It also scans the example app's sources.
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
3. **The CI workflows**: the [release dry run job](#the-dry-run-in-ci) is approved and added (issue 62); branch
   protection must require **Release dry run**. A release workflow that publishes the staged tarballs of a passing dry
   run still needs approval.
4. **Tested and verified**: ruled on 2026-10-10 (issue 17): "tested" for the PR tier, "verified" for what a dated
   verification record backs ([above](#tested-and-verified)).
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
version the adapter is tested with. **Install all `@pixi/react-*` packages at the same version**: they release in
lockstep and depend on each other at exactly that version. Core comes as their dependency. Add it to your own
dependencies only if you import it, for example for `CompatibilityError`, and then at the same version too.

```sh
# React 19.1, for example; use @pixi/react-19.0, -19.2 or -19.3 with a React version from that package's peer range
npm install @pixi/react-renderer@8.1.0 @pixi/react-19.1@8.1.0 @pixi/react-pixi-8@8.1.0 pixi.js react@19.1.9 react-dom@19.1.9
# React 18.3; use @pixi/react-18.0, -18.1 or -18.2 with React 18.0.0, 18.1.0 or 18.2.0
npm install @pixi/react-renderer@8.1.0 @pixi/react-18.3@8.1.0 @pixi/react-pixi-8@8.1.0 pixi.js react@18.3.1 react-dom@18.3.1
# Pixi 7 (pixi.js 7.2.x, 7.3.x, 7.4.2 or 7.4.3; not 7.4.0), with any React adapter; the Pixi 7 adapter is also at the facade's version
npm install @pixi/react-renderer@8.1.0 @pixi/react-18.3@8.1.0 @pixi/react-pixi-7@8.1.0 pixi.js@7.4.3 react@18.3.1 react-dom@18.3.1
```

```ts
import { createRenderer } from '@pixi/react-renderer';
import { React19Adapter } from '@pixi/react-19.1'; // or: import { React18Adapter } from '@pixi/react-18.3'
import { Pixi8Adapter } from '@pixi/react-pixi-8';
import { Container, Sprite } from 'pixi.js';

export const { Application, extend, useApplication, useTick, createRoot, component } =
    createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });

extend({ Container, Sprite });
```

Each React adapter rejects an installed React of another minor with `CompatibilityError` (`UNSUPPORTED_TUPLE`). The
error names the package to install instead. Nothing is selected automatically.

For JSX element types, add one of these to a `.d.ts` file in your program (`pixi-7` has the same entries for Pixi 7): `import '@pixi/react-pixi-8/jsx/react-19';`
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
| `@pixi/react-18.0` | `18.0.0` | 0.27.0 / 1.2.5 |
| `@pixi/react-18.1` | `18.1.0` | 0.28.0 / 1.2.5 |
| `@pixi/react-18.2` | `18.2.0` | 0.29.0 / 1.2.5 |
| `@pixi/react-18.3` | `18.3.1` | 0.29.2 / 1.2.5 |
| `@pixi/react-pixi-8` | pixi.js `>=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0` | — |
| `@pixi/react-pixi-7` | pixi.js `>=7.2.0 <7.4.0 \|\| >=7.4.2 <7.5.0` | — |

[COMPATIBILITY.md](compatibility/cells/COMPATIBILITY.md) lists the pairs CI runs: React 18.3 and each React 19 adapter at its newest
patch with pixi.js 8.2.6 and 8.22.0 and React 18.0.0 with 8.2.6 on every PR, and every React adapter with every Pixi 8
minor in the nightly tier (run weekly); the Pixi 7 adapter with React 18.0.0 on pixi.js 7.2.0 and React 19.3.0 on 7.4.3
on every PR, and with every React adapter on every tested Pixi 7 release in the nightly tier. These versions are *tested*; the
[2026-10-10.2 verification record](compatibility/verification/2026-10-10.2.md) verifies the nightly tuples on WebGL, and on
WebGPU from pixi.js 8.10.2 (8.2–8.9 are an expected blank render, unverified), on software rendering
([Tested and verified](#tested-and-verified)). The
generated [release compatibility table](release-compatibility.md) lists them per package and release.

### Custom registration

- `extend({ Name: Ctor })` registers raw constructors under JSX names (`pixiName`), as upstream does. Registration is
  explicit: nothing scans `pixi.js` or the filesystem.
- `component(Ctor, name?)` (modular packages only) returns a typed component for one constructor, without JSX
  augmentation.
- `runtime.registry.register(definition)` is the descriptor route for nodes that need custom attach rules. A
  third-party adapter subclasses `ReactAdapter` or `PixiAdapter` from `@pixi/react-core`. Core's version no longer
  names the ABI, so such an adapter should take core as a peer (the application's one core) over the core versions
  whose ABI it implements; the runtime ABI check rejects any other (see the
  [architecture](adapter-architecture.md#composition-classes-and-open-extension)).

### Migrating from upstream `@pixi/react`

| You use | Do this |
| --- | --- |
| `@pixi/react` 8.0.x with React 19.3 | Upgrade to 8.1.0. Same API and documented behaviour (D4), with failure-path repairs |
| `@pixi/react` 8.0.x with React 19.0, 19.1 or 19.2 | 8.1.0's React peer is `^19.3.0` (upstream's was `>=19.0.0`). Either upgrade React to 19.3, or stay on your minor with the explicit composition and that minor's package |
| `@pixi/react` with a React 19 minor newer than 19.3 | 8.1.0 installs and logs one warning naming the tested 19.3.0 and how to pin |
| `@pixi/react` 7.x (React 17/18, Pixi 7) | Stay on Pixi 7 (7.2.x, 7.3.x, 7.4.2 or 7.4.3) with the explicit composition: `@pixi/react-pixi-7` with the package of your React minor (`@pixi/react-18.0` … `@pixi/react-18.3`, or a React 19 minor's package). It is the current API (`Application`, `extend`, hooks), not the 7.x API (`Stage`, `PixiComponent`, `withFilters`); see the [pixi-7 README](../packages/pixi-7/README.md). Or move to Pixi 8 with the facade or `@pixi/react-pixi-8` |
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
