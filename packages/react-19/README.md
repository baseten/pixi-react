# @pixi-react-provisional/react-19

The React 19 framework adapters ([issue 9](https://github.com/baseten/pixi-react/issues/9)). Each one is a
`FrameworkAdapter` from [`@pixi-react-provisional/core`](../core/README.md) that owns everything React-side: the
reconciler, roots, the host config, the context bridge, and the shells of `Application` and the hooks. All scene work
goes through core's `SceneSession` protocol, so this package has no Pixi dependency: it installs, builds and runs
without `pixi.js`. The package is private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React19Adapter } from '@pixi-react-provisional/react-19/19.3'; // React 19.3.x
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

export const { Application, createRoot, extend, useApplication, useTick, component } =
    createRenderer({ framework: new React19Adapter(), scene: new Pixi8Adapter() });
```

## Epochs: one package, four subpaths (D2)

There is no bare `.` export and no aggregate entry. Import the subpath that matches the installed React minor.
Importing one subpath loads only its own reconciler.

| Subpath | React | Bundled reconciler | Tested exact React (fixtures) | Adapter class |
| --- | --- | --- | --- | --- |
| `/19.0` | 19.0.x | react-reconciler 0.31.0 (+ scheduler 0.25) | 19.0.0, 19.0.8 | `React190Adapter` |
| `/19.1` | 19.1.x | react-reconciler 0.32.0 (+ scheduler 0.26) | 19.1.0, 19.1.9 | `React191Adapter` |
| `/19.2` | 19.2.x | react-reconciler 0.33.0 (+ scheduler 0.27) | 19.2.0, 19.2.8 | `React192Adapter` |
| `/19.3` | 19.3.x | react-reconciler 0.34.0 (+ scheduler 0.28) | 19.3.0 | `React193Adapter` |

Each subpath also exports its class as `React19Adapter` (the name the contract and the facade use), the abstract
shared base as `React19AdapterBase`, its audited `EPOCH` facts and the public types. its-fine 2.1.1 is bundled into
every subpath. `react` is the only peer.

- **Peer range (D5).** `react` is `19.0.0 || 19.0.8 || 19.1.0 || 19.1.9 || 19.2.0 || 19.2.8 || 19.3.0`: exactly the
  versions the fixtures run. A unit test keeps it equal to the union of the subpaths' `EPOCH.testedReact`.
- **Composition check.** Each subpath's `checkEnvironment()` reads `React.version` and rejects another minor with a
  `CompatibilityError` (`UNSUPPORTED_TUPLE`, `expected.react` such as `19.2.x`, `actual.react`). The message names
  the subpath to import instead. The check never selects an adapter.
- **Certification.** Each manifest's `certification` names the tested React versions, the bundled reconciler and
  its-fine. All rows stay *candidate-not-certified* until the issue-13 matrix runs them with a real scene in a
  browser.
- **Scheduler.** Each subpath bundles the scheduler its reconciler depends on, so no package manager can pair a
  reconciler with another scheduler line. React DOM keeps its own scheduler; the two do not share queues.

## What each epoch implements

The shared base class `React19Adapter` holds the bindings and the mutation operations, which forward to the root's
core `SceneBridge`. Each epoch subclass builds its **own** host config and root factory, typed against declarations of
its own reconciler (`src/reconcilers/react-reconciler-0.3x.d.ts`, written from the installed bundle; no
`@types/react-reconciler`, no cast to another epoch's config).

| | 19.0 (0.31) | 19.1 (0.32) | 19.2 (0.33) | 19.3 (0.34) |
| --- | --- | --- | --- | --- |
| `createContainer` argument 10 | `transitionCallbacks` (`null`) | `transitionCallbacks` (`null`) | `onDefaultTransitionIndicator` | `onDefaultTransitionIndicator` |
| Commit suspension | `startSuspendingCommit()`, `suspendInstance(type, props)` | same as 0.31 | suspended-state object; `maySuspendCommitOnUpdate`, `maySuspendCommitInSyncRender`, `getSuspendedCommitReason` | same as 0.33 |
| Priorities | get/set/resolve update priority (DOM event mapping of the baseline) | same | same | same |
| `trackSchedulerEvent` | not read | read, never called (no-op) | called (no-op) | called (no-op) |
| `resolveEventType` / `resolveEventTimeStamp` | read, never called | read, never called | called | called |
| Fragment refs | — | gated off (stub throws) | gated off (stub throws) | **rejected**: `CAPABILITY_MISSING` (`react.fragment-ref`) |
| ViewTransition | — | gated off (stub throws) | gated off (stub throws) | **rejected**: see below |
| Measure/viewport hooks | — | — | — | implemented as part of the ViewTransition rejection |
| Activity | — | — | hide/unhide through `setHidden`; parent Activity bridged | same as 19.2 |
| `afterActiveInstanceBlur`, `clearSingleton` | read (unreachable) | no longer read, not supplied | — | — |

**Host-key audit.** Every epoch lists the keys its bundle reads but a mutation-only, non-hydrating renderer cannot
reach (hydration, persistence, resources, singletons, test selectors, text instances, gated features), each with its
reason. `test/hostKeys.test.ts` extracts every `$$$config.<key>` the installed development and production bundles
read and fails unless *implemented ∪ unreachable* equals that set exactly, with no overlap and no implemented key
the bundle does not read. A reconciler bump that adds, removes or renames a host key therefore fails a test.

**Root argument 10.** `test/rootFactory.test.ts` reads the `createContainer` parameter names from each installed
bundle (argument 10 is `transitionCallbacks` in 0.31/0.32 and `onDefaultTransitionIndicator` in 0.33/0.34), records
the arguments each epoch's factory passes, and asserts that the 19.2 and 19.3 factories pass their
`onDefaultTransitionIndicator` function there. It also runs the 19.0 factory through the 19.2/19.3 assertion and
expects it to fail, so reusing the 19.0 shape cannot pass. The indicator does nothing: a scene has no browser
loading indicator.

### Unsupported React 19.3 features fail clearly

The scene provides neither fragment instances nor view transitions, and DOM ViewTransition animation is not
promised (see the [architecture](../../design/adapter-architecture.md#epoch-implementation-plan-and-scope-decision)):

- A `ref` on a `<Fragment>` throws `CompatibilityError` (`CAPABILITY_MISSING`, capability `react.fragment-ref`) when
  React creates the fragment instance. React routes it to the nearest error boundary or `onUncaughtError`.
- A `ref` or an event callback on `<ViewTransition>` throws `CAPABILITY_MISSING` (`react.view-transition`) the same way.
- A transition that would animate a `<ViewTransition>` reports `CAPABILITY_MISSING` (`react.view-transition`) through
  `onRecoverableError` and commits without animation. Throwing from the reconciler's `startViewTransition` would
  abandon the commit, so the adapter reports and then runs the mutation, layout and spawned-work callbacks
  synchronously, as a renderer without view transitions does.

19.1 and 19.2 read the fragment-instance and view-transition hooks, but their stable bundles never call them (a
test-backed audit fact). The two creation hooks are stubbed to throw the same errors if a bundle ever reached them.

### Activity (19.2+)

- `<Activity mode="hidden">` inside the scene tree hides its host nodes through the session's `setHidden` (the user's
  `visible` is restored on reveal) and disconnects their layout and passive effects (`useTick` unsubscribes);
  revealing reconnects them. The nodes are not destroyed.
- `<Activity mode="hidden">` in the React DOM tree around an `Application` keeps the application and its scene state
  and hides the scene: the epoch wraps the scene root in its-fine's `useActivityBridge`. `Application` ties its
  teardown to an insertion effect, which React does not disconnect when Activity hides a subtree, so hiding never
  disposes the root.

## Roots, `Application` and hooks

The bindings follow [`design/contract/react-19.d.ts`](../../design/contract/react-19.d.ts):

- **`createRoot(target, options)`** returns a `Root` with `status`, `applicationState`, `render(children, options)`
  and `unmount()`. `options` holds the root callbacks (`onInit`, `onInitError`, `onUncaughtError`, `onCaughtError`,
  `onRecoverableError`, `identifierPrefix`); every other key is a scene destroy option passed to the scene on
  teardown. A second `createRoot` for the same target or its canvas returns the same root and warns.
- **`render`** initializes on the first call (later options are mutable application props), commits after `onInit`,
  in call order, and resolves with the app after **its own commit**. It rejects with `INIT_FAILED` after a failed
  initialization and with `ROOT_DISPOSED` when the root is unmounted first; nothing commits after unmount.
- **`unmount`** renders `null` synchronously, lets core destroy every node once and dispose the session, and
  resolves after cleanup. Repeated calls return the same promise.
- **`Application`** creates its root on its canvas and renders its children through the context bridge. An
  initialization failure goes to `onInitError` (default `console.error`), never to an unhandled rejection. Destroy
  options use the upstream prop names `destroyOptions` and `rendererDestroyOptions`. The root error props default to
  `console.error`. Unmount is deferred by one turn, and a StrictMode remount of the same canvas cancels it.
- **`useApplication`** checks the provider's runtime token (not `instanceof` an application class): it throws
  outside an application, and throws `react-19.FOREIGN_RUNTIME` inside another runtime's application.
- **`useTick`** takes a callback or `{ callback, context, isEnabled, priority }`; the subscription goes through core
  and its cleanup removes exactly that callback and context.
- **`extend`, `useExtend`, `applyProps`** forward to the runtime registry and the scene's standalone `applyProps`.
- **`component(Ctor, name?)`** registers the constructor through `registry.define` and returns one stable component
  per type name (refs pass through as React 19 props).
- **`useContextBridge()`** captures the parent tree's contexts for a separate root. It must run below a
  `ContextBridgeProvider` (also returned by the bindings; `Application` includes one) and otherwise throws an error
  saying so.

### Differences from the contract sketch

- Each subpath's `React19Adapter` is the concrete epoch class; the abstract shared base is `React19AdapterBase`.
- The bindings add `ContextBridgeProvider`: React exposes no current fiber to a hook, so `useContextBridge` needs a
  provider above the calling component.
- `RootOptions` makes the scene's destroy options optional (`Partial<S['destroy']>`), and `ApplicationProps` merge
  the scene's init options with its mutable application props.
- Adapter-owned error codes use the `react-19.` namespace (`react-19.FOREIGN_RUNTIME`).

## Issue-9 defects fixed

The baseline facade binding attributed these to issue 9. Since issue 10 the facade (`packages/react`) composes the
19.3 epoch and inherits these repairs (the owner's D4 ruling on failure paths); every epoch here passes the scenarios
with no expected failure:

| Scenario | Fix |
| --- | --- |
| `Application.init.failure-no-unhandled-rejection` | Render rejections are handled; the failure goes to `onInitError`. |
| `Application.init.failure-unmount`, `Application.init.failure-isolated` | A failed root is disposed on unmount and releases its target; nothing is parked. |
| `Application.init.unmount-before-init.no-late-commit`, `.no-oninit` | Core waits for the pending init, never calls `onInit` and rejects queued renders; nothing commits late. |
| `Application.lifecycle.strict-mode-children-after-init` | Every render is scheduled after `onInit`, including the StrictMode replay. |
| `createRoot.render-resolves-after-commit` | `render` resolves from the reconciler's commit callback. |
| `createRoot.unmount` | `Root.unmount()` exists and tears the root down once. |

## Packaging (D6) and isolation

`scripts/build.mjs` emits declarations with `tsc`, then bundles each `src/<epoch>/index.ts` with esbuild into **one**
CommonJS file, `dist/<epoch>/index.js`, with only `react` and `@pixi-react-provisional/core` external. It then
generates `dist/<epoch>/index.mjs`, which imports that file and re-exports each name, and `index.d.mts`, which
re-exports the CJS declarations. Declarations not reachable from a subpath entry (each epoch's internal host-config
module) are removed, so no published declaration names a module the package does not ship.

- `test/dist.test.ts` runs plain Node against the built package through its `exports` map. For each subpath it checks
  that `import` and `require` give identical values, that one implementation file loads, and that no
  `react-reconciler` module is resolved at runtime. It also checks that each bundle contains only its own
  reconciler, and that the `exports` map has only the four subpaths.
- `pnpm check:graph` (the shared `scripts/check-dependency-graph.mjs`, allowing only `react` and core) scans every
  emitted JS and declaration file. It fails on any other import, and on any mention of `pixi.js`, `@pixi/*`,
  `react-dom`, `react-reconciler`, `scheduler` or `its-fine`.

## Fixtures: one workspace package per audited React version

`fixtures/react-<version>/` pins one audit tuple exactly: `react`, `react-dom`, `@types/react` and
`@types/react-dom`. Before it runs, the fixture copies the **built** package into its `.installed/node_modules`, so
the bundle resolves the fixture's own React (a workspace symlink would resolve this package's dev React).
`fixtures/shared/` holds the suite every fixture runs:

- the whole conformance catalogue (`describeConformance`) through `createRenderer` with the fake scene adapter, with
  no expected failures;
- the installed tuple: the exact React and react-dom versions, the manifest, and rejection of every other subpath;
- React behaviour the adapter owns: callback-ref cleanup, layout and passive effect order and cleanup before
  destruction, a DOM context crossing into a `createRoot` tree through the public `useContextBridge`, the
  runtime-token check, Suspense hide/unhide, unmount during a pending render and during a suspended transition, and
  all three root error callbacks;
- on 19.2+, Activity inside the scene and a React DOM Activity around `Application`; on 19.3, the fragment-ref and
  ViewTransition rejections;
- a compile-only consumer probe (`typeProbe.tsx`) that each fixture typechecks against its own `@types/react` line.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/react-19 build` | Declarations, the four bundles and their ESM wrappers |
| `pnpm --filter @pixi-react-provisional/react-19 test:unit` | Typecheck, host-key audit, root-factory, environment and built-package tests, then `check:graph` |
| `pnpm --filter "./packages/react-19/fixtures/*" test:conformance` | The suite against all seven React versions (part of `pnpm test:conformance`) |
| `pnpm --filter "./packages/react-19/fixtures/*" typecheck` | The fixtures and consumer probe against each `@types/react` line (part of `pnpm test:types`) |
