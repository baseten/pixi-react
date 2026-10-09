# Release policy, packaging and installation (issue 15)

This page defines how the facade and the modular packages are versioned, packed and installed. It covers the release
plan for Release 1, the checks that run before any release, and how consumers install each package. **Nothing is
published.** Publishing stays disabled until the owner configures a destination (see
[Enabling publication](#enabling-publication)).

Owner rulings of 2026-10-09 applied here:

- the public names use upstream's `@pixi` scope, pending agreement with the pixijs maintainers
  ([issue 41](https://github.com/baseten/pixi-react/issues/41)), so the scope must stay switchable;
- in Release 1 the facade is `8.1.0`;
- the conformance kit stays private (issue 20 publishes it later), and Pixi 7 is deferred.

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
is not a certificate: support is still exactly the certified peers (D5) and the #13 matrix, and `1.0.0` adds no claim
beyond that.

### Dependency ranges

| Dependency | In the workspace | Published as | Why |
| --- | --- | --- | --- |
| A modular package on core | `workspace:^` | `^<core version at release>` | Any core of the same ABI major satisfies it, so npm installs **one** core for every adapter. Core identity matters: one registry, one `CompatibilityError` class. The floor is the core the adapter was built and tested against, so it already implements every ABI minor the adapter needs |
| A React adapter on `react-reconciler`, `its-fine` | exact | exact | Each reconciler is pinned in the adapter that owns it (D2 reversed). The policy check rejects a reconciler anywhere except the React adapters and the facade |
| `react`, `react-dom`, `pixi.js` | peer | peer | Never a dependency of any published package. The React adapters' peers list exact certified versions (D5). The facade's React peer is `^19.3.0` (D1 as amended by issue 49) |
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

### Other changes

| Change | Bump |
| --- | --- |
| A React adapter certifies an additional React patch (peer gains an exact version) | minor |
| The Pixi adapter's peer range gains certified Pixi versions | minor |
| A peer version is dropped, or the reconciler or its-fine changes in a way consumers can observe | major. A reconciler bump is an adapter release that needs its matrix again (D2) |
| A failure-path repair or an internal fix | patch |
| A new export, option or capability | minor |

## Release workflow

```sh
pnpm changeset            # describe each consumer-visible change; choose the bump per the tables above
pnpm release:policy       # the policy check on the pending plan (also part of pnpm test:release)
pnpm release:dry-run      # everything below, in a disposable copy; this checkout is never modified
```

`pnpm release:dry-run` (`scripts/release/dry-run.mjs`) runs these steps:

1. It copies the working tree to a temporary directory, makes the copy a one-commit git repository, and runs
   `pnpm install --frozen-lockfile`.
2. `changeset status --output`: the release plan.
3. `pnpm release:version` (`scripts/release/version.mjs`) runs the policy check, then `changeset version`. It then
   copies each new version into the source constant that the adapter manifests report (`packageVersion`), which
   `changeset version` cannot see; each package's unit test keeps the two equal. Finally it records the released ABI.
   Always use this command; never run `changeset version` alone.
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
version the adapter certifies. Core comes as their dependency. Add it to your own dependencies only if you import it,
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
patch with pixi.js 8.2.6 and 8.22.0 on every PR, and every Pixi 8 minor nightly. These are candidate-not-certified
until the owner promotes a range (`advertisedRanges` in the seed).

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
| `@pixi/react` with a React 19 minor newer than 19.3 | 8.1.0 installs and logs one warning naming the certified 19.3.0 and how to pin |
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
pnpm test:release                 # offline: tooling unit tests + policy check on the pending plan
pnpm release:dry-run              # disposable checkout: version plan, build, stage, inspect, consumers, bundles
node scripts/release/stage.mjs --out .release/tarballs && node scripts/release/inspect.mjs --tarballs .release/tarballs
node scripts/release/consumers.mjs --tarballs .release/tarballs [--only facade]
node scripts/release/bundles.mjs --tarballs .release/tarballs     # after consumers.mjs
```

The dry run never publishes and never modifies this checkout. `.release/` is git-ignored.
