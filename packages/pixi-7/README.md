# @pixi-react-provisional/pixi-7

The Pixi 7 adapter ([issue 16](https://github.com/baseten/pixi-react/issues/16)). `Pixi7Adapter` extends core's
`PixiAdapter` and implements the [adapter contract](../../design/adapter-architecture.md) against pixi.js 7. It is the
second Pixi adapter, next to [`pixi-8`](../pixi-8/README.md): the same core, renderer and React adapters (React 18 and
every React 19 minor) compose with either, and nothing outside this package changed to support Pixi 7. It imports only
`pixi.js` and core; it has no React, `react-reconciler` or its-fine dependency (its types-only `./jsx` entries name
`@types/react`, an optional peer). The package is private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React18Adapter } from '@pixi-react-provisional/react-18'; // or a React 19 minor's package
import { Pixi7Adapter } from '@pixi-react-provisional/pixi-7';
import { Container, Sprite } from 'pixi.js'; // pixi.js 7.4.x

export const { Application, extend, useApplication, useTick, createRoot, component } =
    createRenderer({ react: new React18Adapter(), pixi: new Pixi7Adapter() });

extend({ Container, Sprite });
```

## Install and versions

**This package releases at the facade's version, not at a Pixi version.** Every published package of this repository
releases in lockstep at `@pixi/react`'s version and depends on core at exactly that version
([release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md#lockstep-versions)). Release 1 is
8.1.0 for all of them, so this package will be `8.1.0` even though it targets Pixi 7. The `@pixi/react` facade itself
stays on Pixi 8: it composes the Pixi 8 adapter, and its major tracks the Pixi 8 major. Pixi 7 is available only
through the explicit `createRenderer` composition.

```sh
npm install @pixi-react-provisional/renderer@8.1.0 @pixi-react-provisional/react-18@8.1.0 @pixi-react-provisional/pixi-7@8.1.0 pixi.js@7.4.3 react@18.3.1 react-dom@18.3.1
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target
`@pixi/react-pixi-7`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)).

## Supported Pixi versions

