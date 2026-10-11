# @pixi-react-provisional/react-18.1

The React 18.1 adapter: one of the four React 18 minor packages
([`react-18.0`](../react-18.0/README.md), [`react-18.1`](../react-18.1/README.md), [`react-18.2`](../react-18.2/README.md),
[`react-18.3`](../react-18.3/README.md)). `React181Adapter`, also exported as `React18Adapter`, is a `ReactAdapter`
from [`@pixi-react-provisional/core`](../core/README.md) for React 18.1. It is the React 18 adapter of
[react-18.3](../react-18.3/README.md), which documents the shared behaviour (roots, error routing, priorities,
payload-based updates, refs, the its-fine 1.x bridge, the missing React 19 capabilities), built against the
react-reconciler released with React 18.1. The package is private and provisional: nothing here is published.

```ts
import { createRenderer } from '@pixi-react-provisional/renderer';
import { React18Adapter } from '@pixi-react-provisional/react-18.1'; // React 18.1.x
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';

export const { Application, createRoot, extend, useApplication, useTick, component } =
    createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
```

## Install

Release 1 will publish this package as 8.1.0. React is a peer, limited to the exact versions this package is tested with, so install one of them exactly. `react-reconciler` and its-fine are exact dependencies and come with the package. They release together at the same version as `@pixi/react` and depend on each other at exactly that version, so install all of them (core, the renderer and the adapters) at one version.

```sh
npm install @pixi-react-provisional/renderer@8.1.0 @pixi-react-provisional/react-18.1@8.1.0 @pixi-react-provisional/pixi-8@8.1.0 pixi.js react@18.1.0 react-dom@18.1.0
```

Nothing is published yet. Release tarballs carry the public names from `release.packages.json` (target scope `@pixi`, pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). The [release policy](https://github.com/baseten/pixi-react/blob/main/design/release.md) covers versions, install recipes, tested pairs and migration.

## Bounds (D5)

| | |
| --- | --- |
| Entry | `.` only (`import` and `require`); no subpaths |
| Exports | `React181Adapter`, `React18Adapter` (the same class), `React18AdapterBase`, `EPOCH`, `REQUIRED_PIXI_CAPABILITIES`, `UNSUPPORTED_CAPABILITIES`, the public types |
| Adapter ID (manifest) | `react-18.1` |
| `dependencies` | `react-reconciler` **0.28.0** (exact; its npm peer is `react@^18.1.0`), `its-fine` **1.2.5** (exact), `@pixi-react-provisional/core` (workspace) |
| `peerDependencies` | `react`: `18.1.0` (the only 18.1 release; exactly the tested version, D5) |
| Scheduler | not a direct dependency: react-reconciler 0.28.0 brings `scheduler@^0.22.0` |

- **Composition check.** `checkEnvironment()` reads `React.version` and rejects another minor with a
  `CompatibilityError` (`UNSUPPORTED_TUPLE`, `expected.react` `18.1.x`, `actual.react`), naming the package of the
  installed minor (for example `@pixi-react-provisional/react-18.3`). The check never selects an adapter.
- **Reconciler 0.28.0.** The same host-config and root API as the other React 18 reconcilers. It reads `now` (never calling it) and the persistent-mode Offscreen keys and does not read `getSuspenseInstanceFallbackErrorDetails`; all are unreachable here and listed in `src/hostConfig.ts`.
- **Tested and verified.** The package's fixture (`fixtures/react-18.1.0/`) runs the conformance catalogue and the
  React 18 suite in Chromium with React 18.1.0 and pixi.js 8.2.6 and 8.22.0, so 18.1.0 is *tested*. React before 18.3
  has no `React.act`, which the conformance harness calls: the fixture and the compatibility cells lend React the
  `act` of `react-dom/test-utils` (a test helper; the adapter is untouched). The compatibility matrix runs it in
  the nightly tier (scheduled weekly on GitHub) against every Pixi 8 minor and every audited Pixi 7 release. The
  [2026-10-11 verification record](https://github.com/baseten/pixi-react/blob/main/design/compatibility/verification/2026-10-11.md) *verifies* React 18.1.0 on **WebGL**
  with the newest audited patch of every Pixi 8 minor (8.2.6 … 8.22.0) and with pixi.js 7.2.0, 7.2.4, 7.3.0, 7.3.3, 7.4.2
  and 7.4.3, and on **WebGPU** with pixi.js 8.2.6 … 8.22.0 (for 8.2.6 to 8.9.2 with the test shim `pixi-webgpu-texture-units`, the workaround for the known issue below). The [Apple M5 Max hardware record](https://github.com/baseten/pixi-react/blob/main/design/compatibility/verification/2026-10-11-macos-26-apple-m5-max.md) (a real GPU, Metal) verifies the same versions on both backends; the shim changed nothing there, because the Mac's WebGL reports `MAX_TEXTURE_IMAGE_UNITS` 16 (measured: the record lists 16 → 16 on every shimmed run). **Known issue:** WebGPU on pixi.js <8.10 needs the workaround for [pixijs/pixijs#11389](https://github.com/pixijs/pixijs/issues/11389) (fixed in 8.10.0 by [#11417](https://github.com/pixijs/pixijs/pull/11417)): without it, WebGPU renders a blank canvas on devices whose WebGL texture-unit count exceeds their WebGPU per-stage limit. Use pixi.js 8.10+ or WebGL. The compatibility matrix applies that workaround as a labelled test shim (`pixi-webgpu-texture-units`: WebGL's `MAX_TEXTURE_IMAGE_UNITS` clamped to 16 before Pixi initializes, on WebGPU runs of pixi.js 8.2.6 to 8.9.x only) so that it measures this project's adapters rather than the upstream bug; an application gets no such shim from these packages. The 2026-10-11 record ran on software rendering (SwiftShader, no GPU). Verification is evidence, not a support guarantee ([tested and verified](https://github.com/baseten/pixi-react/blob/main/design/release.md#tested-and-verified)).

## Code

Everything but the reconciler integration is shared with the other React 18 packages through the private
[react-shared](../react-shared/README.md) package (`react-shared/react-18`), bundled at build time by
[`scripts/build-react-adapter.mjs`](../../scripts/build-react-adapter.mjs) into one CommonJS file with an ESM wrapper
(D6). This package holds its name and version (`src/package.ts`), its `EPOCH` and concrete class (`src/index.ts`), and
its reconciler integration (`src/hostConfig.ts`: the 0.28.0 import, the eight-argument root factory, the one shared
reconciler and the host-key list), typed against declarations of 0.28.0 (`src/reconciler/react-reconciler.d.ts`).
`test/package.test.ts` runs the shared React 18 package suite (`react-shared/test-support/react-18/`): the host-key
audit against the installed 0.28.0 bundle, the root factory's arguments, the environment check and manifest, and the
built package.

## Commands

| Command | What runs |
| --- | --- |
| `pnpm --filter @pixi-react-provisional/react-18.1 build` | Declarations, the bundle and its ESM wrapper |
| `pnpm --filter @pixi-react-provisional/react-18.1 test:unit` | Typecheck, the shared React 18 package suite, then `check:graph` |
| `pnpm --filter "./packages/react-18.1/fixtures/*" test:e2e` | Packed install + tree check, then the conformance and React 18 suites on both Pixi cells (part of `pnpm test:e2e`; `test:conformance` runs the conformance suite only) |
| `pnpm --filter "./packages/react-18.1/fixtures/*" typecheck` | Packed install, then the fixture and consumer probe against `@types/react` 18.3 (part of `pnpm test:types`) |
