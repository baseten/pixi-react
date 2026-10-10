# Adapter compatibility cells (issue 13)

Isolated, data-driven compatibility cells for the modular adapters, run locally and in CI with the same command. The list of cells is [generated](COMPATIBILITY.md) from the #3 seed (`../seed.json`); nothing lists a cell by hand. Cells are what makes a version **tested** (PR tier) or **verified** (the full nightly matrix passed on a render backend, recorded in a dated [verification record](../verification/); `verifiedRanges` in the seed is derived from the records). Verification is evidence, not a support guarantee.

```sh
pnpm build
pnpm test:compatibility            # PR tier: probes + cells + incompatible pairs, then the table

node design/compatibility/cells/run-cells.mjs list --tier nightly
node design/compatibility/cells/run-cells.mjs run --cell react-19.3.0_pixi-8.22.0
node design/compatibility/cells/run-cells.mjs run --negative
node design/compatibility/cells/run-cells.mjs probes --tier pr
node design/compatibility/cells/run-cells.mjs run --tier nightly --renderers webgl   # one backend only
node design/compatibility/cells/run-cells.mjs data                                   # data-only probes (data-only.json)
node design/compatibility/cells/run-cells.mjs key --cell react-18.3.1_pixi-8.2.6   # cache keys
node design/compatibility/cells/run-cells.mjs doc > design/compatibility/cells/COMPATIBILITY.md
node --test design/compatibility/cells/*.test.mjs   # offline
```

Browser cells need Chromium for the pinned Playwright (`npx playwright@1.50.1 install chromium`); set `CI=true` outside CI to run headless. Output goes to `.compat/` (git-ignored): `tarballs/`, `verdicts/`, `results/`, and `out/<cell>/` with logs, the `npm ls` dump, the lockfile, the generated project files and screenshots.

## What a cell is

A cell is one React adapter at one exact React version against one Pixi adapter at one exact pixi.js version. The runner:

1. Packs the workspace artifacts with `pnpm pack` (what a registry would serve) and records per-file content hashes (`pack`).
2. Creates a project in the OS temp directory, refuses to run when any ancestor directory has a `node_modules`, and installs only the packed tarballs plus the cell's exact `react`, `react-dom`, `@types/react`, `@types/react-dom`, `pixi.js` and the pinned toolchain, with `npm install --strict-peer-deps --ignore-scripts`. There is no workspace, no alias and no hoisting, so a missing peer or an unsatisfied declaration fails there.
3. Runs the commands listed in `adapterMatrix.commands.order`, each with its own timeout:
   - `install`: as above.
   - `tree`: `npm ls --all` must be clean; each selected package resolves to exactly one version; whatever an adapter bundles (`bundled`) must be absent, and an adapter whose reconciler is a dependency (`reconciler.via: dependency`, every React adapter since issue 49) must resolve exactly its epoch's react-reconciler; the packed `peerDependencies` must equal the manifest's `declaredPeers`.
   - `modules`: the adapter entries load through `import` and `require` in plain Node; the adapter manifest's ABI, id, `provides` and `requires` equal the manifest; the reconciler version it reports equals the epoch's; `checkEnvironment()` accepts the cell; `createRenderer` negotiates the pair; the ESM and CJS entries share one class where the manifest says they must (D6).
   - `types`: `tsc` with the cell's own TypeScript, `@types/react` and Pixi declarations over a consumer probe (Bundler resolution, JSX) and over `.mts` and `.cts` consumers (NodeNext, which selects the `import` and `require` declaration conditions). `skipLibCheck` is on, as in the #3 audit; full dependency declaration correctness is not claimed.
   - `conformance`: the whole conformance catalogue in Chromium (Vitest browser mode) against real Pixi, once per render backend of the cell (below), plus a render check per backend.

Cells use the same Pixi probe (`probeSource`) and conformance package as the package test suites; the adapter-specific suites stay in the packages' own fixtures (`pnpm test:conformance`, `pnpm test:e2e`).

## Render backends

WebGL and WebGPU are checked separately, never inferred from each other (issue 17). `adapterMatrix.renderers` gives each backend's Chromium flags; a Pixi adapter row's `renderers` gives the application options that request it (Pixi 8: `preference`; Pixi 7 has WebGL only, `rendererNote`); a tier's `renderers` says which backends it runs (PR: `webgl`; nightly: `webgl`, `webgpu`; `--renderers` overrides). The conformance command runs once per backend with `COMPAT_RENDERER` set (logs `conformance-<backend>.log`, report `conformance-<backend>.json`), and the result row records each backend under `backends`. Two harness files keep a backend honest:

