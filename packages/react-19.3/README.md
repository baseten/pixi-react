# @pixi-react-provisional/react-19.3

The React 19.3 adapter ([issue 9](https://github.com/baseten/pixi-react/issues/9), repackaged per minor by
[issue 49](https://github.com/baseten/pixi-react/issues/49)). `React193Adapter` (also exported as `React19Adapter`) is a
`ReactAdapter` from [`@pixi-react-provisional/core`](../core/README.md) that owns everything React-side: the
reconciler, roots, the host config, the context bridge, and the shells of `Application` and the hooks. All scene work
goes through core's `PixiSession` protocol, so the package has no Pixi dependency. It is private and provisional: the
final package names are decided in issues 40 and 15.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React19Adapter } from '@pixi-react-provisional/react-19.3'; // React 19.3.x
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

export const { Application, createRoot, extend, useApplication, useTick, component } =
    createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });
```

## Install

Release 1 will publish this package as 8.1.0. React is a peer, limited to the exact versions this package is tested with, so install one of them exactly. `react-reconciler` and its-fine are exact dependencies and come with the package. They release together at the same version as `@pixi/react` and depend on each other at exactly that version, so install all of them (core, the renderer and the adapters) at one version.

```sh
npm install @pixi-react-provisional/renderer@8.1.0 @pixi-react-provisional/react-19.3@8.1.0 @pixi-react-provisional/pixi-8@8.1.0 pixi.js react@19.3.0 react-dom@19.3.0
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target scope `@pixi`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). The [release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md) covers versions, install recipes, tested pairs and migration.

## One package per React minor (D2 reversed)

D2 shipped every React 19 minor as one `react-19` package with `/19.x` subpaths, each **bundling** its exact
reconciler. Issue 49 reverses it: each minor is its own package, and the reconciler is an ordinary dependency, as
upstream `@pixi/react` does. The sibling packages are
[`react-19.0`](../react-19.0/README.md), [`react-19.1`](../react-19.1/README.md),
[`react-19.2`](../react-19.2/README.md), [`react-19.3`](../react-19.3/README.md) and [`react-18`](../react-18/README.md).

| | |
| --- | --- |
| Entry | `.` only (`import` and `require`); no subpaths |
| Exports | `React193Adapter`, `React19Adapter` (the same class), `React19AdapterBase`, `EPOCH`, `REQUIRED_PIXI_CAPABILITIES`, the public types |
| Adapter ID (manifest) | `react-19.3` |
| `dependencies` | `react-reconciler` **0.34.0** (exact), `its-fine` **2.1.1** (exact), `@pixi-react-provisional/core` (workspace) |
| `peerDependencies` | `react`: `19.3.0` (exactly the tested versions, D5) |
| Scheduler | not a direct dependency: react-reconciler 0.34.0 brings its own `scheduler@^0.28.0` |

- **Composition check.** `checkEnvironment()` reads `React.version` and rejects another minor with a
  `CompatibilityError` (`UNSUPPORTED_TUPLE`, `expected.react` `19.3.x`, `actual.react`). The message names the
  per-minor package to install instead (for example `@pixi-react-provisional/react-19.1`). The check never selects
  an adapter.
