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
| `test:examples` | After `build`: `check:bundle`, then the [browser tests](#browser-tests) (functional and visual) against the production build. The root `pnpm test:examples` builds first. This is the required CI check **Examples E2E (required)**. |
| `test:examples:dev` | The functional browser tests against the dev server: development React, StrictMode effect replays and dev-only warnings. Needs no build of this app, only of the workspace packages. Runs `scripts/run-e2e.mjs dev`, which sets `EXAMPLES_SERVER=dev` portably (Windows included). |
| `test:examples:webgpu` | The WebGPU smoke test, then its report (skip reasons included); exits with Playwright's status. Not required; see [WebGPU](#webgpu). Runs `scripts/run-e2e.mjs webgpu`. |
| `test:examples:update` | Renders missing or changed visual baselines. Review them before committing; see [Visual baselines](#visual-baselines). |

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

All six routes are fixtures for the [browser tests](#browser-tests). They supplement the adapter conformance suite,
which stays the source of version compatibility. The routes run the default React 19.3 and Pixi 8 pair.

## Test hooks

Add `?test` to a route for **test mode**:

- the Application starts with its ticker stopped (`autoStart: false`);
- the backend is fixed to WebGL, with `antialias: false`, `resolution: 1`, `autoDensity: false` and
  `preserveDrawingBuffer: true`, so the canvas can be read back.

`?test&backend=webgpu` asks Pixi for WebGPU instead. Only the WebGPU smoke test uses it; it is not deterministic.

Without `?test` the route runs normally (interactive mode). The hooks are:

- **`[data-testid="example"]`**: the route's element. Its `data-example` attribute is the route id and `data-mode` is
  `test` or `interactive`. These attributes mirror the state below: `data-status`, `data-first-frame`, `data-frame` and
  `data-init-count`. Wait for `[data-testid="example"][data-status="ready"][data-first-frame="true"]`.
- **`window.__EXAMPLE_STATE__`**: the live `ExampleState` (`src/harness/harness.ts`). It has these fields:
  - `harnessVersion`;
  - `route` and `mode`;
  - `backend`: the renderer test mode asked for (`webgl` or `webgpu`), or `null` in interactive mode;
  - `renderer`: the renderer the current Application uses (`app.renderer.name`), or `null` before init, after an
    unmount and after a failed init;
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

## Browser tests

The browser tests are [Playwright Test](https://playwright.dev/docs/intro) projects in `e2e/`
([`playwright.config.ts`](playwright.config.ts)). They start their own server: `vite preview` of `dist/` on port 5181,
or the dev server on port 5182 for `test:examples:dev`. A running `pnpm dev` (5180) is never reused.

```sh
pnpm install --frozen-lockfile
pnpm test:examples                                                   # builds, then bundle check + functional + visual
pnpm --filter @pixi-react-provisional/examples test:examples         # the same, after your own `pnpm build`
pnpm --filter @pixi-react-provisional/examples exec playwright test --project=functional -g "custom"   # a subset
pnpm --filter @pixi-react-provisional/examples exec playwright show-report .playwright/report          # last report
```

Chromium comes from the pinned `@playwright/test` (`pnpm --filter @pixi-react-provisional/examples exec playwright
install chromium`). Set `PLAYWRIGHT_BROWSERS_PATH` if it is installed elsewhere. Results, traces and the HTML report go
to `.playwright/` (ignored by git). With `CI=true` there are no retries, `test.only` fails, and no baseline is written.

| Project | Required | What it covers |
| --- | --- | --- |
| `functional` (`e2e/routes.spec.ts`) | yes | Every route in test and interactive mode, plus the index and an unknown route. Per route: scene creation (stage tree, local asset), interaction-driven updates (Pixi pointer tap, over and out, DOM buttons, children added and removed), custom registration (`extend` with a custom class, props through setters), context, hooks and the ticker (`useApplication`, `useTick` and `isEnabled`, fixed steps and the real ticker), unmount, mount and key remount (the old canvas is detached and its WebGL context released), and on `/modular-renderer` a deliberate init failure through `onInitError` and a new Application after it. |
| `visual` (`e2e/environment.spec.ts`, `e2e/visual.spec.ts`) | yes | Canvas screenshots of 8 fixed states with `toHaveScreenshot`, and a guard that the environment matches the baselines'. |
| `webgpu-smoke` (`e2e/webgpu.spec.ts`) | **no** | Every route initialises, renders and ticks on Pixi's WebGPU renderer. |

Every test also fails on a console error or warning, an uncaught exception, a request to anything but the local server
(blocked), or a failed or 4xx/5xx local request (`e2e/fixtures.ts`). The assertions read the scene through the test
hooks and pixels read back from the canvas, not just the canvas's presence, and every visual case checks the scene
state before its screenshot: a renderer that draws the right pixels from a broken scene fails, and so does one with the
right scene and the wrong pixels.

After the tests, `scripts/check-report.mjs` reads `.playwright/results.json`. A required project that ran no tests, or
(with `CI=true`) skipped one, fails, so a required snapshot is never skipped silently. Skip reasons are printed, and go
to the GitHub job summary in CI.

### The pinned environment

The baselines are only valid in the environment they were rendered in; [`e2e/environment.ts`](e2e/environment.ts) pins
it and `e2e/environment.spec.ts` fails (never skips) when the run differs:

- **Browser:** the Chromium headless shell that `@playwright/test` 1.50.1 bundles (Chromium 133.0.6943.16). The
  Playwright version is exact in `package.json` and the lockfile.
- **WebGL backend:** ANGLE on SwiftShader, Chromium's CPU renderer (`--use-angle=swiftshader
  --enable-unsafe-swiftshader`), checked through `WEBGL_debug_renderer_info`. No GPU or driver takes part, so a
  developer machine and a CI runner rasterize identically. Pixi uses WebGL 2 with antialiasing off and resolution 1.
- **Page:** viewport 800x700, device scale factor 1, dark colour scheme, `en-US`, UTC.
- **OS:** Linux x64; CI runs on `ubuntu-24.04`.
- **Fonts:** none take part. The canvases contain no text, and the screenshot is of the canvas alone. While capturing,
  [`e2e/screenshot.css`](e2e/screenshot.css) pins the canvas to the viewport's top left corner, so the clip is exactly
  480x320 whatever the page's text above it measures.
- **Assets, randomness and time:** the only asset is `src/assets/token.png`, served locally. The examples use no
  randomness (`test/catalog.test.mjs` enforces it), so there is no seed to fix. The ticker is stopped and advanced by
  fixed steps.
- **Readiness:** each screenshot waits for `data-status="ready"` and `data-first-frame="true"`, drives the scene, waits
  for the reported scene state, then calls `render()`. `toHaveScreenshot` also waits for two identical captures.

### Visual baselines

The baselines are `e2e/snapshots/<project>-<platform>/<name>.png`. Only `visual-linux` is committed. On another OS,
outside CI, the visual project skips with that reason; run it in the Playwright Linux image instead (below). In CI a
non-Linux runner is a failure. `e2e/visual.spec.ts` also fails if a committed baseline has no case or a case has no
baseline.

The comparison is strict: `maxDiffPixels: 0` and `threshold: 0.01`. With antialiasing off, a shape edge covers a pixel
or does not, so any moved, missing or recoloured geometry changes whole pixels and fails on the first one. The 0.01
YIQ threshold only absorbs a rounding difference of a level or two in a channel, as texture filtering or blending
could produce; every intended colour in the examples is much further apart. Repeated runs in the pinned environment
are byte-identical (they also pass with `threshold: 0`); the threshold is a margin, not a fudge factor. If CI ever
needs more, show why in the PR.

To change a baseline after an intended visual change:

1. Run `pnpm build`, then `pnpm --filter @pixi-react-provisional/examples test:examples:update` on Linux x64. On macOS
   or Windows, use the Playwright image of the pinned version, from the root of a separate clone or worktree (the
   container installs Linux binaries into its `node_modules`):

   ```sh
   docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.50.1-noble \
     bash -c "corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm --filter @pixi-react-provisional/examples test:examples:update"
   ```

   Or run the **Examples E2E** workflow by hand (`workflow_dispatch`) with **render_baselines**: it uploads the
   baselines rendered on the CI runner as the `examples-visual-baselines-candidate` artifact. After a failed run, the
   `examples-e2e-failure` artifact also has each `*-actual.png` next to `*-expected.png` and `*-diff.png`.
2. Look at every changed PNG (`git diff --stat e2e/snapshots`, and the images themselves) and check that each change is
   the one you meant.
3. Commit the baselines with the change that caused them, and say in the PR which snapshots changed and why. A reviewer
   must look at the images before approving.

CI never writes or accepts a baseline (`updateSnapshots: 'none'` with `CI=true`): a missing or different snapshot fails
the required check. Do not regenerate baselines to make a failure go away without understanding the diff, and do not
raise the tolerances to hide one.

Bumping Playwright changes the bundled Chromium: update `e2e/environment.ts`, render the baselines again, and review
them like any other visual change.

### WebGPU

`webgpu-smoke` runs every route with `?test&backend=webgpu` in a browser launched with WebGPU on SwiftShader's Vulkan
device (`WEBGPU_ARGS`), and checks the route reaches a rendered frame on Pixi's WebGPU renderer and ticks. It takes no
screenshots: WebGPU output is not part of the deterministic baseline. When the browser has no WebGPU adapter, each
test is skipped with the reason, which the job summary shows. In CI it is a job of its own that the required check
does not depend on.

### CI

[`.github/workflows/examples-e2e.yml`](../../.github/workflows/examples-e2e.yml) runs on pull requests, merge queues,
pushes to `main` and by hand. The required job builds the library packages and this app, runs `check:bundle`, the
functional and visual projects and `check-report.mjs`, and uploads `.playwright/` (traces, screenshots,
expected/actual/diff images, the HTML report) as `examples-e2e-failure` on a failure. The aggregate job **Examples E2E
(required)** depends on that job only and is the check to require in branch protection: it fails unless the test job
succeeded, including when that job failed, was cancelled or was skipped. Timeouts: 25 minutes for the job, 15 for the
whole Playwright run, 30 s per test and 10 s per assertion.

The WebGPU smoke test is a separate job, **Examples WebGPU smoke (not required)**, with its own build and a 15 minute
timeout. Nothing required depends on it, so neither its failure nor its timeout can fail the required check.

These tests used to run as `test:e2e` (the smoke test of issue 18) inside the **E2E tests** cell of the Verify
workflow. They now run only here, so the root `pnpm test:e2e` no longer includes this app and nothing runs twice.

### Chromatic (optional, not set up)

[Chromatic](https://www.chromatic.com/docs/playwright/) can take over the visual review: its Playwright integration
(`@chromatic-com/playwright`) archives the page at each snapshot point and renders the archive in its cloud browsers,
with a hosted UI for reviewing and accepting changes. Nothing here uses it, and no service is provisioned. Before
adopting it:

- prove that Pixi's WebGL canvas pixels survive its archive and replay on representative scenes (a DOM archive does
  not necessarily carry a WebGL drawing buffer); no Storybook migration is needed;
- re-check the plans. When issue 19 was written (October 2026) the free plan listed 5,000 snapshots a month, and
  open-source projects could apply to Chromatic for sponsored use by contacting them
  ([pricing](https://www.chromatic.com/pricing)). Re-check both before relying on them;
- keep `toHaveScreenshot` as the required check until Chromatic has proven itself on this suite.

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
5. Add its tests to `e2e/routes.spec.ts`, and a visual case to `e2e/visual.spec.ts` if its pixels matter. The `every
   route` tests pick up a new catalog entry by themselves.

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
