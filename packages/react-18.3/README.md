# @pixi-react-provisional/react-18.3

The React 18.3 adapter ([issue 12](https://github.com/baseten/pixi-react/issues/12); one package per React 18 minor
since the owner's ruling of 2026-10-10, following the React 19 minors of
[issue 49](https://github.com/baseten/pixi-react/issues/49)). `React183Adapter`, also exported as `React18Adapter`, is
a `ReactAdapter` from [`@pixi-react-provisional/core`](../core/README.md) that owns everything React-side for React
18.3: the reconciler, roots, priorities, the host config, error routing, the context bridge, and the shells of
`Application` and the hooks. All scene work goes through core's `PixiSession` protocol, so the package has no Pixi
dependency, and it composes with the **same, unchanged** `Pixi8Adapter` and `Pixi7Adapter` as the React 19 epochs.
The package is private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React18Adapter } from '@pixi-react-provisional/react-18.3'; // React 18.3.x
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

export const { Application, createRoot, extend, useApplication, useTick, component } =
    createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
```

This package was `react-18` until the React 18 minors became packages of their own; it was never released, so no
alias keeps the old name (issue 49 kept none for `react-19` either). Selecting React 18 means installing the package of
the installed React minor instead of a React 19 minor package: it depends on its own exact reconciler, and the default
facade (`@pixi/react`, React 19) is not involved. One application uses one React version.

## One package per React 18 minor

| Package | React peer (tested, D5) | react-reconciler | its-fine | Class (also `React18Adapter`) | Adapter ID |
| --- | --- | --- | --- | --- | --- |
| [`react-18.0`](../react-18.0/README.md) | `18.0.0` | 0.27.0 | 1.2.5 | `React180Adapter` | `react-18.0` |
| [`react-18.1`](../react-18.1/README.md) | `18.1.0` | 0.28.0 | 1.2.5 | `React181Adapter` | `react-18.1` |
| [`react-18.2`](../react-18.2/README.md) | `18.2.0` | 0.29.0 | 1.2.5 | `React182Adapter` | `react-18.2` |
| **`react-18.3`** (this package) | `18.3.1` | 0.29.2 | 1.2.5 | `React183Adapter` | `react-18.3` |

Each reconciler is the one released with its React minor (its npm peer is `^18.<minor>.0`; 0.29.2 declares
`^18.3.1`). Every React 18 minor has one published patch (18.0.0, 18.1.0, 18.2.0), except 18.3 (18.3.0 and 18.3.1,
of which 18.3.1 is tested). The four reconcilers have the same host-config and root API; their bundles differ only in
host keys this renderer cannot reach (0.27 and 0.28 still read `now` and the persistent-mode Offscreen keys and lack
`getSuspenseInstanceFallbackErrorDetails`; 0.27 reads `preparePortalMount` where later bundles read
`prepareScopeUpdate`), each package's host-key audit lists them. Everything else is shared through the private
[react-shared](../react-shared/README.md) package (`react-shared/react-18`): the adapter base class
(`React18AdapterBase`), the bindings, the host config and the root renderer. Each package keeps only its reconciler
import, its root factory and its host-key list (`src/hostConfig.ts`), typed against declarations of its own
reconciler (`src/reconciler/react-reconciler.d.ts`).

React 18.0.0 is the one release whose `React.version` is not the plain version: it reports
`18.0.0-fc46dba67-20220329`. Its minor is still 18.0, which is all `checkEnvironment()` reads.

## Install

Release 1 will publish this package as 8.1.0. React is a peer, limited to the exact versions this package is tested with, so install one of them exactly. `react-reconciler` and its-fine are exact dependencies and come with the package. They release together at the same version as `@pixi/react` and depend on each other at exactly that version, so install all of them (core, the renderer and the adapters) at one version.

```sh
npm install @pixi-react-provisional/renderer@8.1.0 @pixi-react-provisional/react-18.3@8.1.0 @pixi-react-provisional/pixi-8@8.1.0 pixi.js react@18.3.1 react-dom@18.3.1
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target scope `@pixi`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). The [release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md) covers versions, install recipes, tested pairs and migration.

## Bounds (D5)

| | Exact version | How |
| --- | --- | --- |
| React and react-dom (peer, tested tuple) | **18.3.1** | `peerDependencies.react` is exactly `18.3.1`; the fixture runs 18.3.1 / react-dom 18.3.1 |
| react-reconciler | **0.29.2** (latest 0.29.x, built for React 18.3.1), which brings `scheduler@^0.23.2` | exact `dependencies` entry |
| Context bridge | **its-fine 1.2.5** (latest 1.x; 2.x requires React 19) | exact `dependencies` entry |
| Pixi | the unchanged `Pixi8Adapter`; fixture cells pixi.js **8.2.6** and **8.22.0** (the compatibility cells add every Pixi 8 minor and the Pixi 7 adapter) | packed `@pixi-react-provisional/pixi-8` |

- **Composition check.** `checkEnvironment()` reads `React.version` and rejects anything outside the 18.3 line with a
  `CompatibilityError` (`UNSUPPORTED_TUPLE`, `expected.react` `18.3.x`, `actual.react`). Another React 18 or React 19
  minor is pointed at its own package (for example `@pixi-react-provisional/react-18.2` or
  `@pixi-react-provisional/react-19.1`). The check never selects an adapter. Every React 18 minor package does the
  same for its own minor.
- **Tested and verified.** The manifest's `verification` pointer names the tested React version, the reconciler and
  its-fine. The [issue-13 compatibility cells](https://github.com/baseten/pixi-react/blob/main/design/compatibility/cells/COMPATIBILITY.md) run this package on every pull request
  with React 18.3.1 and pixi.js 8.2.6 and 8.22.0 (packed install, types, and the conformance suite in Chromium), so
  18.3.1 is *tested*. The [2026-10-10.2 verification record](https://github.com/baseten/pixi-react/blob/main/design/compatibility/verification/2026-10-10.2.md) *verifies* React 18.3.1 on
  **WebGL** with the newest audited patch of every Pixi 8 minor (8.2.6 … 8.22.0) and with pixi.js 7.2.0, 7.2.4, 7.3.0,
  7.3.3, 7.4.2 and 7.4.3, and on **WebGPU** with pixi.js 8.10.2 … 8.22.0; on WebGPU, pixi.js 8.2.6 to 8.9.2 are an
  expected blank render, unverified (pixijs/pixijs#11389 on the software WebGPU adapter). The Apple M5 Max hardware record, which verifies 8.2.6 … 8.9.2 on WebGPU for the React 19 packages, ran before the React 18 split, so it covers the former `react-18` package, not this one. **Known issue:** some devices render a blank canvas on WebGPU before pixi.js 8.10 ([pixijs/pixijs#11389](https://github.com/pixijs/pixijs/issues/11389), fixed by [#11417](https://github.com/pixijs/pixijs/pull/11417) in 8.10.0); use pixi.js 8.10 or later for WebGPU, or WebGL. The 2026-10-10.2 record ran on software
  rendering (SwiftShader, no GPU); a run on a real GPU can be added as extra evidence. Verification is evidence, not a support guarantee, and the peer range stays as it is ([tested and verified](https://github.com/baseten/pixi-react/blob/main/design/release.md#tested-and-verified)).

## How React 18 differs from the React 19 epochs

This is an independent implementation (react-shared's `react-18` entry, typed against React 18's own declarations),
not a cast of a React 19 epoch. Each React 18 package types it against declarations of its own reconciler
(`src/reconciler/react-reconciler.d.ts`, written from the installed bundle and imported through the package's private
`#reconciler` alias). Only the runtime-independent mutation host, the node → runtime map and the DOM-event priority
mapping are shared with the React 19 minors (react-shared's `common` entry).

| | React 18 (0.27.0–0.29.2) | React 19 epochs (0.31–0.34) |
| --- | --- | --- |
| Root | `createContainer` with **eight** arguments: `ConcurrentRoot`, `identifierPrefix`, `onRecoverableError`, `transitionCallbacks` (`null`) | ten arguments with three error callbacks |
| Error channels | `onRecoverableError` only. A boundary-caught error is logged by React (`console.error`); an uncaught render error unmounts the scene tree and is rethrown, as in React DOM 18. `onCaughtError` / `onUncaughtError` on `createRoot` or `Application` throw `CompatibilityError` (`CAPABILITY_MISSING`, capability `react.root-error-callbacks`) | `onUncaughtError`, `onCaughtError`, `onRecoverableError` |
| Priorities | `getCurrentEventPriority()` maps the current DOM event to the React 18 lanes (discrete 1, continuous 4, default 16) | get/set/resolve update priority |
| Updates | payload-based: `prepareUpdate` diffs props (ignoring `children`) and returns a payload or `null`; `commitUpdate(node, payload, type, previous, next)` | `commitUpdate(node, type, previous, next)` |
| Other host keys | `unhideInstance(node, props)`; no commit suspension, transition status, resources or singletons | commit-suspension and transition-status keys |
| Synchronous unmount | `flushSync(() => updateContainer(null))` | `updateContainerSync` + `flushSyncWork` |
| Refs | `forwardRef` for `Application` and `component(Ctor)`; a callback ref gets `null` on detach | `ref` is a prop; callback-ref cleanup functions |
| Context bridge | its-fine 1.2.5 (`FiberProvider`, `useContextBridge`) | its-fine 2.1.1 |
| Activity | none: `react.activity` is not provided, so a consumer that requires it fails at composition | 19.2+ provides `react.activity` |
| Reconciler instances | **one shared reconciler** for every runtime of the package copy (see below) | the same since issue 49 |

**One shared reconciler.** React 18 marks a context provider with the secondary renderer that last rendered it and, in
development, warns ("Detected multiple renderers concurrently rendering the same context provider") as soon as a
different reconciler instance renders it. With a reconciler per runtime, the adapter's own root context and every
bridged context would trip it when a second runtime renders. The adapter therefore creates one reconciler (and one
host config) per loaded package copy, as React DOM does for all its roots. The host config is runtime-independent:
each container carries its runtime and core root record, and each node is traced to the runtime that created it,
whose core node table still decides ownership (`detachDeletedInstance` drops the link). Roots, catalogs and node
metadata stay per runtime. Issue 49 gave every React 19 minor the same design. Two installed copies of this package
still have two reconcilers: deduplicate the package so an app loads one copy.

`UNSUPPORTED_CAPABILITIES` lists the React 19 capabilities React 18 lacks (`react.activity`,
`react.root-error-callbacks`). Neither is in the manifest's `provides`, so
`createRenderer(adapters, { requiredCapabilities: { 'react.activity': 1 } })` fails with `CAPABILITY_MISSING` before
anything is allocated, and the conformance runner skips any scenario that requires them by capability.

**Host-key audit.** `test/package.test.ts` (the shared suite in `react-shared/test-support/react-18/`) extracts every
`$$$hostConfig.<key>` the installed development bundle reads and fails unless *implemented ∪ unreachable* equals that
set exactly (the minified production bundle reads a subset). Unreachable keys (hydration, persistence, test selectors,
microtasks, text instances, the scope and event-handle APIs, `commitMount`) are listed with reasons: the groups every
React 18 bundle reads in `react-shared/src/react-18/audit.ts`, and each bundle's own extras in the package's
`src/hostConfig.ts`. The same suite reads the installed `createContainer` parameters and checks the eight-argument
root the factory creates.

## Roots, `Application` and hooks

The bindings follow the React 19 bindings' shape (`createRoot`, `Root.render`/`unmount`/`status`, `Application`,
`useApplication`, `useTick`, `extend`, `useExtend`, `applyProps`, `component`, `useContextBridge`,
`ContextBridgeProvider`), with the React 18 differences above. Adapter-owned error codes use the `react-18.` namespace
(`react-18.FOREIGN_RUNTIME`). `Application` ties its teardown to an insertion effect deferred by one turn, so a
StrictMode effect replay of the same canvas cancels it; StrictMode of the DOM tree does not cross into the scene root,
and a `<StrictMode>` inside the scene replays scene effects as React 18 does.

## Packaging (D6) and isolation

[`scripts/build-react-adapter.mjs`](../../scripts/build-react-adapter.mjs) (shared with the React 19 minors) emits
declarations with `tsc`, then bundles `src/index.ts` with esbuild into one CommonJS file, `dist/index.js`. Only our own
code is bundled (this package's sources and react-shared's `react-18` and `common`); `react`, `react-reconciler`, `its-fine` and core
stay external. It generates the ESM wrapper `dist/index.mjs` and `dist/index.d.mts`, copies the react-shared
declarations the entry reaches into `dist/shared/`, and prunes the host-config declaration (which names the
reconciler). The consumer's bundler resolves react-reconciler's own `NODE_ENV` switch, so a production bundle holds
only the production reconciler.

- `test/package.test.ts` loads the built package in plain Node through its `exports` map and checks that `import` and
  `require` give identical values from one implementation file, that react-reconciler 0.29.2 and its-fine
  1.2.5 resolve as dependencies at runtime, and that the bundle holds no reconciler, scheduler or its-fine code.
- `pnpm check:graph` allows only `react`, `react-reconciler`, `its-fine` and core in every emitted file and in
  `package.json`.

## Fixture: a separate React 18 install with packed packages

`fixtures/react-18.3.1/` is its own workspace package with exactly React 18.3.1, react-dom 18.3.1,
`@types/react` 18.3.31 and `@types/react-dom` 18.3.7. Every React 18 minor package has one such fixture
(`react-18.0.0`, `react-18.1.0`, `react-18.2.0`, `react-18.3.1`), sharing their sources in
`packages/react-shared/fixtures/react-18/`, where `install.mjs` runs before every fixture task:

1. `pnpm pack`s the built core, renderer (the version-neutral factory), the fixture's React 18 package and pixi-8 and extracts the
   tarballs into the fixture's `.installed/node_modules`, so the tests run the published file sets with the fixture's
   own React 18 and pixi.js;
2. checks the resolved React tree: every installed package resolves React 18.3.1, nothing resolves a React 19, the
   only reconciler is the package's exact react-reconciler (0.29.2 here, with its-fine 1.2.5), which the fixture installs as a
   consumer's package manager would, no other installed package declares one, and `pnpm ls` finds only
   `react@18.3.1`, `react-dom@18.3.1` and `react-reconciler@0.29.2` in the fixture (written to
   `.installed/react-tree.json`).

The browser suite runs in Chromium on two Pixi cells (8.2.6 and 8.22.0):

- the whole conformance catalogue through `createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() })`
  with the Pixi 8 adapter's own probe, capabilities `react.18`, `pixi.globals`, `dom.resize`, and no expected
  failures (the five `parity.upstream` scenarios are skipped by capability);
- React 18 behaviour (`react-shared/fixtures/react-18/suite.tsx`): the installed tuple and composition, missing React 19
  capabilities, callback and forwarded refs, effect order and cleanup before destruction, StrictMode replay, the
  its-fine context bridge with parent updates and its guidance error, the runtime-token check, Suspense hide/unhide,
  unmount while initialization or a suspended transition is pending, `useTransition`, and the error routing above;
- `typecheck` compiles the fixture and a runtime-adjacent consumer probe (`react-shared/fixtures/react-18/typeProbe.tsx`) against
  `@types/react` 18 and the packed declarations. Global React 18 JSX tags and the React 18 consumer type suite belong to
  [issue 11](https://github.com/baseten/pixi-react/issues/11); the fixture uses intrinsic tag strings and
  `component(Ctor)` and needs neither.

React before 18.3 has no `React.act`, which the conformance harness calls: the 18.0, 18.1 and 18.2 fixtures load a
setup file (`react-shared/fixtures/react-18/lendAct.ts`) that lends React the `act` of `react-dom/test-utils`, where
those versions export it. The adapter under test is untouched; the compatibility cells do the same (`lend-act.ts`).

React 18 types stay inside the React 18 packages and their fixtures: `pnpm-workspace.yaml` extends `its-fine@1` with an optional
`@types/react` peer (as for `its-fine@2`), so its declarations resolve the dependent's React 18 types rather than a
hoisted React 19 copy.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/react-18.3 build` | Declarations, the bundle and its ESM wrapper |
| `pnpm --filter @pixi-react-provisional/react-18.3 test:unit` | Typecheck, the shared React 18 package suite (host keys, root factory, environment, built package), then `check:graph` |
| `pnpm --filter "./packages/react-18.3/fixtures/*" test:conformance` | Packed install + tree check, then the conformance suite on both Pixi cells (part of `pnpm test:conformance`) |
| `pnpm --filter "./packages/react-18.3/fixtures/*" test:e2e` | The same plus the React 18 suite (part of `pnpm test:e2e`) |
| `pnpm --filter "./packages/react-18.3/fixtures/*" typecheck` | Packed install, then the fixture and consumer probe against `@types/react` 18 (part of `pnpm test:types`) |
