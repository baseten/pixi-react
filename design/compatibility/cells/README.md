# Adapter compatibility cells (issue 13)

Isolated, data-driven compatibility cells for the modular adapters, run locally and in CI with the same command. The list of cells is [generated](COMPATIBILITY.md) from the #3 seed (`../seed.json`); nothing lists a cell by hand. Cells are what makes a version **tested** (PR tier) or **verified** (per tuple and render backend: its nightly cell passed on that backend in a dated [verification record](../verification/) whose boundary probes and incompatible pairs behaved as expected; `verifiedRanges` in the seed is derived from the records). Verification is evidence, not a support guarantee.

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

WebGL and WebGPU are checked separately, never inferred from each other (issue 17). `adapterMatrix.renderers` names the backends and the run's GPU profile (`gpuProfiles`, below) gives each backend's Chromium flags; a Pixi adapter row's `renderers` gives the application options that request it (Pixi 8: `preference`; Pixi 7 has WebGL only, `rendererNote`); a tier's `renderers` says which backends it runs (PR: `webgl`; nightly: `webgl`, `webgpu`; `--renderers` overrides). The conformance command runs once per backend with `COMPAT_RENDERER` set (logs `conformance-<backend>.log`, report `conformance-<backend>.json`), and the result row records each backend under `backends`. Two harness files keep a backend honest:

- `test/renderer.ts` (a setup file) fails every Pixi 8 application whose renderer is not the requested one: Pixi 8 silently falls back to another renderer when the preferred one is unavailable.
- `test/backend.test.tsx` (the render check) draws a red rectangle, checks that the renderer is the requested one, that the browser's renderer is what the GPU profile expects (software, or a real GPU) and that a screenshot of the canvas shows the rectangle, and prints a `COMPAT_BACKEND` line (renderer, WebGL renderer string or WebGPU adapter with `isFallbackAdapter`, the profile check, read-backs) that the runner records.

### GPU profiles

`--gpu` picks a row of `adapterMatrix.gpuProfiles`:

- **`software`** (the default, what CI runs and what the 2026-10-10 record ran on): headless, WebGL on ANGLE over SwiftShader, WebGPU on Dawn over SwiftShader's Vulkan device, which Chromium exposes only as a fallback adapter (`isFallbackAdapter: true`) with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. Without those flags headless Chromium has `navigator.gpu` but no adapter. The render check requires a software renderer (`softwareRendererPatterns`) or a fallback adapter, so a record never calls a GPU software.
- **`hardware`**: no SwiftShader or fallback flags and a headed browser, so Chromium takes the platform's default GPU path (Metal on macOS, Direct3D on Windows). The render check **fails** when a run lands on a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render Driver, ...) or a fallback adapter, or reports no renderer identity at all. `--headless` / `--headed` override the browser mode (a headless browser usually gets no GPU).

The profile is part of every cell's configuration (and its cache key), and each result row records it (`gpuProfile`).

### Expected blank renders