- **Tested, not certified.** The manifest's `certification` names the tested React versions (19.3.0), the
  reconciler and its-fine. The [issue-13 compatibility cells](https://github.com/baseten/pixi-react/blob/main/design/compatibility/cells/COMPATIBILITY.md) run this package on every pull request
  with React 19.3.0 and pixi.js 8.2.6 and 8.22.0 (packed install, types, and the conformance suite in Chromium), so
  these versions are *tested*. They stay *candidate-not-certified*: no range is certified until the owner promotes one
  in the compatibility manifest ([what "tested" means](https://github.com/baseten/pixi-react/blob/main/design/release.md#what-tested-means)).
- **Reconciler builds.** The package ships one CommonJS file that `require`s `react-reconciler`; the consumer's
  bundler resolves that package's own `NODE_ENV` switch, so a production bundle contains only the production
  reconciler. React DOM keeps its own scheduler copy only if the package manager does not deduplicate them.

## One shared reconciler per package copy

Every runtime this package binds renders through **one** reconciler (`sharedReconciler()` in `src/hostConfig.ts`), as
React DOM renders all its roots through one. The host config is runtime-independent: containers carry their runtime,
nodes are traced to their runtime through a module-level `WeakMap`, and `detachDeletedInstance` deletes the entry
(see [react-shared](../react-shared/README.md#one-shared-reconciler-per-package-copy)). This fixes a bug of the
D2-era package, which built one reconciler per runtime: a time-sliced render of one runtime that yielded leaked its
context provider values into a second runtime rendering meanwhile, which committed the wrong value and made React
warn "Detected multiple renderers concurrently rendering the same context provider".

**Remaining limit:** two installed copies of this package (or the facade's bundled copy next to this package) still
have separate reconcilers. Deduplicate the package so an app loads one copy.

## What React 19.3 implements

The shared base class holds the bindings and the mutation operations, which forward to the root's core
`PixiBridge`. This package builds its **own** host config and root factory, typed against declarations of its own
reconciler (`src/reconciler/react-reconciler.d.ts`, written from the installed bundle and imported through the
package's private `#reconciler` alias; no `@types/react-reconciler`, no cast to another minor's config).

- `createContainer` takes ten arguments; argument 10 is `onDefaultTransitionIndicator` (a no-op function).
- Priorities: get/set/resolve update priority, with the baseline mapping of DOM events.
- Keeps the 0.33 root shape, commit suspension, scheduler instrumentation and Activity behaviour.
- **Fragment refs are rejected**: a `ref` on a `<Fragment>` throws `CompatibilityError` (`CAPABILITY_MISSING`,
  capability `react.fragment-ref`) when React creates the fragment instance; React routes it to the nearest error
  boundary or `onUncaughtError`.
- **ViewTransition is rejected**: a `ref` or event callback on `<ViewTransition>` throws `CAPABILITY_MISSING`
  (`react.view-transition`); a transition that would animate one reports `CAPABILITY_MISSING` through
  `onRecoverableError` and commits without animation (throwing there would abandon the commit).
- The measure/viewport hooks are implemented as part of that rejection.
- This is the minor the `@pixi/react` facade builds in (D1).

**Host-key audit.** The package lists the keys its reconciler reads but a mutation-only, non-hydrating renderer
cannot reach (hydration, persistence, resources, singletons, test selectors, text instances, gated features), each
with its reason. `test/package.test.ts` extracts every `$$$config.<key>` the installed development and production
bundles read and fails unless *implemented ∪ unreachable* equals that set exactly, with no overlap. A reconciler bump
that adds, removes or renames a host key therefore fails a test.

The bindings (roots, `Application`, hooks, `component`, `useContextBridge`) are shared by every React 19 minor and
follow [`design/contract/react-19.d.ts`](../../design/contract/react-19.d.ts); see
[react-shared](../react-shared/README.md). Global JSX tags come from the Pixi adapter's types-only JSX entry for
React 19 (`@pixi-react-provisional/pixi-8/jsx/react-19`).

## Packaging (D6) and isolation

[`scripts/build-react-adapter.mjs`](../../scripts/build-react-adapter.mjs) emits declarations with `tsc`, then
bundles `src/index.ts` with esbuild into **one** CommonJS file, `dist/index.js`. Only our own code is bundled (this
package's sources and the private react-shared sources); `react`, `react-reconciler`, `its-fine` and core stay
external. It then generates `dist/index.mjs`, which imports that file and re-exports each name, and `index.d.mts`.
The react-shared declarations the entry reaches are copied into `dist/shared/` with relative specifiers; the host
config's declaration (which names the reconciler) is removed.

- `test/package.test.ts` (the shared suite in `react-shared/test-support/react-19.ts`) runs plain Node against the
  built package: `import` and `require` give identical values from one implementation file, the exact reconciler and
  its-fine resolve as dependencies, no reconciler or scheduler code is bundled, and no published declaration names
  the reconciler or react-shared.
- `pnpm check:graph` (the shared `scripts/check-dependency-graph.mjs`) allows only `react`, `react-reconciler`,
  `its-fine` and core, and fails on any other import or mention (for example `scheduler`, `react-dom` or Pixi).

## Fixtures: one workspace package per audited React version

`fixtures/react-<version>/` pins one audit tuple exactly: `react`, `react-dom`, `@types/react` and `@types/react-dom`,
plus this package's exact `react-reconciler` and `its-fine` (as a consumer's package manager would install them).
Before it runs, the fixture copies the **built** package into its `.installed/node_modules`, so the bundle resolves
the fixture's own React. The suite is shared with the other React 19 minors
(`packages/react-shared/fixtures/react-19/`):

- the whole conformance catalogue through `createRenderer` with the fake Pixi adapter, with no expected failures;
- the installed tuple: the exact React and react-dom versions, the manifest, and rejection of another minor;
- React behaviour the adapter owns (callback-ref cleanup, effect order, the public `useContextBridge`, the
  runtime-token check, Suspense, unmount during pending work, the three root error callbacks, and the minor's own
  features);
- **several runtimes of one package**: two runtimes rendering a bridged context in turn; a discrete update of
  runtime B while runtime A's transition render has yielded mid-render (B must read and commit its own default
  value, with no multiple-renderers warning); and the same interleaving within one runtime as a control. None uses
  `act()`, which never yields. A setup file also fails any fixture test during which React warns about multiple
  renderers;
- a compile-only consumer probe (`typeProbe.tsx`) against the fixture's own `@types/react` line.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/react-19.3 build` | Declarations, the bundle and its ESM wrapper |
| `pnpm --filter @pixi-react-provisional/react-19.3 test:unit` | Typecheck, the package suite (host keys, root factory, shared reconciler, environment, built package), then `check:graph` |
| `pnpm --filter "./packages/react-19.3/fixtures/*" test:conformance` | The suite against each audited React 19.3 version (part of `pnpm test:conformance`) |
| `pnpm --filter "./packages/react-19.3/fixtures/*" typecheck` | The fixtures and consumer probe against each `@types/react` line (part of `pnpm test:types`) |
