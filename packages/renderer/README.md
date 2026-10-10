# @pixi-react-provisional/renderer

The neutral composition factory ([issue 7](https://github.com/baseten/pixi-react/issues/7)). It depends only on
[`@pixi-react-provisional/core`](../core/README.md) and declares no global JSX. The package is private and provisional:
nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';

const renderer = createRenderer({ react: new SomeReactAdapter(), pixi: new SomePixiAdapter() });
// renderer: the React adapter's bindings for that Pixi adapter, plus `renderer.runtime`.
```

`createRenderer({ react, pixi }, options?)` infers the React binding family and the Pixi types from the adapter
instances, so the call site needs no type arguments. It returns `Bind<R, P> & { readonly runtime: Runtime<P> }`.

Each call works like this:

1. Validation runs first, through `compose` in core: adapter shape, manifests, the ABI, capabilities (including
   `options.requiredCapabilities`), and each adapter's environment check. A rejected pair allocates nothing and never
   reaches `bind`.
2. The call creates a new, isolated runtime. Two renderers never share constructors, roots, node metadata or scheduled
   cleanup.
3. The call runs `react.bind(runtime)`. If `bind` throws, or returns something other than an object or function,
   or returns a reserved `runtime` key, the runtime is disposed and nothing usable is returned.
4. An extensible bindings value gets `runtime` as a non-writable own property and is returned itself. A
   non-extensible one (frozen, sealed, or `Object.preventExtensions`) cannot take the property, so the result is a
   proxy of it that answers `runtime`. Every other read, write and call reaches the original: inherited methods are
   bound to it, so private fields and state writes work. On that proxy `runtime` is readable but not an own key.

`options.registryConflict` defaults to `'reject'`; any value other than `'reject'` or `'replace'` throws
`core.INVALID_OPTION`. The default facade passes `'replace'` to keep upstream's silent
`extend` replacement (D4).

## Install

Release 1 will publish this package as 8.1.0. It installs only core: no React, reconciler or Pixi. Install it with exactly the adapters you choose. They release together at the same version as `@pixi/react` and depend on each other at exactly that version, so install all of them (core, the renderer and the adapters) at one version.

```sh
npm install @pixi-react-provisional/renderer@8.1.0 @pixi-react-provisional/react-19.3@8.1.0 @pixi-react-provisional/pixi-8@8.1.0 pixi.js react@19.3.0 react-dom@19.3.0
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target scope `@pixi`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). The [release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md) covers versions, install recipes, tested pairs and migration.

## Tests

| Path | What it proves |
| --- | --- |
| `test/renderer.test.ts` | Composition, isolation of runtimes, errors raised before allocation, disposal when `bind` fails, rejection of malformed bindings, and frozen or non-extensible bindings keeping their receiver. |
| `test/dual-entry.test.ts` | D6 in plain Node: `import` and `require` return the same `createRenderer`, and core is loaded once. |
| `test/dependency-graph.test.ts` | The built JS and `.d.ts` reach only `@pixi-react-provisional/core`. |
| `test/factory-only.test.ts` | Issue 10: loading only `createRenderer` (through `import` and `require`, in plain Node) loads only the renderer and core, never a default adapter, React or pixi.js. A negative control shows the inspection detects any other loaded package. |
| `test-d/` + `scripts/check-consumer-types.mjs` | Consumer checks against the built declarations through package `exports`: `.mts` through `import` and `.cts` through `require` under NodeNext, and again under Bundler resolution. Each `@ts-expect-error` is removed in turn, and the check fails unless the guarded line then fails to compile. |

`pnpm --filter @pixi-react-provisional/renderer typecheck` runs the consumer checks after Turbo has built the
package and core. `test:unit` runs the tests and then the dependency-graph check.
