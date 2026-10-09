# @pixi-react-provisional/core

The version-independent adapter core ([issue 7](https://github.com/baseten/pixi-react/issues/7)). It implements ABI 1
of the [adapter contract](../../design/adapter-architecture.md). It has no runtime, peer or declaration dependency on
React, `react-reconciler`, its-fine or Pixi, and no dependency on any other package. Framework adapters
(React 19/18, issues 9/12) and scene adapters (Pixi 8, issue 8) build on it. Applications compose them through
[`@pixi-react-provisional/renderer`](../renderer/README.md). The package is private and provisional: nothing here is
published.

## What it provides

| Export | Purpose |
| --- | --- |
| `SceneAdapter<S>`, `FrameworkAdapter<F>` | Open abstract base classes. A third party subclasses them with its own manifest ID and types. There is no closed list of adapter names. |
| `AdapterManifest`, `CORE_ABI` | `{ abi: { major: 1, minor }, id, packageVersion, provides, requires, certification }`. |
| `validateManifest`, `validateAdapterShape`, `negotiate`, `compose` | Composition-time checks that run before any allocation, then a fresh `Runtime`. |
| `CompatibilityError` | The one shared error class. It has the built-in codes plus dotted adapter codes. |
| `TeardownError` | An `AggregateError` that teardown throws after it has run every step. |
| `Runtime`, `Registry`, `RootRecord`, `SceneBridge`, `SceneSession`, `NodeDefinition`, … | The ABI 1 protocol types. |

### Composition checks

`compose({ framework, scene }, options)` checks these, in order:

1. Each adapter implements its role's ABI 1.0 methods. The check is structural, not `instanceof`, so an adapter built
   against another installed copy of core is judged by what it implements.
2. Each manifest is well formed. Its ABI major is 1, and its ABI minor is not newer than this core's.
3. Each adapter's `requires` is met by its counterpart's `provides`, at exactly the same protocol version.
4. The consumer's `requiredCapabilities` are met by either adapter. Unknown optional capabilities are ignored.
5. Each adapter's `checkEnvironment()` passes. This is where an adapter rejects an installed tuple it does not
   support; any error other than a `CompatibilityError` is wrapped in `UNSUPPORTED_TUPLE`.

Each check throws `ABI_MISMATCH`, `CAPABILITY_MISSING` or `UNSUPPORTED_TUPLE`. The error names the adapter IDs, the
capability, and the expected and actual versions. Nothing is allocated until every check passes.

### Runtime

Every `compose` call returns a new runtime. Nothing below is module-global, and two runtimes share none of it.

- **Registry.** `extend`, `register`, `resolve`, `nameOf` and `define` (`define` is the route behind
  `component(Ctor, name?)`). Names are normalized once by `SceneAdapter.normalizeName`. Registering the same name with
  the same constructor again does nothing. A different constructor throws `REGISTRY_CONFLICT` under the default
  `reject` policy. The facade can select `registryConflict: 'replace'` to keep upstream's silent replacement (D4).
  `component` names never read `Ctor.name`: they come from the explicit name, the constructor's `extend` key, or a
  per-runtime `WeakMap`-assigned `component:N`. Every check throws in every build.
- **Roots.** `createRoot(target)` maps both the target and its canvas to one root. An `HTMLElement` target gets a
  new canvas that replaces its children, as in the baseline. A root moves through `new → initialising → ready |
  failed → disposing → disposed`:
  - It has one init promise and one abort signal.
  - `schedule(task)` runs work after `onInit`, in call order, and never on a failed or disposing root.
  - Unmounting during init waits for the init, and then never calls `onInit` or commits late work.
  - `dispose()` returns one shared promise. It continues past a failing step and collects every failure in a
    `TeardownError`.
  - `deferDispose()` and `cancelDeferredDispose()` give StrictMode one turn to remount. Generation tokens let a
    framework discard stale work.
- **Target lease.** A DOM target or canvas that one runtime owns cannot be taken by another runtime: that throws
  `core.TARGET_LEASED`. The lease table is keyed by a registered symbol on `globalThis`, so separately installed
  copies of core respect it too. It holds only the owner's identity, and it is released after teardown.
- **Node ownership.** `root.scene` (`SceneBridge`) is the only way a framework touches the scene. It does these
  things:
  - It records per-node metadata (owning root, definition, parent, hidden, destroyed) in the runtime's `WeakMap`,
    never on the node.
  - It checks node capabilities before the first construction.
  - It enforces attach rules and ownership before any mutation.
  - It destroys removed subtrees after the commit, children first, each node exactly once, through
    `SceneSession.destroyNode`.
  - It sweeps every node still owned when the root tears down.
- **`dispose()`.** Freezes new work, snapshots the roots, tears each one down, runs `onDispose` cleanup and
  aggregates the failures.

## ESM/CJS: one runtime instance (D6)

**Decision: one CommonJS implementation with a thin ESM wrapper.** `dist/cjs` is the only implementation, emitted by
`tsc`. `dist/esm/index.mjs` is generated by [`scripts/build-dual-package.mjs`](../../scripts/build-dual-package.mjs).
It does `import cjs from '../cjs/index.js'` and re-exports each named export explicitly, listed from the built module,
so Node does not rely on cjs-module-lexer heuristics. `dist/esm/index.d.mts` re-exports the CJS declarations. The
`exports` map routes `import` to the wrapper and `require` to the implementation, so both reach one module instance:
one `CompatibilityError`, one set of base classes, one runtime implementation.

Two alternatives were rejected:

- **An ESM-only implementation with a CJS wrapper.** It needs `require(esm)`, which older Node versions and some
  bundlers do not support.
- **Dual builds.** They load two copies when a consumer mixes `import` and `require` (the dual-package hazard). That
  is what D6 rules out.

The cost is that bundlers see a CJS module behind the wrapper; core is small, so tree-shaking matters little.

`test/dual-entry.test.ts` proves the mechanism. It runs plain Node, without a bundler or DOM, against the built
package through its own `exports` map, and asserts that both entries expose the same names and identical values. It
also asserts that only one implementation file is loaded, and that adapters built on different entries compose, with
errors that narrow using either entry's class.

## Differences from the contract sketch

[`design/contract/core.d.ts`](../../design/contract/core.d.ts) is the normative sketch. This implementation is a
superset of it, with these deliberate differences:

- `BindingFamily.scene` is `SceneTypes`, not `unknown`. A family then writes `MyBindings<this['scene']>` without
  `Extract`, and a generic `bind` type-checks without casts.
- `SceneSession.destroyNode` and `destroy` accept `undefined` for "the scene's default". `destroy` may return
  `void`.
- `SceneSession` has an optional `nodeDestroyOptions(destroy)` method, which gives the node options implied by the
  root's teardown options, and an optional `containerAttach` rule.
- `SceneAdapter` has `normalizeName`, `checkEnvironment` and an optional `applyProps` for standalone instances.
  `FrameworkAdapter` has `checkEnvironment`.
- `Runtime` adds roots, `createRoot`, `rootFor`, `nodeInfo`, `onDispose`, `capabilities` and `manifests`.
  `Registry` adds `define` and `has`. `NodeContext` also carries the root.
- `RendererOptions` adds `registryConflict` and `onUnhandledError`.
- Core raises two codes of its own in its reserved namespace: `core.TARGET_LEASED` and `core.ROOT_NOT_READY`.
- Capability versions must match exactly.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/core build` | The CJS build, then the ESM wrapper |
| `pnpm --filter @pixi-react-provisional/core test:unit` | Typecheck, the fake-adapter tests, then the dependency-graph check on `dist` |
| `pnpm --filter @pixi-react-provisional/core check:graph` | Only the built-graph inspection |