`adapterMatrix.expectedBlankRender` lists backend runs whose render check is known to show a blank canvas under one GPU profile, each with its `reason`, the read-back `signature` and its `evidence` (record, what was observed, the adapter, the apparent cause, how far it was narrowed, real-GPU status). Today: pixi.js 8.2.6 to 8.9.2 on WebGPU under the software profile, where every conformance scenario passes but the canvas reads `[0,0,0,0]`: an upstream pixi.js bug ([#11389](https://github.com/pixijs/pixijs/issues/11389), fixed in 8.10.0 by [#11417](https://github.com/pixijs/pixijs/pull/11417)) sizes the WebGPU batch from WebGL's texture-unit count (32 on SwiftShader) above the device's per-stage limit (16). pixi.js 8.10.0 and later render; real GPUs whose limits agree (the Apple M5 Max hardware record) render 8.2–8.9 too. Like the 8.5.0 ParticleContainer known-failure probe, a listed run is **expected** (`expected-fail`; the cell passes, so the nightly stays green, and it verifies nothing on that backend) only when every conformance scenario passed and the render check failed exactly as listed. It **fails** when the canvas renders ("unexpected render ... remove its pixi.js version": prune the list), when any scenario fails, or when the render check fails some other way. `validate.mjs` rejects an entry without a reason or evidence, or with a version the nightly does not run, and checks the list against the records: the evidence record ran the listed cells, and no record of that profile shows a listed cell rendering.

### Running on a real GPU

For a contributor with a GPU on **macOS** or **Windows**. Linux is not supported for the hardware profile (untested; it would likely need extra Chromium flags). The commands are the same in a POSIX shell and in PowerShell once the tools are installed: the runner spawns no shell of its own, and npm and pnpm run through their `.cmd` shims on Windows. Everything a run writes goes under `.compat/` (git-ignored).

#### 1. Prerequisites

| | macOS (Terminal, zsh) | Windows (PowerShell) |
| --- | --- | --- |
| git | `xcode-select --install` (or `brew install git`) | `winget install --id Git.Git -e` |
| Node, the version in `.nvmrc` (22.22.0; `package.json` requires `^22.22.0`) | [nvm](https://github.com/nvm-sh/nvm): `nvm install 22.22.0 && nvm use 22.22.0` (or the nodejs.org installer for 22.22.0) | [nvm-windows](https://github.com/coreybutler/nvm-windows): `winget install --id CoreyButler.NVMforWindows -e`, open a new PowerShell, then `nvm install 22.22.0; nvm use 22.22.0` (or the nodejs.org installer for 22.22.0) |
| pnpm (the `packageManager` version, through corepack) | `corepack enable` | `corepack enable` (in an administrator PowerShell if it reports EPERM) |
| npm | comes with Node | comes with Node |

Check with `node --version` (v22.22.0 or a later 22.x), `pnpm --version` (10.28.0) and `npm --version`.

On both systems the cells install into the OS temp directory and refuse to run when any parent of it holds a `node_modules` directory (it could hide a missing dependency). If the runner reports `.../node_modules exists above the isolated project`, point the temp directory at a fresh one for the session: `export TMPDIR=/tmp/compat-tmp && mkdir -p $TMPDIR` (macOS) or `$env:TEMP = $env:TMP = 'C:\compat-tmp'; mkdir C:\compat-tmp` (PowerShell).

Windows only, three things to set once:

- **Execution policy.** `npm`, `npx` and `pnpm` are PowerShell scripts (`.ps1` shims); if PowerShell refuses to run them, allow local scripts for your user: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Long paths.** The cells install deep `node_modules` trees under `%TEMP%`. Clone into a short path (for example `C:\src`) and, if npm reports `ENAMETOOLONG` or a path-too-long error, enable Win32 long paths in an administrator PowerShell and reboot: `New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.
- **Line endings.** Clone with `core.autocrlf=false` (the clone command below sets it for this clone only). With CRLF checkouts the packed artifacts differ from the commit's, so `verification.mjs compare` cannot show that the record ran the commit's code.

#### 2. Set three variables

Every command below reads `$BRANCH`, `$MACHINE` and `$TODAY`, so it is the same in both shells (PowerShell variable names ignore case). Nothing in a command is a placeholder to edit.

macOS (zsh):

```sh
BRANCH=claude/react18-minors-pixi7-widen       # the branch you were asked to run
MACHINE=$(printf 'macos-%s-%s' "$(sw_vers -productVersion | cut -d. -f1)" "$(sysctl -n machdep.cpu.brand_string)" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')
TODAY=$(date +%F)
echo "$MACHINE $TODAY"                         # for example: macos-26-apple-m5-max 2026-10-12
```

Windows (PowerShell):

```powershell
$BRANCH = 'claude/react18-minors-pixi7-widen'   # the branch you were asked to run
$os = (Get-CimInstance Win32_OperatingSystem).Caption -replace '^Microsoft ', ''
$gpu = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Remote|Virtual|Parsec' } | Select-Object -First 1).Name
$MACHINE = ("$os $gpu".ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$TODAY = Get-Date -Format yyyy-MM-dd
"$MACHINE $TODAY"                              # for example: windows-11-pro-nvidia-geforce-rtx-4070 2026-10-12
```

On a machine with two GPUs (integrated and discrete), check that `$gpu` names the one Chromium uses (the record reports the GPU the browser saw), and set `$MACHINE` by hand if not, as lowercase words joined by hyphens. Keep the same `$MACHINE` for every later run on that machine.

#### 3. Clone, install, build, and install the browser

```sh
git clone -c core.autocrlf=false https://github.com/baseten/pixi-react.git
cd pixi-react
git checkout $BRANCH
pnpm install --frozen-lockfile
pnpm build
npx playwright@1.50.1 install chromium
node design/compatibility/cells/run-cells.mjs pack --out .compat/gpu/tarballs
```

`npx playwright@1.50.1 install chromium` installs the browser of the pinned Playwright (`node design/compatibility/cells/run-cells.mjs toolchain --name playwright` prints its version); on a contributor machine that is the right way to get it.

#### 4. A targeted run (23 cells)

The WebGPU expected-blank versions (pixi.js 8.2.6 … 8.9.2) plus 8.10.2 and 8.22.0, with React 18.3.1 and 19.3.0, on both backends (20 cells), then three Pixi 7.2/7.3 and React 18.0 cells. A browser window opens for each backend run; leave the machine alone while it runs.

```sh
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs --react 18.3.1,19.3.0 --pixi 8.2.6,8.3.4,8.4.1,8.5.2,8.6.6,8.7.3,8.8.1,8.9.2,8.10.2,8.22.0
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs --cell react-18.0.0_pixi-8.22.0,react-18.0.0_pixi-7.2.0,react-19.3.0_pixi-7.3.3
node design/compatibility/verification.mjs build --work .compat/gpu --date $TODAY --commit $(git rev-parse HEAD) --machine $MACHINE --scope partial
```

#### 5. Or the full run

Every nightly cell (297: every React adapter at its minimum and latest audited patch × the newest audited patch of every Pixi 8 minor and every audited Pixi 7 release), then the boundary probes and the incompatible pairs, which a record needs before it verifies anything. On the maintainer's 4-vCPU software run the cells took 59 minutes in three parallel shards (about 35 s per cell per shard); one shard on a laptop takes about one to three hours. Use a fresh work directory (delete `.compat/gpu` first, then pack again as in step 3), so a targeted run's results do not mix in.

```sh
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs
node design/compatibility/cells/run-cells.mjs probes --tier nightly --work .compat/gpu
node design/compatibility/cells/run-cells.mjs run --negative --no-cache --gpu hardware --work .compat/gpu --tarballs .compat/gpu/tarballs
node design/compatibility/verification.mjs build --work .compat/gpu --date $TODAY --commit $(git rev-parse HEAD) --machine $MACHINE
```

A failing cell does not stop the run; its diagnostics are in `.compat/gpu/out/` (one directory per cell).

The `build` command writes `design/compatibility/verification/$TODAY-$MACHINE.json` and `.md`, with the OS, CPU, Node, npm, pnpm and Chromium versions and the GPU the render checks reported (WebGL `UNMASKED_RENDERER`, the WebGPU adapter and `isFallbackAdapter`). A full record supersedes an earlier partial one of the same machine with no other change: a later date counts as newer, and on the same date add `--sequence 2` (it writes `$TODAY-$MACHINE.2`); building again with the same date and no `--sequence` replaces the file.

#### 6. What to send back

The two record files the `build` command printed (`design/compatibility/verification/` plus the date and machine slug, `.json` and `.md`), in a pull request or attached to the issue. If any cell failed, also a zip of `.compat/gpu/out` (logs, reports, screenshots), for example `zip -r gpu-out.zip .compat/gpu/out` (macOS) or `Compress-Archive .compat/gpu/out gpu-out.zip` (PowerShell). The maintainer then runs `node design/compatibility/verification.mjs ranges --write` and `node scripts/release/compat-table.mjs --write`; the record sits beside the software one, which stays.

A full hardware record verifies the tuples that passed on it; a partial record without probes and negative cases verifies nothing and is evidence only. Within one machine and GPU profile only the newest record counts (a later failure revokes that machine's earlier verification, and a later partial run replaces an earlier full one), so rerun on the same machine with the same `--machine` slug only to supersede; records of different machines or profiles add up. Under the hardware profile the expected-blank list does not apply: 8.2.6 … 8.9.2 must render on WebGPU to pass.

What is untested: the hardware profile and the Windows code paths (`.cmd` shims, `file:` paths with drive letters, the Node tar extraction on Windows) have been reviewed, not run; on Linux only the software profile has run. The review found and fixed one Windows defect: the cells' tree check spawned `npm` without its `.cmd` shim (`harness/checks/tree.mjs`).

## Data-only probes

`run-cells.mjs data` runs `data-only.json`: packed adapters beside a React or pixi.js they do not declare (installed with `--legacy-peer-deps`, the reconciler swapped by an npm `overrides` entry where a group names one). Every command runs and is recorded even after a failure; the conformance run bypasses the adapters' `checkEnvironment()` (cell.json `dataOnly`), and for React below 18.3 `test/lend-act.ts` lends `act` from `react-dom/test-utils` (as in every cell with such a React). Results go to `data-results/`, are never cached and never verify anything: they appear only in the "data only, not verified" section of a verification record. Today's group probes the Pixi 7 adapter on pixi.js 7.0.5, 7.1.4 (below the floor) and the excluded 7.4.0; React 18.0–18.2 and pixi.js 7.2/7.3 were data-only probes until they became cells.

**React before 18.3 in a cell.** React exports `act` from 18.3.0 on; the conformance suite calls it. A cell with React 18.0, 18.1 or 18.2 (`cell.json` `lendAct`) loads `test/lend-act.ts`, which lends React the `act` of `react-dom/test-utils`, where those versions keep it, and logs `COMPAT_LEND_ACT`. It is the same React testing helper, not a change to the adapter or to any check.

**Version-dependent type assertions.** A Pixi adapter's declaration consumer can mark assertions that hold only from some pixi.js version on (`compat:begin <id>` … `compat:end <id>`, declared in its row's `typeAssertions` with `from` and `reason`). Below that version the runner replaces the block with a comment naming the assertion and the reason, and records it in `cell.json` (`typeAssertions.omitted`); a marker the manifest does not declare fails the cell. Today: `pixi8-names-rejected` (the Pixi 7 consumer's two assertions that Pixi 8's `label` and `context` are rejected) holds from pixi.js 7.3.0, because 7.2's declarations import an unresolvable `colord/types`, which makes `tint` `any` and the element props an open record.

## Verification records

`node design/compatibility/verification.mjs build --work DIR --date YYYY-MM-DD --commit SHA [--machine SLUG] [--scope full|partial] [--extra FILE]` turns a run's work directory (`results/`, `out/`, `data-results/`, `tarballs/`) into `../verification/<id>.json` and `.md`, where `<id>` is the date, or the date and the machine slug for another machine's record (the environment is collected when `--extra` gives none; `--extra` also carries the run notes and findings). Each record states its GPU profile and how it rendered; a software record carries the note that it ran on software rendering and that a real-GPU run can be added. `refresh` re-applies the current manifest (the expected-blank list) and rule to the checked-in records without re-running anything; `ranges --write` derives `verifiedRanges` from the current records: the newest per machine and GPU profile, added up across machines and profiles (each entry names the records behind it); `compare --record ID --tarballs DIR` shows whether freshly packed artifacts carry the same code as the run (Markdown and build logs aside). `validate.mjs` fails when `verifiedRanges` differs from what the records derive, a record's summary or Markdown is stale, or the expected-blank list disagrees with the records.

## Manifest: `adapterMatrix` in `../seed.json`

| Key | Meaning |
| --- | --- |
| `toolchain` | Exact TypeScript, Vitest, `@vitest/browser`, Playwright and Vite versions installed in every cell. |
| `commands` | Command order and per-command timeouts (seconds). |
| `renderers`, `rendererNote` | Render backends (`webgl`, `webgpu`). |
| `gpuProfiles`, `defaultGpuProfile`, `softwareRendererPatterns` | GPU profiles (`software`, `hardware`): the Chromium flags of each backend, headless or headed, and whether the render check must see software rendering or a real GPU (renderer strings that mean software). |
| `expectedBlankRender` | Backend runs expected to render a blank canvas under one GPU profile, unverified, each with its reason, read-back signature and evidence ([above](#expected-blank-renders)). |
| `artifacts` | Packed workspace packages by id: `dir` and `package`. `commonArtifacts` are installed in every cell (core, renderer, the conformance harness). |
| `reactAdapters` | Keyed by a `reactEpochs` id. Data about the adapter: `artifact`, `entry` (export subpath, `.` for the root), `className`, `hashScope` (`entry` or `package`), `adapterId`, `abi`, `provides`, `requires`, `declaredPeers`, `reconciler` (`via: bundled` or `dependency`, and the export that reports its version), `bundled` (packages that must not appear in the tree), `typesReactDom`, `conformanceCapabilities`, `typeProbes`, optional `expectedConformanceFailures`. |
| `pixiAdapters` | The same for each Pixi adapter (`pixi8`, and `pixi7` since issue 16), plus `epoch` (its `pixiEpochs` row: minimum, current, boundaries), `excludedVersions`, `capabilities` (always provided, and provided from a `capabilityBoundaries` boundary of its epoch), `probeSource` and `probeFactory` (the browser probe module and its factory), `conformanceAppOptions` (deterministic application options), `renderers` (the backends it has and the options that request each), `conformanceCapabilities` (scene capabilities the cell binding provides, joined with the React adapter's) and `typeConsumer` (the `harness/typecheck` declaration consumer). |
| `defaultPixiAdapter` | The Pixi adapter the tiers' top-level `react`/`pixi` selections apply to (`pixi8`). |
| `tiers` | `pr` and `nightly`: which React epochs and patches, which Pixi versions, which render backends (`renderers`), which boundary probes. A tier's `pairs` add explicit cells of a React epoch and a Pixi role with the default Pixi adapter (PR: React 18.0 x the Pixi 8 minimum). `pixiAdapters` adds cells for another Pixi adapter: a cross product of its own `react`/`pixi` selections (nightly), or explicit `pairs` (PR). `validateAdapterMatrix` allows at most two PR-tier cells per non-default Pixi adapter. |
| `negative` | Deliberately incompatible pairs: the command that must fail and the message it must contain. |

Exact versions are not repeated here. React versions, `@types/react` and the reconciler come from the audited `probes` tuples (lowest and highest audited patch of each epoch's minor); Pixi versions are the highest audited non-excluded patch of each minor of an adapter's epoch between its `minimum` and `current` (`pixiEpochs.pixi8`: 8.2.6 … 8.22.0), or every audited non-excluded patch of the epoch (`versions: "all-audited"`; `pixiEpochs.pixi7`: 7.2.0, 7.2.4, 7.3.0, 7.3.3, 7.4.2 and 7.4.3, 7.4.0 and 7.4.1 excluded), or that epoch's `minimum` and `current` by role (PR pairs). Adding a probe tuple to the seed and promoting it is what adds a cell. `validate.mjs` runs `validateAdapterMatrix`, which checks the section against the rest of the seed.

## Tiers and checks

| Tier | Runs | Workflow, check |
| --- | --- | --- |
| PR | WebGL only. React 18.3 and each React 19 epoch at its latest patch x pixi.js 8.2.6 and 8.22.0 (10 cells), React 18.0.0 x 8.2.6 (1 cell; React 18.1 and 18.2 run nightly and in their packages' fixtures), and the Pixi 7 adapter with React 18.0.0 x pixi.js 7.2.0 and React 19.3.0 x 7.4.3 (2 cells): 13 cells; fast probes at 8.2.6, 8.5.0 (excluded), 8.5.2, 8.7.0 (RenderLayer), 8.9.0 (DOMContainer), 8.10.0 (removeParticles), 8.22.0; the incompatible pairs | `Compatibility`; the one required check is **Compatibility (required)** |
| Nightly (scheduled weekly on GitHub, Mondays 02:37 UTC; the tier keeps its name) | WebGL and WebGPU, each separately (Pixi 7 cells: WebGL only). Each React epoch (18.0, 18.1, 18.2, 18.3, 19.0 … 19.3) at its latest patch x every Pixi 8 minor at its latest audited patch and x every audited Pixi 7 release (7.2.0, 7.2.4, 7.3.0, 7.3.3, 7.4.2, 7.4.3): 216 cells, or 297 with `patches: all`; every audited React, Pixi 8 and Pixi 7 tuple as a probe, the incompatible pairs | `Compatibility nightly`; **Compatibility (nightly)** reports the table and fails on any failure; **Open or update the failure issue** (the only job with `issues: write`) files one issue |

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
