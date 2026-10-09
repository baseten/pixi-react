# @pixi-react-provisional/pixi-8

The Pixi 8 adapter ([issue 8](https://github.com/baseten/pixi-react/issues/8)). `Pixi8Adapter` extends core's
`PixiAdapter` and owns every Pixi 8 behaviour of the [adapter contract](../../design/adapter-architecture.md). It is
the only package that imports `pixi.js`, and it has no React, `react-reconciler` or its-fine dependency. The package
is private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

const renderer = createRenderer({ react: new SomeReactAdapter(), pixi: new Pixi8Adapter() });
```

## Supported Pixi versions

| | |
| --- | --- |
| Peer range | `>=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0`: the audited candidate envelope minus 8.5.0, whose `ParticleContainer.destroy` fails (fixed by 8.5.2) |
| Tested exactly | 8.2.6 (floor), 8.9.2 (particles before the 8.10 change), 8.22.0 (newest certified) |
| Not probed | 8.5.1 and every patch not listed above. Under D5 only the tested versions are evidence; issue 13 owns the matrix certificate |

`checkEnvironment()` rejects an installed `pixi.js` outside the range, the excluded 8.5.0 and any pre-release with
`CompatibilityError` `UNSUPPORTED_TUPLE`, before anything is allocated. The range, bounds, tested versions, the
installed version and the detected features are recorded in `adapter.manifest.pixi`.

## Capabilities

| ID | Provided when | Meaning |
| --- | --- | --- |
| `pixi.mutation`, `pixi.visibility`, `pixi.application`, `pixi.ticker` | always | The core scene protocol |
| `pixi.globals` | always | Extension leases and the default-text-style writer registry below |
| `pixi8.filter` | always | Filters attach to their parent's `filters` |
| `pixi8.particle` | `Particle` and `ParticleContainer` exported (8.5+) | Particles attach through the ParticleContainer API |
| `pixi8.render-layer` | `RenderLayer` exported (8.7+) | A RenderLayer node |
| `pixi8.dom-container` | `DOMContainer` exported (8.9+) | A DOMContainer node |

Features are detected from the installed module's exports. `new Pixi8Adapter({ disable: [...] })` withholds optional
capabilities. Registering a node whose capability is missing throws `UNSUPPORTED_NODE` naming the capability; it is
never a silent no-op.

## Nodes

`describe(Ctor, name)` classifies a constructor into a `NodeDefinition`. It constructs nothing:

| Constructor | Role | Accepts | Tree operations |
| --- | --- | --- | --- |
| `Container` subclasses | `child` | `child`, `filter` | `addChild`, `addChildAt`, `removeChild` |
| `Mesh`, `MeshPlane`, `MeshRope`, `MeshSimple`, `PerspectiveMesh` and subclasses | `child` | `filter` | As a container, for the node's own attachment and its filters |
| `SplitText`, `SplitBitmapText` (present on 8.22.0) and subclasses | `child` | `filter` | As a container, for the node's own attachment and its filters |
| `Filter` subclasses | `filter` | none | The parent's renderer-attached filter list, in JSX order. Reordering looks up the parent's list |
| `ParticleContainer` | `child` | `particle`, `filter` | As a container |
| `Particle` (not a Container) | `particle` | none | `addParticle`, `addParticleAt`, and removal with explicit indices (below) |
| `RenderLayer` | `child` | none | As a container. Layer membership stays imperative, through a ref (`layer.attach(node)`) |
| `DOMContainer` | `child` | none | As a container |
| Anything else (`Texture`, `GraphicsContext`, `Point`, plain classes) | — | — | `describe` throws `UNSUPPORTED_NODE`. Resources are passed as props |

Core checks attach rules before any mutation, so a Particle outside a ParticleContainer, a Sprite inside a
ParticleContainer or a JSX child of a RenderLayer throws `UNSUPPORTED_NODE` and leaves the tree unchanged. Every
registry check throws in every build; there are no development-only invariants.

**8.10 `removeParticles`.** Before 8.10, `removeParticles(begin, end)` passed `end` to `splice` as a delete count, and
`removeParticles(begin)` removed nothing. From 8.10, `end` is an end index and omitting it removes everything to the
end. The adapter never calls it without both indices, and converts `[begin, end)` to the installed version's meaning.
`adapter.removeParticles(container, begin, end)` exposes the same conversion.

**Leaf classes.** Some Container subclasses own their children or do not support any, so their JSX children are
rejected (`UNSUPPORTED_NODE`, before any mutation) while `filter` children still attach to the node's own `filters`:

| Class | Exported | Accepts | Why, and what to pass instead |
| --- | --- | --- | --- |
| `Mesh` | 8.2.6 (floor) | `filter` | Pixi sets `allowChildren = false` (`addChild` is deprecated). Pass `geometry` and `texture` as props |
| `MeshPlane` | 8.2.6 | `filter` | As `Mesh`. Needs `texture` (`verticesX`, `verticesY` optional) |
| `MeshRope` | 8.2.6 | `filter` | As `Mesh`. Needs `texture` and `points` |
| `MeshSimple` | 8.2.6 | `filter` | As `Mesh`. Needs `texture` and `vertices` |
| `PerspectiveMesh` | absent on 8.2.6, present on 8.9.2 | `filter` | As `Mesh`. `texture` and the corner options are optional |
| `SplitText`, `SplitBitmapText` | absent on 8.9.2, present on 8.22.0 | `filter` | The node generates its line, word and character children from `text`/`style` and re-adds the lines at the end on every change, displacing and re-indexing React children. Verified on 8.22.0: after one `text` update a child mounted after the lines was ahead of them. Read `lines`, `words` and `chars` through a ref |

Constructor options of these classes (`geometry`, `texture`, `points`, `vertices`, `verticesX/Y`, the split texts'
`text` and `style`) are read once by the constructor and are therefore not reapplied on update, except where the
class has a setter of that name (`texture`, `text`, `style`, and the split texts' anchors). `points` of a
`MeshRope` is a field of its geometry, so update it with the dashed prop `geometry-points` (or mutate the array
in place; Pixi's per-frame update follows a same-length replacement): a plain `points` prop on update only sets an
unused field on the rope. Removing a prop that the
constructor requires keeps the current value and warns, because no default exists and a class is never constructed to
find one; the other props return to the `Container` defaults.

Names are normalized once: `pixiSprite` and `sprite` become `Sprite`; `pixiHtmlText`, `htmlText` and `HTMLText`
become `HTMLText` (upstream's `NameOverrides`).

## Props

- **Construction.** The constructor receives one options object: the props without `children`, `key`, `ref`, event
  handlers, `draw` and dashed props. The session then applies every prop.
- **Dashed and point props.** `position-x` sets `position.x`, on mount as well as on update. Parent props are applied
  before their dashed children, and a changed parent re-applies its dashed children. Removing a dashed prop while its
  parent prop remains re-applies the parent.
- **Removal.** A removed prop returns to the value captured just before a prop first changed it. When the constructor
  took the value from the props, the captured value is not an initial value. The prop then returns to the kind
  default, read from a cached blank instance of the nearest built-in ancestor whose constructor needs no arguments
  (`Container`, `Sprite`, `Graphics`, `Text`, `TilingSprite`, `AlphaFilter`, `BlurFilter`, `ColorMatrixFilter`,
  `NoiseFilter`). Particles and base filters use explicit default tables. A custom class is never constructed to read
  a default. When no default is known, the value is kept and a warning is logged.
- **Events.** PascalCase props (`onPointerTap`) set the Pixi handler property (`onpointertap`), and removal sets it to
  `null`. Pixi-named props warn once and are ignored.
- **`draw`.** Called on mount and whenever its identity changes, only on Graphics. On anything else it warns.
- **Readonly members** (getters without setters, non-writable fields) are never written.
- **Visibility.** `setHidden` layers React visibility (Suspense, Activity) over `visible` (containers), `enabled`
  (filters) or `alpha` (particles). Unhiding restores the latest committed prop value, or the value from before the
  hide when no prop controls it.

Per-node state (kind, captured values, committed visibility, filter lists, particle parent, destroyed flag) lives in
a module-level `WeakMap`. Nothing is written onto Pixi objects except the Pixi properties that props name.

## Destruction and ownership

`destroyNode(node, options)` is the only destruction path, and core calls it once per renderer-owned node, children
first:

- **Containers** get the options unchanged. With `children: true`, Pixi also destroys children the renderer does not
  own.
- **Filters** are destroyed without options, because `Filter.destroy(true)` destroys shared GPU programs.
- **Particles** have no `destroy`. They are detached, and their texture is destroyed only when the options ask for it.

Textures, graphics contexts, `Texture.WHITE`/`EMPTY` and the Assets cache are borrowed. Root cleanup never unloads or
resets Assets. `destroyOptions` such as `{ texture: true, textureSource: true }` transfer destruction to the
teardown: core forwards them to every renderer-owned node (`nodeDestroyOptions`), and the session forwards them to
`Application.destroy`.

## Application lifecycle

- **`init(options, signal)`** acquires the global settings first (extension leases, the default-style writer). It then
  calls `Application.init` on the root's canvas. An abort before that rejects at once. An abort during it is core's to
  handle: core waits for the init, then destroys the app. A rejection releases everything acquired and destroys a
  partially created renderer. `Application.destroy` is never called on an app that did not initialize.
- **`updateApplication(props)`** receives the complete mutable props on every render: `extensions`,
  `defaultTextStyle` and `resizeTo`. Absent keys are cleared. Init-only renderer options are ignored, never copied
  onto the app.
- **`destroy({ rendererDestroyOptions, destroyOptions })`** calls `Application.destroy(rendererDestroyOptions,
  destroyOptions)` unchanged. It then releases the leases and the style writer. Every step runs even if one throws,
  the errors are thrown together, and a second call does nothing.
- **Ticker.** `subscribe({ callback, context, isEnabled, priority })` adds one wrapped listener per subscription. The
  callback receives the Pixi 8 `Ticker`, with `this` set to `context`. Its idempotent cleanup removes only that
  subscription, even when two subscriptions share a callback/context pair.

## Pixi globals

One table of each exists per loaded Pixi module, shared by every runtime of this implementation:

- **Extension leases** are reference-counted by extension identity. The first acquisition adds an extension to Pixi,
  the last release removes it, and swapping `[A]` for `[B]` adds B and removes A. A failed acquisition rolls back
  only that call's new leases. Pixi cannot report which extensions were registered directly, so an extension that a
  caller registered with Pixi directly must not also be passed to an application.
- **The default text style** follows the writer registry of the design. The last explicit writer wins per property.
  A departing writer restores the newest survivor or the baseline. An external write becomes the new baseline and
  retires earlier writers. Cleanup writes only while the property still holds what the registry installed. There is
  no per-root style isolation; explicit `Text` styles are the isolated alternative.

The default facade keeps upstream's global behaviour until the future major (D4). That is why the Pixi 8
conformance binding does not provide `parity.upstream`.

## ESM/CJS and the Pixi instance (D6)

The package uses core's D6 build: `dist/cjs` is the only implementation, and `dist/esm/index.mjs` is a generated
wrapper. pixi.js itself ships separate ESM and CJS builds, so a CJS implementation that required pixi.js would give
ESM consumers a second Pixi instance, with different classes, extension registry and text-style defaults. The
implementation therefore never imports pixi.js at runtime:

- `dist/cjs/index.js` binds the module that `require('pixi.js')` loads.
- The generated ESM wrapper binds the module that `import 'pixi.js'` loads (`"dualPackage.peerBinding"` in
  `package.json`, read by [`scripts/build-dual-package.mjs`](../../scripts/build-dual-package.mjs)).

`bindPixi` caches the bound exports, lease table and style registry per Pixi instance. Both entries therefore share
them whenever they share a Pixi instance, as in a bundler. `test/unit/dual-entry.test.ts` checks this in plain Node:
the implementation and core load once; each entry is bound to its own system's Pixi; the same Pixi instance yields the
same class through either entry; and no React package loads.

## Tests and commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/pixi-8 build` | The CJS build, then the bound ESM wrapper |
| `… typecheck` | The sources and tests against 8.2.6, and the sources against 8.22.0 (`tsconfig.current.json`) |
| `… test:unit` | Typecheck, then Node unit tests that bind 8.2.6, 8.9.2 and 8.22.0 side by side: version bounds, the global registries, node definitions, props, particles and the 8.10 semantics, the D6 entries and the built dependency graph. Then `check:graph` |
| `… test:conformance` | The conformance suite in Chromium on 8.2.6 and 8.22.0 |
| `… test:e2e` | The conformance cells plus scene tests on 8.2.6, 8.9.2 and 8.22.0: failures, shared textures, repeated cleanup, multiple apps, custom instances, filters, particles, gated special nodes and `removeParticles` |

A browser cell aliases the bare `pixi.js` specifier (in the adapter source, the probe and the tests) to a
version-pinned install (`pixi.js-8.9`, `pixi.js-current`). Set `CI=true` to run Chromium headless.

The conformance binding (`test/browser/binding.tsx`) composes the real core, renderer and `Pixi8Adapter` with the
conformance package's fake React 19 adapter, a react-reconciler 0.31 test double; the real React adapter is
issue 9. The binding provides `react.19`, `pixi.globals` and `dom.resize`, and lists no expected failures.
The facade binding attributes these defects to issue 8, and all of them pass here:

| Scenario | Defect fixed in the adapter |
| --- | --- |
| `destruction.nested`, `destruction.app-unmount-nested` | Nested nodes were never destroyed. Core now destroys every owned node once, children first, through `destroyNode` |
| `suspense.unhide-keeps-user-visibility` | Unhide forced `visible = true`; it now restores the committed value |
| `props.removal.required-constructor-argument` | Removal ran `new Ctor()`; defaults are now captured or read from a built-in ancestor |
| `props.dashed.mount` | Dashed props reached the constructor and were skipped on mount; they are now applied after construction |
| `resources.destroy-options-transfer` | `destroyOptions` never reached React-owned children; they are now forwarded to each node |
| `Application.extensions.swap` | `splice(-1, 1)` dropped the new extension; leases now diff by identity |

Since issue 10 the facade composes `Pixi8Adapter` and inherits these repairs (the owner's D4 ruling on failure paths);
it no longer lists them as expected failures. It keeps upstream's global extension and default-text-style behaviour
with a facade-side shim, not by changing this adapter.

## Differences from the contract sketch

- `Pixi8Types.options` adds `extensions`, `defaultTextStyle` and `resizeTo`, because the global settings are acquired
  before init. `appProps` is the complete mutable set, and `nodeDestroy` also accepts `boolean`.
- `Pixi8Adapter` is a bound subclass of `Pixi8AdapterBase` (see D6 above). The exported `Pixi8Adapter` is its
  constructor, and `type Pixi8Adapter` is its instance type.
- The props types port the sketch's representative override table. The complete constructor, event and children
  mapping and the JSX surface are issue 11's work.
