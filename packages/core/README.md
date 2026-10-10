# @pixi-react-provisional/core

The version-independent adapter core ([issue 7](https://github.com/baseten/pixi-react/issues/7)). It implements ABI 1
of the [adapter contract](../../design/adapter-architecture.md). It has no runtime, peer or declaration dependency on
React, `react-reconciler`, its-fine or Pixi, and no dependency on any other package. React adapters
(React 19/18, issues 9/12) and Pixi adapters (Pixi 8, issue 8) build on it. Applications compose them through
[`@pixi-react-provisional/renderer`](../renderer/README.md). The package is private and provisional: nothing here is
published.

## Install

Release 1 will publish this package as 8.1.0. Every modular package releases at the same version as `@pixi/react`, and the renderer and every adapter depend on this package at exactly that version, so npm installs one copy for all of them; install all of them at one version. The adapter ABI (`CORE_ABI` here, and each adapter manifest's `abi`) is versioned separately from this package's version. Applications rarely install it directly. Add it to your own dependencies only to import from it (for example `CompatibilityError`, or the abstract adapter classes for a third-party adapter):

```sh
npm install @pixi-react-provisional/core@8.1.0
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target scope `@pixi`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). The [release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md) covers versions, install recipes, tested pairs and migration.

## What it provides

| Export | Purpose |
| --- | --- |
| `PixiAdapter<P>`, `ReactAdapter<R>` | Open abstract base classes. A third party subclasses them with its own manifest ID and types. There is no closed list of adapter names. |
| `AdapterManifest`, `CORE_ABI` | `{ abi: { major: 1, minor }, id, packageVersion, provides, requires, verification }`. |
| `validateManifest`, `validateAdapterShape`, `negotiate`, `compose` | Composition-time checks that run before any allocation, then a fresh `Runtime`. |
| `CompatibilityError` | The one shared error class. It has the built-in codes plus dotted adapter codes. |
| `TeardownError` | An `AggregateError` that teardown throws after it has run every step. |
| `Runtime`, `Registry`, `RootRecord`, `PixiBridge`, `PixiSession`, `NodeDefinition`, … | The ABI 1 protocol types. |

### Composition checks

`compose({ react, pixi }, options)` checks these, in order:

1. Each adapter implements its role's ABI 1.0 methods. The check is structural, not `instanceof`, so an adapter built
   against another installed copy of core is judged by what it implements.
2. Each manifest is well formed. Its ABI major is 1, and its ABI minor is not newer than this core's.
3. Each adapter's `requires` is met by its counterpart's `provides`, at exactly the same protocol version.
4. The consumer's `requiredCapabilities` are met by either adapter. Unknown optional capabilities are ignored.
5. Each adapter's `checkEnvironment()` passes. This is where an adapter rejects an installed tuple it does not
   support; any error other than a `CompatibilityError` is wrapped in `UNSUPPORTED_TUPLE`.

Each check throws `ABI_MISMATCH`, `CAPABILITY_MISSING` or `UNSUPPORTED_TUPLE`. The error names the adapter IDs, the
capability, and the expected and actual versions. Nothing is allocated until every check passes.

### Production builds

Every check runs and throws in every build ([issue 58](https://github.com/baseten/pixi-react/issues/58)). Only the
message text is development-only: the sources build it behind `process.env.NODE_ENV !== 'production'`, which the
published JavaScript leaves as written, so an application bundler that replaces `process.env.NODE_ENV` (as React
requires) drops the text from a production bundle. In production a `CompatibilityError` keeps its class, `code`,
`adapterIds`, `capability`, `expected`, `actual` and `cause`, and its message is built from them:

```text
ABI_MISMATCH (pixi-8; expected {"major":1}; actual {"major":2,"minor":0}). A development build (NODE_ENV !== 'production') gives the full message.
```

`UNKNOWN_ELEMENT` (an unregistered element) keeps its full message in every build. A `CompatibilityError` constructed
with an empty message gets the same message built from its details; a non-empty message is kept as given. The runtime
JavaScript is one bundled CommonJS file (`dist/cjs/index.js`); the declarations stay one per module.

### Runtime

Every `compose` call returns a new runtime. Nothing below is module-global, and two runtimes share none of it.

- **Registry.** `extend`, `register`, `resolve`, `nameOf` and `define` (`define` is the route behind
  `component(Ctor, name?)`). Names are normalized once by `PixiAdapter.normalizeName`. Registering the same name with
  the same constructor again does nothing. A different constructor throws `REGISTRY_CONFLICT` under the default
  `reject` policy. The facade can select `registryConflict: 'replace'` to keep upstream's silent replacement (D4).
  Any other policy value throws `core.INVALID_OPTION` at composition.
  `component` names never read `Ctor.name`: they come from the explicit name, the constructor's `extend` key, or a
  per-runtime `WeakMap`-assigned `component:N`. Every check throws in every build.
- **Roots.** `createRoot(target)` maps both the target and its canvas to one root. An `HTMLElement` target gets a
  new canvas that replaces its children, as in the baseline. A root moves through `new → initialising → ready |
  failed → disposing → disposed`:
  - It has one init promise and one abort signal.
  - `schedule(task)` runs work after `onInit`, in call order, and never on a failed or disposing root.
  - A task that returns a promise stays tracked until that promise settles. If teardown starts first, the
    `schedule` promise rejects with `ROOT_DISPOSED`, so it never resolves after disposal and never hangs.
  - Unmounting during init waits for the init, and then never calls `onInit` or commits late work.
  - `dispose()` returns one shared promise. It continues past a failing step and collects every failure in a
    `TeardownError`.
  - `deferDispose()` and `cancelDeferredDispose()` give StrictMode one turn to remount. Generation tokens let a
    React adapter discard stale work.
- **Target lease.** A DOM target or canvas that one runtime owns cannot be taken by another runtime: that throws
  `core.TARGET_LEASED`. The lease table is keyed by a registered symbol on `globalThis`, so separately installed
  copies of core respect it too. It holds only the owner's identity, and it is released after teardown.
  An `HTMLElement` target whose descendants include a canvas owned by any root, of this runtime or another, is
  rejected with `core.TARGET_LEASED` before its children are replaced.
- **Node ownership.** `root.pixi` (`PixiBridge`) is the only way a React adapter touches the scene. It does these
  things:
  - It records per-node metadata (owning root, definition, parent, hidden, destroyed) in the runtime's `WeakMap`,
    never on the node.
  - It checks node capabilities before the first construction.
  - It enforces attach rules and ownership before any mutation.
  - It destroys removed subtrees after the commit, children first, each node exactly once, through
    `PixiSession.destroyNode`.
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

- `ReactBindingFamily.pixi` stays `unknown`, as in the sketch, and a family writes
  `MyBindings<Extract<this['pixi'], PixiTypes>>`. Constraining `pixi` to `PixiTypes` would let a generic `bind`
  skip one cast, but every consumer type would then carry a `PixiTypes & P` intersection, which made props
  inference through `component(Ctor)` hit TypeScript's instantiation depth limit. An adapter's generic `bind` therefore
  ends with one `as Bind<R, P>`, because TypeScript cannot reduce `Extract<P, PixiTypes>` for a generic `P`.
- `PixiSession.destroyNode` and `destroy` accept `undefined` for "the Pixi adapter's default". `destroy` may return
  `void`.
- `PixiSession` has an optional `nodeDestroyOptions(destroy)` method, which gives the node options implied by the
  root's teardown options, and an optional `containerAttach` rule.
- `PixiAdapter` has `normalizeName`, `checkEnvironment` and an optional `applyProps` for standalone instances.
  `ReactAdapter` has `checkEnvironment`.
- `Runtime` adds roots, `createRoot`, `rootFor`, `nodeInfo`, `onDispose`, `capabilities` and `manifests`.
  `Registry` adds `define` and `has`. `NodeContext` also carries the root.
- `RendererOptions` adds `registryConflict` and `onUnhandledError`.
- Core raises three codes of its own in its reserved namespace: `core.TARGET_LEASED`, `core.ROOT_NOT_READY` and
  `core.INVALID_OPTION`. `core.INVALID_OPTION` is thrown at composition for a renderer option value core does not
  accept: today, a `registryConflict` other than `'reject'` or `'replace'` (or `undefined` for the default).
- Capability versions must match exactly.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/core build` | The CJS build, then the ESM wrapper |
| `pnpm --filter @pixi-react-provisional/core test:unit` | Typecheck, the fake-adapter tests, then the dependency-graph check on `dist` |
| `pnpm --filter @pixi-react-provisional/core check:graph` | Only the built-graph inspection |
