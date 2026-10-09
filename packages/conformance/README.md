# Renderer conformance suite

Private workspace package (`@pixi-react-provisional/conformance`, never published). It makes behavioural
parity measurable before runtime code is extracted into modular packages
([issue 6](https://github.com/baseten/pixi-react/issues/6)). It holds three things:

- **Scenarios** (`src/scenarios/`): reusable, scene-neutral React scenarios with their expected outcome.
  [`FEATURE-MAP.md`](FEATURE-MAP.md) maps every public feature of the facade to its scenarios.
- **A fake Pixi backend** (`src/fake-pixi/`, exported as `@pixi-react-provisional/conformance/fake-pixi`):
  plain-data nodes, a manual ticker, an application with an asynchronous `init`, and a `FakePixiSession`
  shaped after the contract's `PixiSession` (sole owner of node construction and destruction).
- **A runner** (`src/runner.ts`): `describeConformance(binding)` registers every scenario with Vitest
  against one binding.

The package imports no adapter and no scene library. Scenarios see the scene only through the binding's
`PixiProbe`.

## Bindings

A binding is a factory. Each scenario calls `binding.create()` and gets a fresh, fully observable
`Composition`: the React-facing API (`Application`, `createRoot`, `extend`, hooks, `applyProps`), element
types for the built-in kinds, deterministic application options, and a `PixiProbe` whose `PixiJournal`
records every construction, destruction, initialization and app teardown. This follows the historical
prototype's "rebuild the composition with spies" test pattern. `dispose()` restores any global state the
composition touched.

```ts
import { describeConformance, type ConformanceBinding } from '@pixi-react-provisional/conformance';

const binding: ConformanceBinding = {
    id: 'react-19.3 + pixi-8',
    capabilities: ['react.19', 'dom.resize'],
    expectedFailures: {},
    create: () => buildSpiedComposition(), // e.g. createRenderer({ react, pixi }) plus a probe
};

describeConformance(binding);
```

Current bindings:

| Binding | Where | Runs in |
| --- | --- | --- |
| Default facade, `@pixi/react` from `packages/react`: the composed React19Adapter (19.3) and Pixi8Adapter behind upstream's API | `packages/react/test/conformance/facadeBinding.ts` | Vitest browser mode, Playwright Chromium |
| Explicit factory: `createRenderer({ react: new React19Adapter() /* 19.3 */, pixi: new Pixi8Adapter() })`, without the facade's parity shims | `packages/react/test/conformance/explicitBinding.ts` | Vitest browser mode, Playwright Chromium |
| Fake renderer over the fake Pixi backend (a test double, not an adapter) | `test/fake-binding/` | jsdom |
| Core + renderer: `createRenderer({ react, pixi })` with a fake React 19 adapter and the fake Pixi adapter | `test/core-binding/` | jsdom |
| Core + renderer + the real `Pixi8Adapter`, driven by the same fake React 19 adapter, on pixi.js 8.2.6 and 8.22.0 | `packages/pixi-8/test/browser/` | Vitest browser mode, Playwright Chromium |
| Each React 19 minor package (`@pixi-react-provisional/react-19.0` … `react-19.3`, built) with the fake Pixi adapter, once per audited React version | `packages/react-19.<minor>/fixtures/` (shared suite in `packages/react-shared/fixtures/react-19/`) | jsdom |
| React 18: `createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() })` from the packed packages, with React 18.3.1 and the Pixi 8 adapter's probe, on pixi.js 8.2.6 and 8.22.0 | `packages/react-18/fixtures/` | Vitest browser mode, Playwright Chromium |

The second binding shows that the interface is not shaped around the facade. The second and third bindings both
host the committed negative controls.

The React 19 epoch bindings ([issue 9](https://github.com/baseten/pixi-react/issues/9)) reuse the fake Pixi
adapter and the fake probe (`@pixi-react-provisional/conformance/fake-probe`) with the real adapters; see
[the react-19.3 README](../react-19.3/README.md#fixtures-one-workspace-package-per-audited-react-version).

The core binding ([issue 7](https://github.com/baseten/pixi-react/issues/7)) composes the real
`@pixi-react-provisional/core` and `@pixi-react-provisional/renderer` builds with two adapters:

- `FakePixiAdapter`, a core `PixiAdapter` over the fake backend, exported as
  `@pixi-react-provisional/conformance/fake-pixi-adapter`.
- `src/fake-react/adapter.tsx`, a `ReactAdapter` test double over react-reconciler 0.31, exported as
  `@pixi-react-provisional/conformance/fake-react-adapter` so Pixi adapters (issue 8) can be bound before the
  real React adapter (issue 9) exists. Every render passes the complete application props to
  `PixiBridge.updateApplication`; the scene decides which of them are mutable.

The React adapter double owns only React concerns. Registry lookups, node ownership and destruction, roots, target
leases, and init and teardown ordering all go through core.

The binding provides `react.19` and `dom.resize`. Scenarios that need `pixi.globals` (bound by the Pixi 8
binding), `react.18` (bound by the React 18 binding) or `parity.upstream` are skipped by capability, and the runner names the
missing capability in the title. The binding lists no expected failures. `createRoot.same-element`, an issue-7
defect of the baseline facade, passes here because core maps an element target and its canvas to one root.

The Pixi 8 binding ([issue 8](https://github.com/baseten/pixi-react/issues/8)) provides `react.19`,
`pixi.globals` and `dom.resize`, and lists no expected failures: every issue-8 defect of the baseline facade passes there. It does not provide `parity.upstream`, because the modular adapter ships the corrected extension and
default-text-style behaviour (D4).

A second core binding selects `registryConflict: 'replace'`, the policy the facade uses for D4 parity, and runs
`extend.replace-name`.

The default facade binding ([issue 10](https://github.com/baseten/pixi-react/issues/10)) provides
`react.19`, `pixi.globals`, `dom.resize` and `parity.upstream`, and lists no expected failures: the
sixteen baseline defects pass through the composed adapters (the owner approved their failure-path repairs for the
facade), and every parity scenario passes through the facade's shims. The explicit-factory binding composes the same
pair with `createRenderer` and runs every scenario except the `parity.upstream` and React 18 ones, with no expected
failures.

### Capabilities, kinds and expected failures

- A scenario lists the capabilities it needs (`react.18`, `pixi.globals`, `dom.resize`,
  `parity.upstream`). The runner skips it, naming the missing capabilities, when a binding lacks one. The
  React 18 scenarios (ConcurrentRoot, recoverable-error routing, rejection of React 19-only root callbacks)
  run in the React 18 binding ([issue 12](https://github.com/baseten/pixi-react/issues/12)), which provides
  `react.18`, `pixi.globals` and `dom.resize`, lists no expected failures, and skips only the five
  `parity.upstream` scenarios. A React 19 capability React 18 lacks (such as `react.activity`) is never
  provided by that binding, so a scenario requiring it is skipped by capability, never listed as an expected
  failure.
- **contract** scenarios state required behaviour. **parity** scenarios record current upstream behaviour
  that decision D4 keeps in the facade (global extension and default-text-style behaviour, silent `extend`
  replacement, constructor option keys); they need `parity.upstream`.
- A confirmed defect is listed in the binding's `expectedFailures` with a reason, a `match` for the error
  the scenario must keep failing with, and the issue that owns the fix. The test fails if the scenario
  starts passing or fails differently. A discovered bug is never written into a scenario as desired
  behaviour, and a scenario is never disabled to get a green run.

## Determinism

Assets are generated locally (a 4×4 canvas texture, a graphics context). Tickers are advanced manually
through the probe (`autoStart: false`, no shared ticker). Assertions read scene state and the journal, never
pixels. There are no timed sleeps: scenarios wait on explicit promises (`onInit`, init gates) inside `act`.
Three helpers yield macrotasks with a zero delay: `yieldTask` (one task, so a host can report unhandled
rejections), `actUntil` (one task inside an act scope, so renderer continuations after a promise are
flushed) and `waitFor` (until a condition driven by React's own scheduler holds, bounded by a task count).

## Commands

| Command | What runs |
| --- | --- |
| `pnpm test:conformance` | The suite against the facade and the Pixi 8 binding in Chromium, and against the core + renderer binding in jsdom (Turbo task `test:conformance`) |
| `pnpm test:e2e` | The existing browser tests plus the same conformance suite |
| `pnpm test:unit` | Includes this package's fast tests: the fake and core binding runs, runner semantics, the scenario catalogue and the negative controls |

The facade run is part of `test:e2e` so the existing CI E2E job runs it without a workflow change (workflow
edits need owner approval). `pnpm test:conformance` runs it alone.

`FEATURE-MAP.md` is generated by `renderFeatureMap(facadeBinding)`; a facade unit test fails when it is
stale. Regenerate it with `pnpm --filter @pixi/react exec vitest run test/unit/featureMap -u`.

## Negative controls

`test/negative-controls.test.ts` runs selected scenarios against fake bindings with one injected fault each
(event handlers left attached on removal, nodes destroyed twice, tick listeners never removed) and asserts
the scenarios fail with the expected assertion while passing on the clean binding.
