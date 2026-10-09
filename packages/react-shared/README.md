# @pixi-react-provisional/react-shared (private)

The code the React adapter packages share ([issue 49](https://github.com/baseten/pixi-react/issues/49)). It is a
private workspace package: it is never published and no consumer installs it. Each adapter package lists it as a
devDependency and **bundles** the sources it imports into its own `dist/index.js` at build time
([`scripts/build-react-adapter.mjs`](../../scripts/build-react-adapter.mjs)), and copies the matching declarations
into its own `dist/shared/`. Only our own code is bundled this way; third-party code (`react`, `react-reconciler`,
`its-fine`) stays a dependency or peer of the adapter package.

| Entry | Used by | Contents |
| --- | --- | --- |
| `./common` | `react-18`, `react-19.0` … `react-19.3` | What every adapter shares verbatim: the runtime-independent mutation host operations, the node → runtime `WeakMap` behind the shared reconciler, `HostContainer` (a root's record and its runtime), the DOM-event → priority mapping, `rawTextError`, timeouts |
| `./react-19` | `react-19.0` … `react-19.3` | The React 19 adapter base class (`React19AdapterBase`), the bindings (roots, `Application`, hooks, `component`, context bridge), the React 19 host operations (priorities, `commitUpdate`, `HostTransitionContext`), the fragment-ref/ViewTransition rejections and the host-key audit groups |
| `./react-19/public` | `react-19.0` … `react-19.3` | The types and values every React 19 minor package re-exports |
| `./test-support/react-19` | the React 19 packages' unit tests | The unit suite each React 19 minor package runs against its own sources and build |

`fixtures/react-19/` holds the per-tuple suite that every React 19 fixture (`packages/react-19.<minor>/fixtures/*`)
runs, including the multiple-runtime regression tests (`multipleRuntimes.tsx`) and a guard that fails any fixture
test during which React warns about multiple renderers (`multipleRenderersGuard.ts`).

React 18 shares only `./common`: its bindings, host keys, root factory and types differ from React 19's (one root
error channel, `forwardRef`, payload-based updates, its-fine 1.x), so they stay in `packages/react-18`.

## One shared reconciler per package copy

Each adapter package creates **one** reconciler for every runtime it binds (`sharedReconciler()` in its
`src/hostConfig.ts`), as React DOM has one for all its roots. That needs a host config that depends on no runtime:

- a root's container carries its runtime and its core root record (`HostContainer`);
- `createInstance` records the node's runtime in a module-level `WeakMap`, and every operation on a node (append,
  insert, remove, update, hide) finds the owning root through that runtime's core (`recordOf`); core's own node
  table stays the source of truth, so a node no runtime owns is rejected;
- `detachDeletedInstance` deletes the entry, so an instance user code still holds cannot keep a disposed runtime
  alive.

Why it matters: Pixi roots are a secondary renderer, and a secondary renderer keeps each context's current value in
one field of the context object. With a reconciler per runtime (the D2-era `react-19` package), a time-sliced
render of runtime A that yielded (a transition or a retry) left its pushed provider values in place; runtime B,
rendering before A resumed, read them and **committed A's value** (in production too), and development React warned
"Detected multiple renderers concurrently rendering the same context provider". With one reconciler, B's render
interrupts A's yielded render first.

**Remaining limit.** The reconciler is shared per *loaded package copy*. Two installed copies of the same
per-minor package (two versions, or a package manager that does not deduplicate them), or the `@pixi/react` facade
(which bundles its own copy of the react-19.3 code) next to a separately installed `@pixi-react-provisional/react-19.3`,
still have separate reconcilers, and runtimes on different copies can still interleave as above. Keep one copy per
app (deduplicate the package), as D10 already asks for React and Pixi.

## React 19 bindings: roots, `Application` and hooks

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
  per type name (refs pass through as React 19 props). Its props are `ElementProps<S, C>`: the Pixi adapter's
  `PropsOf<S, C>` plus an instance `ref` and `children` (removed when the adapter declares a leaf).
  `ComponentsOf<S, Cat>` types one such component per catalog entry, for a catalog-wide factory (issue 34).

The bindings declare no JSX. Global tags come from the Pixi adapter's types-only JSX entry for React 19
(`@pixi-react-provisional/pixi-8/jsx/react-19`, see the pixi-8 README); `component(Ctor)` needs none.
- **`useContextBridge()`** captures the parent tree's contexts for a separate root. It must run below a
  `ContextBridgeProvider` (also returned by the bindings; `Application` includes one) and otherwise throws an error
  saying so.

### Differences from the contract sketch

- Each per-minor package's `React19Adapter` is its concrete class; the abstract shared base is `React19AdapterBase`.
- The bindings add `ContextBridgeProvider`: React exposes no current fiber to a hook, so `useContextBridge` needs a
  provider above the calling component.
- `RootOptions` makes the scene's destroy options optional (`Partial<P['destroy']>`), and `ApplicationProps` merge
  the scene's init options with its mutable application props.
- Adapter-owned error codes use the `react-19.` namespace (`react-19.FOREIGN_RUNTIME`).

### Issue-9 defects fixed

The baseline facade binding attributed these to issue 9. Since issue 10 the facade (`packages/react`) composes the
react-19.3 code and inherits these repairs (the owner's D4 ruling on failure paths); every React 19 minor passes the scenarios
with no expected failure:

| Scenario | Fix |
| --- | --- |
| `Application.init.failure-no-unhandled-rejection` | Render rejections are handled; the failure goes to `onInitError`. |
| `Application.init.failure-unmount`, `Application.init.failure-isolated` | A failed root is disposed on unmount and releases its target; nothing is parked. |
| `Application.init.unmount-before-init.no-late-commit`, `.no-oninit` | Core waits for the pending init, never calls `onInit` and rejects queued renders; nothing commits late. |
| `Application.lifecycle.strict-mode-children-after-init` | Every render is scheduled after `onInit`, including the StrictMode replay. |
| `createRoot.render-resolves-after-commit` | `render` resolves from the reconciler's commit callback. |
| `createRoot.unmount` | `Root.unmount()` exists and tears the root down once. |

