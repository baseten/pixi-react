# @pixi-react-provisional/examples

The docs examples as a standalone Vite app ([issue 18](https://github.com/baseten/pixi-react/issues/18)). It is
private and never published.

- The app builds against this repository's packages through `workspace:` links: the `@pixi/react` facade
  (`packages/react/lib`) and, for one route, the explicit `createRenderer` composition (`packages/renderer`,
  `packages/react-19.3` and `packages/pixi-8`, from their `dist`). It never uses a copy from npm.
- The docs **Examples** page (`apps/docs/docs/examples.mdx`) embeds the same files. Its code tabs show each file's
  source, and its live previews run the modules, built by Docusaurus against the workspace facade.
- The examples are deterministic. The only asset is a local file (`src/assets/token.png`, drawn for this repository).
  The examples use no randomness and no clock. In test mode the ticker is stopped and advances by fixed steps.
- No route fetches anything from another origin, and nothing depends on Sandpack or CodeSandbox.

## Run it

```sh
pnpm install --frozen-lockfile
pnpm build                                                  # builds the workspace packages (and this app)
pnpm --filter @pixi-react-provisional/examples dev          # dev server on http://localhost:5180
pnpm --filter @pixi-react-provisional/examples build        # production build in dist/ (+ dist/module-graph.json)
pnpm --filter @pixi-react-provisional/examples preview      # serves dist/ on http://localhost:5180
```

The app resolves the workspace packages' built output, so run `pnpm build` again after you change a package. The dev
server pre-bundles those packages; restart it with `--force` to pick up a rebuild.

The checks:

| Command (`pnpm --filter @pixi-react-provisional/examples …`) | What it checks |
| --- | --- |
| `test:unit` | `test/catalog.test.mjs`, offline. The catalog, routes, sources and docs registry agree. The sources have no remote URL, randomness or clock. Every harness line is marked, and the docs copy (with harness lines stripped) is clean. |
| `check:bundle` | After `build`: from `dist/module-graph.json`, the facade and the modular packages come from the local build output (not a registry copy, not their sources), and the bundle has exactly one `pixi.js`, `react` and `react-dom`, at the docs pins. |
| `smoke` | After `build`: serves `dist/` and loads every route in headless Chromium, in test and interactive mode. Each route must reach a rendered first frame, with no console error, uncaught error or request outside the local server. It also exercises the test hooks a little on each route. |
| `smoke:dev` | The same smoke test against the dev server: development React, StrictMode effect replays and dev-only warnings. Needs no build of this app, only of the workspace packages. |
| `test:e2e` | `build`, `check:bundle` and `smoke` together. The root `pnpm test:e2e` runs it. |

The smoke test uses the workspace's Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` if it is installed somewhere
other than the default location; Chromium runs headless.

## Routes

Each example has its own route, `/<id>`, and `/` lists them. The ids, titles and file lists live in
[`src/catalog.json`](src/catalog.json), which the app, the docs and the tests all read.

| Route | Composition | In the docs | E2E fixture for (issue 19) |
| --- | --- | --- | --- |
| `/basic-scene` | facade | yes | scene creation; local asset loading |
| `/updates-and-events` | facade | yes | interaction-driven updates (Pixi pointer events and DOM buttons); prop updates; children added and removed |
| `/custom-components` | facade | yes | custom constructor registration (`extend` with a custom class); custom props through setters |
| `/hooks-and-ticker` | facade | yes | context and hooks (`useApplication`); `useTick`, including `isEnabled` |
| `/init-and-unmount` | facade | yes | `onInit`; unmount, mount and remount (key change) cleanup |
| `/modular-renderer` | `createRenderer` | no (the docs use the public package names; see "Migrating to 8.1") | explicit composition with `component(Ctor)`; initialization error handling (`onInitError`); a new Application after a failed one |

All six routes are fixtures for issue 19's browser tests. They supplement the adapter conformance suite, which stays
the source of version compatibility. The routes run the default React 19.3 and Pixi 8 pair.

## Test hooks

Add `?test` to a route for **test mode**:

- the Application starts with its ticker stopped (`autoStart: false`);
- the backend is fixed to WebGL, with `antialias: false`, `resolution: 1`, `autoDensity: false` and
  `preserveDrawingBuffer: true`, so the canvas can be read back.

Without `?test` the route runs normally (interactive mode). The hooks are:

- **`[data-testid="example"]`**: the route's element. Its `data-example` attribute is the route id and `data-mode` is
  `test` or `interactive`. These attributes mirror the state below: `data-status`, `data-first-frame`, `data-frame` and
  `data-init-count`. Wait for `[data-testid="example"][data-status="ready"][data-first-frame="true"]`.
- **`window.__EXAMPLE_STATE__`**: the live `ExampleState` (`src/harness/harness.ts`). It has these fields:
  - `harnessVersion`;
  - `route` and `mode`;
  - `status`: `loading`, `ready`, `error` or `unmounted`;
  - `firstFrame`: a frame was rendered after the scene became ready;
  - `frame`: the number of fixed steps taken;
  - `initCount`: the Applications initialised on this page load;
  - `scene`: the example's own reported state, for example `clicks`, `points` or `textureLoaded`;
  - `errors`: init failures, uncaught errors and unhandled rejections.
- **`window.__EXAMPLE_CONTROL__`** has these methods:
  - `step(frames)` (test mode only): advances the ticker by fixed 1/60 s steps (deltaTime 1). Each step runs the tick
    callbacks and renders.
  - `render()`: renders once without ticking, for example after a React update.
  - `stage()`: the stage tree as `{ label, x, y, rotation, scaleX, scaleY, alpha, visible, children }`. The examples
    label every node they create.
  - `state()`: a copy of the state.

A route is `ready` once three things are true:

- the Application has initialised (`onInit`);
- the scene has committed nodes to the stage;
- no report says the scene is incomplete. The basic scene, for example, reports itself incomplete until its texture
  loads.

In test mode the first frame is rendered as soon as the route is ready. In interactive mode it is the next ticker
frame.

React updates (from clicks, for example) commit asynchronously. Wait for the reported `scene` field, then call
`render()` or `step()` before reading pixels. `/modular-renderer` reaches `status: "error"` on purpose after **Fail
initialization**. **Retry** mounts a new Application. A failed Pixi `init` cannot be cleaned up (the renderer is
created before the plugin throws), so each failure leaves one WebGL context behind until the page unloads.

Bump `HARNESS_VERSION` when the shape of the state or the control changes.

## How the examples stay readable

The examples are written as a user would write them. Each line that uses the harness ends with `// @harness`, and
[`stripHarness`](src/harness/strip.js) removes those lines from the copy the docs show. The unit test fails on an
unmarked harness line, and on a docs copy that still mentions the harness. Outside the app (in the docs, for
example) `useExampleHarness` finds no provider, so it does nothing and spreads no options.

To add an example:

1. Add its files under `src/examples/<id>/`.
2. Add an entry to `src/catalog.json` and a lazy route to `src/routes.tsx`.
3. If it belongs in the docs (`"docs": true`), add its raw imports and loader to
   `apps/docs/src/components/LocalExample/registry.ts` and a `<LocalExample id="<id>" />` to the Examples page.
4. Report the scene from a component inside `<Application>` with `useExampleHarness({ ... }) // @harness`.
5. Add a check for the route in `scripts/smoke.mjs` if it needs one.

## One pixi.js in a workspace

The workspace packages keep their own dev copies of pixi.js: `packages/react`, for example, tests against an older
pixi.js. A consumer's install has one pixi.js, and the examples reproduce that:

- `vite.config.ts` dedupes `pixi.js`, `react` and `react-dom`;
- `tsconfig.json` maps the `pixi.js` types to this app's copy;
- the docs build aliases `pixi.js` to the site's copy (`apps/docs/docusaurus.config.ts`).

`check:bundle` fails if a second copy appears.

## Versions

`react`, `react-dom` and `pixi.js` are exact and equal to the current docs pins (`apps/docs/src/release-pins.json`).
`node scripts/release/docs-pins.mjs --check`, part of `pnpm test:release`, fails when they differ.