- `test/renderer.ts` (a setup file) fails every Pixi 8 application whose renderer is not the requested one: Pixi 8 silently falls back to another renderer when the preferred one is unavailable.
- `test/backend.test.tsx` (the render check) draws a red rectangle, checks that the renderer is the requested one and that a screenshot of the canvas shows the rectangle, and prints a `COMPAT_BACKEND` line (renderer, WebGL renderer string or WebGPU adapter, read-backs) that the runner records.

Rendering here is software: WebGL is ANGLE on SwiftShader, WebGPU is Dawn on SwiftShader's Vulkan device, which Chromium exposes only as a fallback adapter (`isFallbackAdapter: true`) with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. Without those flags headless Chromium has `navigator.gpu` but no adapter.

## Data-only probes

`run-cells.mjs data` runs `data-only.json`: packed adapters beside a React or pixi.js they do not declare (installed with `--legacy-peer-deps`, the reconciler swapped by an npm `overrides` entry where a group names one). Every command runs and is recorded even after a failure; the conformance run bypasses the adapters' `checkEnvironment()` (cell.json `dataOnly`), and for React below 18.3 `test/data-only.ts` lends `act` from `react-dom/test-utils`. Results go to `data-results/`, are never cached and never verify anything: they appear only in the "data only, not verified" section of a verification record.

## Verification records

`node design/compatibility/verification.mjs build --work DIR --date YYYY-MM-DD --commit SHA --extra FILE` turns a nightly run's work directory (`results/`, `out/`, `data-results/`, `tarballs/`) into `../verification/<date>.json` and `.md`; `ranges --write` derives `verifiedRanges`; `compare --date D --tarballs DIR` shows whether freshly packed artifacts carry the same code as the run. `validate.mjs` fails when `verifiedRanges` differs from what the records derive or a record's Markdown is stale.

## Manifest: `adapterMatrix` in `../seed.json`

