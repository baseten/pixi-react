# @pixi-react-provisional/react-18

The React 18 adapter ([issue 12](https://github.com/baseten/pixi-react/issues/12)). `React18Adapter` is a
`ReactAdapter` from [`@pixi-react-provisional/core`](../core/README.md) that owns everything React-side for React 18:
the reconciler, roots, priorities, the host config, error routing, the context bridge, and the shells of
`Application` and the hooks. All scene work goes through core's `PixiSession` protocol, so the package has no Pixi
dependency, and it composes with the **same, unchanged** `Pixi8Adapter` as the React 19 epochs. The package is
private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React18Adapter } from '@pixi-react-provisional/react-18'; // React 18.3.x
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

export const { Application, createRoot, extend, useApplication, useTick, component } =
    createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
```

Selecting React 18 means installing this package instead of `@pixi-react-provisional/react-19`: it bundles its own
reconciler, so a React 18 application never installs a second reconciler, and the default facade (`@pixi/react`,
React 19) is not involved. One application uses one React version.

## Bounds (D5)

| | Exact version | How |
| --- | --- | --- |
| React and react-dom (peer, certified tuple) | **18.3.1** | `peerDependencies.react` is exactly `18.3.1`; the fixture runs 18.3.1 / react-dom 18.3.1 |
| react-reconciler | **0.29.2** (latest 0.29.x, built for React 18.3.1), with scheduler 0.23.2 | bundled into `dist/index.js` |
| Context bridge | **its-fine 1.2.5** (latest 1.x; 2.x requires React 19) | bundled |
| Pixi | the unchanged `Pixi8Adapter`; fixture cells pixi.js **8.2.6** and **8.22.0** | packed `@pixi-react-provisional/pixi-8` |

- **Composition check.** `checkEnvironment()` reads `React.version` and rejects anything outside the 18.3 line with a
  `CompatibilityError` (`UNSUPPORTED_TUPLE`, `expected.react` `18.3.x`, `actual.react`). React 19 is pointed at
  `@pixi-react-provisional/react-19`. The check never selects an adapter.
- **React 18.2 is not certified.** With the version check bypassed and the conformance harness given
  `react-dom/test-utils`' `act` (React 18.2 has no `React.act`), the whole fixture suite also passed on React 18.2.0 /
  react-dom 18.2.0 with this bundle. It stays outside the certificate: react-reconciler 0.29.2 declares
  `react@^18.3.1`, the reconciler line for 18.2 is 0.29.0, and the shared harness itself needs React 18.3's `act`.
  Supporting 18.2 would be a separate, owner-approved cell.
- **Certification.** The manifest's `certification` names the tested React version, the bundled reconciler and
  its-fine. Like every row, it stays *candidate-not-certified* until the issue-13 matrix runs it.

## How React 18 differs from the React 19 epochs

This is an independent implementation against declarations of the bundled reconciler
(`src/reconciler/react-reconciler-0.29.d.ts`, written from the installed 0.29.2 bundle). Nothing is shared with, or
cast from, `@pixi-react-provisional/react-19`.

| | React 18 (0.29.2) | React 19 epochs (0.31–0.34) |
| --- | --- | --- |
| Root | `createContainer` with **eight** arguments: `ConcurrentRoot`, `identifierPrefix`, `onRecoverableError`, `transitionCallbacks` (`null`) | ten arguments with three error callbacks |
| Error channels | `onRecoverableError` only. A boundary-caught error is logged by React (`console.error`); an uncaught render error unmounts the scene tree and is rethrown, as in React DOM 18. `onCaughtError` / `onUncaughtError` on `createRoot` or `Application` throw `CompatibilityError` (`CAPABILITY_MISSING`, capability `react.root-error-callbacks`) | `onUncaughtError`, `onCaughtError`, `onRecoverableError` |
| Priorities | `getCurrentEventPriority()` maps the current DOM event to the 0.29 lanes (discrete 1, continuous 4, default 16) | get/set/resolve update priority |
| Updates | payload-based: `prepareUpdate` diffs props (ignoring `children`) and returns a payload or `null`; `commitUpdate(node, payload, type, previous, next)` | `commitUpdate(node, type, previous, next)` |
| Other host keys | `unhideInstance(node, props)`; no commit suspension, transition status, resources or singletons | commit-suspension and transition-status keys |
| Synchronous unmount | `flushSync(() => updateContainer(null))` | `updateContainerSync` + `flushSyncWork` |
| Refs | `forwardRef` for `Application` and `component(Ctor)`; a callback ref gets `null` on detach | `ref` is a prop; callback-ref cleanup functions |
| Context bridge | its-fine 1.2.5 (`FiberProvider`, `useContextBridge`) | its-fine 2.1.1 |
| Activity | none: `react.activity` is not provided, so a consumer that requires it fails at composition | 19.2+ provides `react.activity` |
| Reconciler instances | **one shared reconciler** for every runtime of the package copy (see below) | one per runtime |

**One shared reconciler.** React 18 marks a context provider with the secondary renderer that last rendered it and, in
development, warns ("Detected multiple renderers concurrently rendering the same context provider") as soon as a
different reconciler instance renders it. With a reconciler per runtime, the adapter's own root context and every
bridged context would trip it when a second runtime renders. The adapter therefore creates one reconciler (and one
host config) per loaded package copy, as React DOM does for all its roots. The host config is runtime-independent:
each container carries its runtime and core root record, and each node is traced to the runtime that created it,
whose core node table still decides ownership. Roots, catalogs and node metadata stay per runtime.

`UNSUPPORTED_CAPABILITIES` lists the React 19 capabilities React 18 lacks (`react.activity`,
`react.root-error-callbacks`). Neither is in the manifest's `provides`, so
`createRenderer(adapters, { requiredCapabilities: { 'react.activity': 1 } })` fails with `CAPABILITY_MISSING` before
anything is allocated, and the conformance runner skips any scenario that requires them by capability.

**Host-key audit.** `test/hostKeys.test.ts` extracts every `$$$hostConfig.<key>` the installed 0.29.2 development
bundle reads and fails unless *implemented ∪ unreachable* equals that set exactly (the minified production bundle
reads a subset). Unreachable keys (hydration, persistence, test selectors, microtasks, text instances, the scope and
event-handle APIs, `commitMount`) are listed with reasons in `src/audit.ts`. `test/rootFactory.test.ts` reads the
installed `createContainer` parameters and checks the eight-argument root the factory creates.

## Roots, `Application` and hooks

The bindings follow the React 19 bindings' shape (`createRoot`, `Root.render`/`unmount`/`status`, `Application`,
`useApplication`, `useTick`, `extend`, `useExtend`, `applyProps`, `component`, `useContextBridge`,
`ContextBridgeProvider`), with the React 18 differences above. Adapter-owned error codes use the `react-18.` namespace
(`react-18.FOREIGN_RUNTIME`). `Application` ties its teardown to an insertion effect deferred by one turn, so a
StrictMode effect replay of the same canvas cancels it; StrictMode of the DOM tree does not cross into the scene root,
and a `<StrictMode>` inside the scene replays scene effects as React 18 does.

## Packaging (D6) and isolation

`scripts/build.mjs` emits declarations with `tsc`, then bundles `src/index.ts` with esbuild into one CommonJS file,
`dist/index.js`, with only `react` and `@pixi-react-provisional/core` external, and generates the ESM wrapper
`dist/index.mjs` and `dist/index.d.mts`. The host-config declaration (which names the bundled reconciler) is pruned.
Like the React 19 package, the bundle keeps react-reconciler's own `NODE_ENV` switch; splitting production and
development builds (as the facade does since af815e1) is a follow-up for both adapter packages
([#40](https://github.com/baseten/pixi-react/issues/40)).

- `test/dist.test.ts` loads the built package in plain Node through its `exports` map and checks that `import` and
  `require` give identical values from one implementation file, that no reconciler, scheduler or its-fine module is
  resolved at runtime, and that the bundle holds only react-reconciler 0.29.2.
- `pnpm check:graph` allows only `react` and core in every emitted file and in `package.json`.

## Fixture: a separate React 18 install with packed packages

`fixtures/react-18.3.1/` is its own workspace package with exactly React 18.3.1, react-dom 18.3.1,
`@types/react` 18.3.31 and `@types/react-dom` 18.3.7. `fixtures/shared/install.mjs` runs before every fixture task:

1. `pnpm pack`s the built core, renderer (the version-neutral factory), react-18 and pixi-8 packages and extracts the
   tarballs into the fixture's `.installed/node_modules`, so the tests run the published file sets with the fixture's
   own React 18 and pixi.js;
2. checks the resolved React tree: every installed package resolves React 18.3.1, nothing resolves a React 19 or a
   `react-reconciler`, no installed package declares one, and `pnpm ls` finds only `react@18.3.1` and
   `react-dom@18.3.1` in the fixture (written to `.installed/react-tree.json`).

The browser suite runs in Chromium on two Pixi cells (8.2.6 and 8.22.0):

- the whole conformance catalogue through `createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() })`
  with the Pixi 8 adapter's own probe, capabilities `react.18`, `pixi.globals`, `dom.resize`, and no expected
  failures (the five `parity.upstream` scenarios are skipped by capability);
- React 18 behaviour (`fixtures/shared/suite.tsx`): the installed tuple and composition, missing React 19
  capabilities, callback and forwarded refs, effect order and cleanup before destruction, StrictMode replay, the
  its-fine context bridge with parent updates and its guidance error, the runtime-token check, Suspense hide/unhide,
  unmount while initialization or a suspended transition is pending, `useTransition`, and the error routing above;
- `typecheck` compiles the fixture and a runtime-adjacent consumer probe (`fixtures/shared/typeProbe.tsx`) against
  `@types/react` 18 and the packed declarations. Global React 18 JSX tags and the React 18 consumer type suite belong to
  [issue 11](https://github.com/baseten/pixi-react/issues/11); the fixture uses intrinsic tag strings and
  `component(Ctor)` and needs neither.

React 18 types stay inside this package and its fixture: `pnpm-workspace.yaml` extends `its-fine@1` with an optional
`@types/react` peer (as for `its-fine@2`), so its declarations resolve the dependent's React 18 types rather than a
hoisted React 19 copy.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/react-18 build` | Declarations, the bundle and its ESM wrapper |
| `pnpm --filter @pixi-react-provisional/react-18 test:unit` | Typecheck, host-key audit, root factory, environment and built-package tests, then `check:graph` |
| `pnpm --filter "./packages/react-18/fixtures/*" test:conformance` | Packed install + tree check, then the conformance suite on both Pixi cells (part of `pnpm test:conformance`) |
| `pnpm --filter "./packages/react-18/fixtures/*" test:e2e` | The same plus the React 18 suite (part of `pnpm test:e2e`) |
| `pnpm --filter "./packages/react-18/fixtures/*" typecheck` | Packed install, then the fixture and consumer probe against `@types/react` 18 (part of `pnpm test:types`) |
