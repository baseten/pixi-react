# @pixi-react-provisional/renderer

The neutral composition factory ([issue 7](https://github.com/baseten/pixi-react/issues/7)). It depends only on
[`@pixi-react-provisional/core`](../core/README.md) and declares no global JSX. The package is private and provisional:
nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';

const renderer = createRenderer({ framework: new SomeFrameworkAdapter(), scene: new SomeSceneAdapter() });
// renderer: the framework's bindings for that scene, plus `renderer.runtime`.
```

`createRenderer({ framework, scene }, options?)` infers the framework family and the scene types from the adapter
instances, so the call site needs no type arguments. It returns `Bind<F, S> & { readonly runtime: Runtime<S> }`.

Each call works like this:

1. Validation runs first, through `compose` in core: adapter shape, manifests, the ABI, capabilities (including
   `options.requiredCapabilities`), and each adapter's environment check. A rejected pair allocates nothing and never
   reaches `bind`.
2. The call creates a new, isolated runtime. Two renderers never share constructors, roots, node metadata or scheduled
   cleanup.
3. The call runs `framework.bind(runtime)`. If `bind` throws, or returns something other than an object or function,
   or returns a reserved `runtime` key, the runtime is disposed and nothing usable is returned.

`options.registryConflict` defaults to `'reject'`. The default facade passes `'replace'` to keep upstream's silent
`extend` replacement (D4).

## Tests

| Path | What it proves |
| --- | --- |
| `test/renderer.test.ts` | Composition, isolation of runtimes, errors raised before allocation, disposal when `bind` fails, and rejection of malformed bindings. |
| `test/dual-entry.test.ts` | D6 in plain Node: `import` and `require` return the same `createRenderer`, and core is loaded once. |
| `test/dependency-graph.test.ts` | The built JS and `.d.ts` reach only `@pixi-react-provisional/core`. |
| `test-d/` + `scripts/check-consumer-types.mjs` | Consumer checks against the built declarations through package `exports`: `.mts` through `import` and `.cts` through `require` under NodeNext, and again under Bundler resolution. Each `@ts-expect-error` is removed in turn, and the check fails unless the guarded line then fails to compile. |

`pnpm --filter @pixi-react-provisional/renderer typecheck` runs the consumer checks after Turbo has built the
package and core. `test:unit` runs the tests and then the dependency-graph check.