| | |
| --- | --- |
| Peer range | `>=7.4.2 <7.5.0` |
| Tested exactly | 7.4.2 (floor) and 7.4.3 (the newest 7.x release, npm's `latest-7.x`): every release in the range |
| Evidence | The #3 audit's probe tuples `pixi-7.4.2` and `pixi-7.4.3` (`design/compatibility/seed.json`, `pixiEpochs.pixi7`: line 7.4, minimum 7.4.2, current 7.4.3). Both install, run and typecheck cleanly, and record `asyncInit: false`, `particleContainer: true`, `particle`, `renderLayer`, `domContainer` and `cacheAsTexture` false. 7.4.2 is the first-party floor of the audit (`floors["pixi.js"]`); earlier Pixi 7 minors are out of scope (issue 20: community packages) |
| Status | **Tested** (7.4.2 with React 18.3.1 and 7.4.3 with React 19.3.0 on every pull request) and **verified on WebGL**: the [2026-10-10 verification record](https://github.com/baseten/pixi-react/blob/main/design/compatibility/verification/2026-10-10.md) passed 7.4.2 and 7.4.3 with every React adapter at both audited patches. Pixi 7 has no WebGPU renderer. The record ran on software rendering (SwiftShader, no GPU); a run on a real GPU can be added as extra evidence. Verification is evidence, not a support guarantee ([tested and verified](https://github.com/baseten/pixi-react/blob/main/design/release.md#tested-and-verified)) |

`checkEnvironment()` rejects any other installed `pixi.js`, including Pixi 8 (the message names the Pixi 8 adapter) and
pre-releases, with `CompatibilityError` `UNSUPPORTED_TUPLE`, before anything is allocated. `adapter.manifest.pixi`
records the range, bounds, tested versions, the installed version and the Pixi 8 capabilities it never provides.

Beside pixi.js 8, npm's strict peer check refuses the install (`ERESOLVE`). A consumer that ignores peers gets that
`UNSUPPORTED_TUPLE` error at composition through `require`; through `import`, the ESM linker fails first, naming a Pixi 7
export that pixi.js 8 lacks (`SimpleMesh`, `SimpleRope`, `SimplePlane`, `FXAAFilter`), because the entry imports the
adapter's pixi.js exports by name. The compatibility manifest's negative cells pin both.

## Capabilities and the differences from Pixi 8

The adapter declares what it supports through core's capability mechanism. A composition that requires a capability
it does not provide (`createRenderer({ ... }, { requiredCapabilities: { 'pixi8.particle': 1 } })`) fails with
`CompatibilityError` `CAPABILITY_MISSING` before anything is allocated, and an element whose capability is missing
throws `UNSUPPORTED_NODE` naming it. Nothing is a silent no-op.

| ID | Pixi 8 adapter | Pixi 7 adapter | Meaning |
| --- | --- | --- | --- |
| `pixi.mutation`, `pixi.visibility`, `pixi.application`, `pixi.ticker` | provided | provided | The core scene protocol, which every React adapter requires |
| `pixi.globals` | provided | provided | Extension leases and the default-text-style writer registry (Pixi 7's `TextStyle.defaultStyle`) |
| `pixi8.filter` | provided | **never** | Pixi 8 filter attachment |
| `pixi7.filter` | — | provided | Filters attach to their parent's `filters`, in JSX order |
| `pixi8.particle` | 8.5+ | **never** | Pixi 8's `Particle` and `ParticleContainer.addParticle`. Pixi 7 has no `Particle` |
| `pixi7.particle-container` | — | provided | Pixi 7's `ParticleContainer`, whose children are Sprites (below) |
| `pixi8.render-layer` | 8.7+ | **never** | `RenderLayer` does not exist in Pixi 7 |
| `pixi8.dom-container` | 8.9+ | **never** | `DOMContainer` does not exist in Pixi 7 |

`new Pixi7Adapter({ disable: ['pixi7.particle-container'] })` withholds an optional capability.

The other Pixi 7 differences, and what the adapter does with each:

| Topic | Pixi 7 | What the adapter does |
| --- | --- | --- |
| Application construction | Synchronous: `new Application(options)` creates the renderer and runs the application plugins | The session creates the application object (with its stage) when the root is created and runs Pixi 7's construction steps on it in `init`, so `app` keeps one identity from root creation on, as with Pixi 8's `init`. A plugin that throws mid-construction fails `init`; the renderer and the plugins that did initialize are destroyed |
| Canvas | `view` (Pixi 8: `canvas`) | The root's canvas is passed as `view`; `view` is not an option |
| Ticker | Callbacks get `deltaTime`, a number (Pixi 8: the `Ticker`) | `useTick` callbacks receive the number; `Pixi7Types['tick']` is `number`, so `useTick((ticker: Ticker) => …)` is a type error |
| Constructors | Positional: `new Sprite(texture)`, `new Text(text, style)` (Pixi 8: one options object) | Built-ins are constructed with their positional arguments taken from the props (below) |
| Graphics | Imperative API (`beginFill`, `drawRect`, `endFill`); shared `GraphicsGeometry`, no `GraphicsContext` | `draw` receives the Graphics node. A shared `geometry` is passed as a prop; Pixi 7 reference-counts it. The Pixi 8 `context` prop does not exist |
| `name` vs `label` | `name` | `label` (Pixi 8) is a type error and warns once at runtime |
| Events | `eventMode` (7.2+); `interactive` is deprecated | The same PascalCase `on*` handler props as Pixi 8 (Pixi 7.2 added the `on*` properties) |
| Destroy | `Application.destroy(removeView, stageOptions)`; `IDestroyOptions` are `children`, `texture`, `baseTexture` | `rendererDestroyOptions` is Pixi 7's boolean `removeView`; Pixi 8's `{ removeView }` is converted, and its other keys warn. `destroyOptions` are forwarded unchanged |
| `ParticleContainer` | A Container of Sprites, whose `render` ignores filters | It accepts only Sprite children (`sprite` role); a Container or a filter child throws `UNSUPPORTED_NODE` before any mutation |
| `BitmapText` | Adds and removes its own glyph children | JSX children are rejected; filters still attach |
| Meshes | `Mesh`, `SimpleMesh`, `SimplePlane`, `SimpleRope`, `NineSlicePlane` are ordinary Containers | They take children (Pixi 8 meshes do not) |
| `pixi.js` vs `@pixi/*` | `pixi.js` 7 re-exports the `@pixi/*` packages | The adapter binds `pixi.js`. Classes imported from `@pixi/*` are the same classes when one copy of each `@pixi/*` package is installed (the compatibility cells check that) |
| Tree shaking | `pixi.js` 7 declares no `sideEffects`, so bundlers keep nearly all of it (esbuild 0.21.5 keeps 350 pixi.js 7 modules, 475 KiB minified, for an application that imports only `Container` and `Sprite`) | The adapter imports the built-ins it treats specially by name and recognizes them by identity. That adds 9 modules (13 KiB minified, under 4 KiB gzip) to such an application |

Not in scope: the legacy `@pixi/react` 7.x API (`Stage`, `PixiComponent`, `withFilters`, `useApp`). The modular
packages expose the current API (`Application`, `extend`, `useApplication`, `useTick`, `createRoot`) on Pixi 7.

## Nodes and props

`describe(Ctor, name)` classifies a constructor; it constructs nothing:

| Constructor | Role | Accepts |
| --- | --- | --- |
| `Container` and subclasses (Graphics, meshes, ...) | `child` | `child`, `sprite`, `filter` |
| `Sprite` and subclasses (`AnimatedSprite`, `TilingSprite`, `Text`, `HTMLText` in Pixi 7) | `sprite` | `child`, `sprite`, `filter` |
| `ParticleContainer` | `child` | `sprite` (needs `pixi7.particle-container`) |
| `BitmapText` | `child` | `filter` |
| `Filter` subclasses | `filter` (needs `pixi7.filter`) | none |
| Anything else (`Texture`, `GraphicsGeometry`, `Point`, classes of another pixi.js copy such as Pixi 8) | — | `describe` throws `UNSUPPORTED_NODE` |

**Construction.** `src/construct.ts` lists each built-in's positional arguments as props:

| Built-in | Arguments |
| --- | --- |
| `Sprite` | `texture` |
| `AnimatedSprite` | `textures`, `autoUpdate` |
| `TilingSprite` | `texture`, `width`, `height` |
| `Text` | `text`, `style`, `canvas` |
| `HTMLText`, `BitmapText` | `text`, `style` |
| `Graphics` | `geometry` |
| `Mesh` | `geometry`, `shader`, `state`, `drawMode` |
| `SimpleMesh` | `texture`, `vertices`, `uvs`, `indices`, `drawMode` |
| `SimplePlane` | `texture`, `verticesX`, `verticesY` |
| `SimpleRope` | `texture`, `points`, `textureScale` |
| `NineSlicePlane` | `texture`, `leftWidth`, `topHeight`, `rightWidth`, `bottomHeight` |
| `ParticleContainer` | `maxSize`, `properties`, `batchSize`, `autoResize` |
| `Filter` | `vertexSrc`, `fragmentSrc`, `uniforms` |
| `AlphaFilter` | `alpha` |
| `BlurFilter` | `strength`, `quality`, `resolution`, `kernelSize` |
| `DisplacementFilter` | `sprite`, `scale` |
| `NoiseFilter` | `noise`, `seed` |
| `ColorMatrixFilter`, `FXAAFilter` | none |

The node is constructed with those arguments (trailing missing ones dropped, so Pixi's defaults apply), then every
other prop is assigned. A subclass of a display built-in is constructed like the nearest built-in it extends
(`class Bunny extends Sprite {}` gets `new Bunny(texture)`). Filter rows apply to the built-in filters only, and a class
with no row (`Container`, its subclasses such as a viewport, custom filters) receives one options object, as on Pixi 8:
the props without `children`, `key`, `ref`, event handlers, `draw` and dashed props. A subclass of a display built-in
whose own constructor takes something else should extend `Container` instead, or translate in its constructor.

Arguments that are also instance properties of the same meaning (`texture`, `text`, `style`, `width`, `alpha`, ...)
update in place. The others (`geometry` of Graphics, BitmapText's `style` (its style options are separate properties such as `fontName` and `fontSize`), `uvs`, `indices`, `points`, `maxSize`, `properties`,
`batchSize`, `vertexSrc`, `fragmentSrc`, `uniforms`, `strength`, `kernelSize`, `sprite`, the DisplacementFilter's
`scale`) are read once: changing or removing one warns once and keeps the node; change its `key` to recreate it.

Everything else follows the Pixi 8 adapter: dashed and point props (`position-x`, `position={{ x, y }}`), removal to
the captured or kind default (from a blank `Container`, `Graphics`, `Sprite`, `Text`, `ParticleContainer` or built-in
filter; never a custom class), PascalCase events, readonly members never written, React visibility layered over
`visible` (filters: `enabled`), and per-node state in a module-level `WeakMap`.

## Destruction, ownership and globals

`destroyNode(node, options)` is the only destruction path, once per renderer-owned node, children first. Display
objects get the options unchanged (Pixi 7's `IDestroyOptions`); filters are destroyed without options. Textures,
geometries and the Assets cache are borrowed: root cleanup never unloads them. `destroyOptions` such as
`{ children: true, texture: true, baseTexture: true }` transfer destruction to the teardown. A `GraphicsGeometry`
follows Pixi 7's own reference count: it is disposed when the last Graphics that uses it is destroyed.

`init` acquires the extension leases and the default-style writer before construction, and `destroy` releases them
after `Application.destroy`; every step runs even if one throws, and a second call does nothing. The lease table and
the writer registry are the Pixi 8 adapter's algorithms, unchanged (`src/globals.ts`; a unit test keeps the copies
identical), over Pixi 7's `extensions` and `TextStyle.defaultStyle`.

## ESM/CJS (D6) and types

The package uses core's D6 build like the Pixi 8 adapter: one CJS implementation, and an ESM wrapper that binds the
`pixi.js` module `import` loads (pixi.js 7 also ships separate ESM and CJS builds). Both entries bind only
`PIXI7_BINDING_EXPORTS`, imported by name; `bindPixi` caches per Pixi instance. Each runtime entry is one esbuild
bundle of the sources (`index.js` requires `bind.js`, so the implementation is still one module).

Only text is development-only ([issue 58](https://github.com/baseten/pixi-react/issues/58)), as in the Pixi 8 adapter:
in a production build (the application's bundler replaces `process.env.NODE_ENV` with `'production'`) the adapter's
errors carry core's short message built from their code and details, and its console warnings (a Pixi-named event
prop, a Pixi 8 property name such as `label`, a changed constructor-only argument, `draw` on a node that is not a
Graphics, a dashed prop naming a missing field, a removed prop with no default to restore, extra `removeView` options)
are not emitted. Every check runs in every build, and the behaviour the warnings describe is the same.

Every public prop type is derived from the installed pixi.js 7 declarations; none is shared with the Pixi 8 adapter.

| Type | What it is |
| --- | --- |
| `Pixi7Props<C>` | The element props of constructor `C` without React's half: its positional constructor arguments (`Pixi7ConstructorProps`, required where Pixi 7 requires them), every writable non-function instance property (`Pixi7InstanceProps`; points accept any `IPointData`), the PascalCase handlers, `draw` on Graphics, and `children?: never` on leaves (filters, BitmapText) |
| `Pixi7Types` | The adapter's `PixiTypes`: `app: Application`, `tick: number`, Pixi 7's application options and destroy options |
| `Pixi7StandardCatalog` | The public, concrete built-in nodes of pixi.js 7 |
| `Pixi7CanonicalName<K>`, `Pixi7PrefixedName<K>`, `Pixi7UnprefixedName<K>` | Element names: `HTMLText` is `pixiHtmlText`, `FXAAFilter` is `pixiFxaaFilter` |

The types-only JSX entries mirror the Pixi 8 adapter's: `./jsx` (no augmentation; `PixiCatalog` is empty until you
augment it), `./jsx/react-19` and `./jsx/react-18`. Register the catalogue you `extend`:

```ts
import type {} from '@pixi-react-provisional/pixi-7/jsx/react-18';

const catalog = { Container, Sprite, Graphics };
type Registered = typeof catalog;
declare module '@pixi-react-provisional/pixi-7/jsx' { interface PixiCatalog extends Registered {} }
```

One TypeScript program cannot hold both adapters' JSX entries (or the facade's) for the same tag: put a Pixi 7 and a
Pixi 8 composition in separate programs (D10: one React and one Pixi version per application).
`packages/type-consumers` compiles a React 19 and a React 18 consumer of this package, including rejected Pixi 8
props, options and callback signatures.

## Tests and commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/pixi-7 build` | The CJS build, the bound ESM wrapper, then the types-only JSX entries |
| `… typecheck` | The sources and tests against 7.4.2, and the sources against 7.4.3 (`tsconfig.current.json`) |
| `… test:unit` | Node tests binding 7.4.2 and 7.4.3 side by side: version bounds, node definitions and capabilities, positional construction, the global registries, the D6 entries and the built dependency graph |
| `… test:conformance` | The shared conformance suite in Chromium on 7.4.2 and 7.4.3 |
| `… test:e2e` | The conformance cells plus Pixi 7 scene tests: application construction and its failure cleanup, destroy options, the numeric ticker, positional nodes, filters, attach rules and shared resources |

The conformance binding (`test/browser/binding.tsx`) composes the real core, renderer and `Pixi7Adapter` with the
conformance package's fake React 19 adapter. It provides `react.19`, `pixi.globals` and `dom.resize`, and lists no
expected failures. Two scenarios need Pixi 8 scene features and are skipped by capability, with the capability in the
test title: `resources.graphics-context-borrowed` (`pixi.graphics-context`) and `Application.destroyOptions.forwarded`
(`pixi.renderer-destroy-options`); this package's own tests cover the Pixi 7 equivalents. The probe
(`test/browser/pixiProbe.ts`) journals application construction from a Pixi 7 application plugin and wraps the
session's `init`, because Pixi 7 has no `Application.prototype.init` to wrap.

The real React 18 adapter and every React 19 minor's adapter run the same suite with this probe, from packed packages,
in the compatibility cells ([COMPATIBILITY.md](../../design/compatibility/cells/COMPATIBILITY.md)): React 18.3.1 with
pixi.js 7.4.2 and React 19.3.0 with 7.4.3 on every pull request, and every React adapter with both nightly.