| Key | Meaning |
| --- | --- |
| `toolchain` | Exact TypeScript, Vitest, `@vitest/browser`, Playwright and Vite versions installed in every cell. |
| `commands` | Command order and per-command timeouts (seconds). |
| `renderers`, `rendererNote` | Render backends (`webgl`, `webgpu`) and the Chromium flags of each. |
| `artifacts` | Packed workspace packages by id: `dir` and `package`. `commonArtifacts` are installed in every cell (core, renderer, the conformance harness). |
| `reactAdapters` | Keyed by a `reactEpochs` id. Data about the adapter: `artifact`, `entry` (export subpath, `.` for the root), `className`, `hashScope` (`entry` or `package`), `adapterId`, `abi`, `provides`, `requires`, `declaredPeers`, `reconciler` (`via: bundled` or `dependency`, and the export that reports its version), `bundled` (packages that must not appear in the tree), `typesReactDom`, `conformanceCapabilities`, `typeProbes`, optional `expectedConformanceFailures`. |
| `pixiAdapters` | The same for each Pixi adapter (`pixi8`, and `pixi7` since issue 16), plus `epoch` (its `pixiEpochs` row: minimum, current, boundaries), `excludedVersions`, `capabilities` (always provided, and provided from a `capabilityBoundaries` boundary of its epoch), `probeSource` and `probeFactory` (the browser probe module and its factory), `conformanceAppOptions` (deterministic application options), `renderers` (the backends it has and the options that request each), `conformanceCapabilities` (scene capabilities the cell binding provides, joined with the React adapter's) and `typeConsumer` (the `harness/typecheck` declaration consumer). |
| `defaultPixiAdapter` | The Pixi adapter the tiers' top-level `react`/`pixi` selections apply to (`pixi8`). |
| `tiers` | `pr` and `nightly`: which React patches, which Pixi versions, which render backends (`renderers`), which boundary probes. `pixiAdapters` adds cells for another Pixi adapter: a cross product of its own `react`/`pixi` selections (nightly), or explicit `pairs` of a React epoch and a Pixi role (PR). `validateAdapterMatrix` allows at most two PR-tier cells per non-default Pixi adapter. |
| `negative` | Deliberately incompatible pairs: the command that must fail and the message it must contain. |

Exact versions are not repeated here. React versions, `@types/react` and the reconciler come from the audited `probes` tuples (lowest and highest audited patch of each epoch's minor); Pixi versions are the highest audited non-excluded patch of each minor of an adapter's epoch between its `minimum` and `current` (`pixiEpochs.pixi8`: 8.2.6 … 8.22.0), or that epoch's `minimum` and `current` by role (`pixiEpochs.pixi7`: 7.4.2 and 7.4.3). Adding a probe tuple to the seed and promoting it is what adds a cell. `validate.mjs` runs `validateAdapterMatrix`, which checks the section against the rest of the seed.

## Tiers and checks

| Tier | Runs | Workflow, check |
| --- | --- | --- |
| PR | WebGL only. Each React epoch at its latest patch x pixi.js 8.2.6 and 8.22.0 (10 cells), and the Pixi 7 adapter with React 18.3.1 x pixi.js 7.4.2 and React 19.3.0 x 7.4.3 (2 cells); fast probes at 8.2.6, 8.5.0 (excluded), 8.5.2, 8.7.0 (RenderLayer), 8.9.0 (DOMContainer), 8.10.0 (removeParticles), 8.22.0; the incompatible pairs | `Compatibility`; the one required check is **Compatibility (required)** |
| Nightly | WebGL and WebGPU, each separately (Pixi 7 cells: WebGL only). Each React epoch at its latest patch x every Pixi 8 minor at its latest audited patch and x pixi.js 7.4.2 and 7.4.3 (115 cells, or 184 with `patches: all`), every audited React, Pixi 8 and Pixi 7 tuple as a probe, the incompatible pairs | `Compatibility nightly`; **Compatibility (nightly)** reports the table and fails on any failure; **Open or update the failure issue** (the only job with `issues: write`) files one issue |

Boundary probes re-run the #3 audit runner against the registry and compare the result with `evidence.json` and the seed's pinned digests. A changed observation, declaration surface, React ABI, type diagnostic or expected known failure fails the probe ("unexpected API/type drift"): a minor or patch that moved is reviewed before any range is widened. A changed transitive resolution is a warning only.

## Caching

- pnpm store: keyed by the lockfile (the shared setup action).
- Cell verdict (PR tier): `compat-verdict-<key>`. The key hashes the packed files of every installed artifact, the exact dependency versions, the toolchain, the command list, the harness and runner sources, and the platform. For an adapter with `hashScope: entry` only the files its export entry can reach are hashed (it follows relative imports and `.js` to `.d.ts`; an unresolvable import falls back to the whole package), so editing one subpath of a multi-entry package invalidates only that entry's cells. Only passes are cached. The nightly tier never reuses verdicts.
- npm downloads: `compat-npm-<hash of the cell's dependency versions>`; Playwright browsers by version.

## Failure diagnostics

Failed jobs upload `.compat/out/<cell>` (per-command logs, `npm-ls.json`, `tree-report.json`, `package-lock.json`, `conformance.json`, generated project files, Vitest failure screenshots). Vitest 2.1 browser mode has no Playwright trace hook, so there is no trace; screenshots and the JSON report stand in for it.

## Adding or changing a package layout (for example #49)

The runner, harness and tests do not name a package or subpath; `cells.test.mjs` fails if they do. Only manifest rows change: each `reactAdapters` row's `artifact`, `entry`, `className`, `declaredPeers`, `reconciler` and `adapterId`; the `artifacts` rows; and the `negative` message signatures. One more React epoch is one more `reactEpochs` row plus one more `reactAdapters` row and probe tuples.

## Showing that a cache key follows the adapter

```sh
R=design/compatibility/cells/run-cells.mjs
node $R pack --out .compat/tarballs && node $R key --cell react-19.1.9_pixi-8.22.0 --tarballs .compat/tarballs
# edit packages/react-19.1/src/index.ts, then:
pnpm --filter @pixi-react-provisional/react-19.1 build && node $R pack --out .compat/tarballs-edited
node $R key --cell react-19.1.9_pixi-8.22.0 --tarballs .compat/tarballs-edited   # changed
node $R key --cell react-19.2.8_pixi-8.22.0 --tarballs .compat/tarballs-edited   # unchanged
node $R run --tier pr --tarballs .compat/tarballs-edited                          # 19.1 cells re-run, the rest are CACHED-PASS
```

`cells.test.mjs` asserts the same on synthetic artifacts, and that repacking unchanged sources yields identical keys (`pnpm pack` does not keep dependency order stable, so manifests are hashed with sorted keys).
