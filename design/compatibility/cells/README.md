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

Browser cells need Chromium for the pinned Playwright (`pnpm --filter ./apps/examples exec playwright install chromium`, from the repository root; the examples app pins the same Playwright as the cells); set `CI=true` outside CI to run headless. Output goes to `.compat/` (git-ignored): `tarballs/`, `verdicts/`, `results/`, and `out/<cell>/` with logs, the `npm ls` dump, the lockfile, the generated project files and screenshots.

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
- `test/backend.test.tsx` (the render check) draws a red rectangle, checks that the renderer is the requested one, that the browser's renderer is what the GPU profile expects (software, or a real GPU) and that a screenshot of the canvas shows the rectangle, and prints a `COMPAT_BACKEND` line (renderer, WebGL renderer string or WebGPU adapter with `isFallbackAdapter`, the profile check, read-backs, the environment shims applied) that the runner records.
- `test/environment-shims.ts` (a setup file, the first one, loaded only when `cell.json` lists an environment shim for the run's backend; [below](#environment-shims)) installs each shim before any Pixi application initializes.

### GPU profiles

`--gpu` picks a row of `adapterMatrix.gpuProfiles`:

- **`software`** (the default, what CI runs and what the software records ran on): headless, WebGL on ANGLE over SwiftShader, WebGPU on Dawn over SwiftShader's Vulkan device, which Chromium exposes only as a fallback adapter (`isFallbackAdapter: true`) with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. Without those flags headless Chromium has `navigator.gpu` but no adapter. The render check requires a software renderer (`softwareRendererPatterns`) or a fallback adapter, so a record never calls a GPU software.
- **`hardware`**: no SwiftShader or fallback flags and a headed browser, so Chromium takes the platform's default GPU path (Metal on macOS, Direct3D on Windows). The render check **fails** when a run lands on a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render Driver, ...) or a fallback adapter, or reports no renderer identity at all. `--headless` / `--headed` override the browser mode (a headless browser usually gets no GPU).

The profile is part of every cell's configuration (and its cache key), and each result row records it (`gpuProfile`).

The render check reads a WebGPU adapter's fallback flag from `adapter.info.isFallbackAdapter` (newer Chrome) or else `adapter.isFallbackAdapter` (older Chromium, such as Playwright's 133) and records which (`gpuAdapter.fallbackSource`). When neither exists the flag is recorded as unknown, never as "not a fallback": the adapter's vendor and architecture then decide against `softwareRendererPatterns`, and a hardware run whose adapter matches one (SwiftShader) or names nothing fails. Before Pixi initializes on a WebGPU run, `harness/test/webgpu-preflight.ts` asks `navigator.gpu.requestAdapter()`; without an adapter the run fails within seconds with `no WebGPU adapter in this browser`, instead of hanging until the conformance timeout, and a crashed page ends the run at once (`COMPAT_PAGE_CRASHED`).

### Browsers

`--browser` picks the browser: **`chromium`** (the default) is the Chromium build pinned by the toolchain's Playwright; **`chrome`** and **`msedge`** launch the Google Chrome or Microsoft Edge installed on the machine through Playwright's `channel` option (`harness/vitest.config.mts`), still driven by the pinned Playwright. Only the hardware profile accepts an installed browser; the software profile (CI) rejects it. Each backend run records the browser's name and full version (from `navigator.userAgentData` and the launched browser's `version()`), and a verification record names it in its Browser row; a record whose runs used an installed browser says so there and in its rendering note, because it did not run the pinned Chromium.

### Environment shims

`adapterMatrix.environmentShims` lists labelled workarounds for upstream pixi.js bugs, so the matrix measures this project's adapters and not those bugs (owner ruling, 2026-10-11). Each entry names a Pixi adapter, one backend, a pixi.js range (`from` inclusive, `before` exclusive; it must end at or below `fixedIn`), the `action` the harness takes, what it `does`, its `reason`, its `evidence`, upstream `links` and the `knownIssue` it works around. It applies under **every** GPU profile, and only to the backend runs of its adapter, backend and range.

Today there is one: **`pixi-webgpu-texture-units`**, for WebGPU runs of the `pixi-8` adapter with pixi.js `>=8.2.6 <8.10.0`. pixi.js before 8.10 sizes its WebGPU texture batch from WebGL's `MAX_TEXTURE_IMAGE_UNITS` (32 on ANGLE/SwiftShader) while the WebGPU device keeps the default `maxSampledTexturesPerShaderStage` of 16, so the batch pipeline is invalid and the canvas stays blank although every conformance scenario passes ([pixijs/pixijs#11389](https://github.com/pixijs/pixijs/issues/11389), fixed in 8.10.0 by [#11417](https://github.com/pixijs/pixijs/pull/11417)). The shim (`clamp-webgl-parameter`) wraps `getParameter` of `WebGLRenderingContext` and `WebGL2RenderingContext` so that `MAX_TEXTURE_IMAGE_UNITS` (0x8872) returns `Math.min(value, 16)`. It never applies to a WebGL run (`validateAdapterMatrix` rejects a WebGL clamp on a WebGL backend) or to pixi.js 8.10+. On a real GPU whose WebGL already reports 16 or fewer units it changes nothing: the Apple M5 Max reports 16 (observed: the owner's 2026-10-11 Mac run logged the shim's original value as 16 (16 → 16 on all 88 shimmed runs); that record is pending a re-run on the required Node version), and the owner's Windows PC (NVIDIA RTX 4070, ANGLE over Direct3D 11) reported 16 in a standalone probe (not yet a record).

How a run treats it:

- The runner writes the shims of each backend into `cell.json` (`renderers.<backend>.environmentShims`, part of the cell's cache key); `vitest.config.mts` loads `test/environment-shims.ts` as the first setup file only then.
- The render check reports what was applied (`environmentShims` in `COMPAT_BACKEND`: id, parameter, original and clamped value, 32 and 16 on SwiftShader). The runner fails a run whose report differs from the configuration, and records it on the backend (`backends.<backend>.environmentShims`).
- A shimmed run that renders is a normal pass; a shimmed run that still fails (a blank canvas, a scenario) is a failure. A tuple verified with a shim stays verified and carries the shim id (`verifiedRanges[].environmentShims`); the release table, COMPATIBILITY.md and the record Markdown mark it with its known issue's footnote ("\\* WebGPU on pixi.js <8.10 needs the workaround for pixijs/pixijs#11389 ...").
- `validateRecord` requires a record from 2026-10-11 on to list exactly the shims the manifest applies to every run, and an older record to list none.

The shims replaced the expected-blank-render list (`expectedBlankRender`), under which the 2026-10-10 records counted those WebGPU runs as expected blank renders, unverified. Those records keep what they recorded (run without the shim, the blank canvas); `validateRecord` accepts that status only in a record from before 2026-10-11, and it never verifies anything. The 2026-10-11 record supersedes them.

### Running on a real GPU

For a contributor with a GPU on **macOS** or **Windows**. Linux is not supported for the hardware profile (untested; it would likely need extra Chromium flags). One command does the whole run, the same in zsh and in PowerShell (Windows PowerShell 5.1 or PowerShell 7): `pnpm compat:gpu` (`scripts/compat-gpu.mjs`), which spawns no shell of its own and runs npm and pnpm through their `.cmd` shims on Windows. The manual steps it automates are in the appendix below. Everything a run writes goes under `.compat/` (git-ignored).

**Which browser.** On macOS the pinned Chromium renders WebGPU on the GPU (Metal). On Windows it does not: Playwright's Chromium 133 has `navigator.gpu` but `requestAdapter()` returns null (with `--enable-unsafe-webgpu` it offers only the SwiftShader fallback adapter), while the installed Chrome and Edge render on the GPU (an NVIDIA RTX 4070 on Windows 11 reported vendor `nvidia`, architecture `lovelace`). So Windows runs use `--browser chrome` (or `msedge`, which every Windows 11 has); the record then says it ran an installed browser, with its version.

#### 1. Prerequisites

| | macOS (Terminal, zsh) | Windows (PowerShell) |
| --- | --- | --- |
| git | `xcode-select --install` (or `brew install git`) | `winget install --id Git.Git -e` |
| Node, the version in `.nvmrc` (22.22.0; `package.json` requires `^22.22.0`) | [nvm](https://github.com/nvm-sh/nvm): `nvm install 22.22.0`, then `nvm use 22.22.0` (or [fnm](https://github.com/Schniz/fnm): `fnm install 22.22.0`, then `fnm use 22.22.0`; or the nodejs.org installer for 22.22.0) | [nvm-windows](https://github.com/coreybutler/nvm-windows): `winget install --id CoreyButler.NVMforWindows -e`, open a new PowerShell, then `nvm install 22.22.0` and `nvm use 22.22.0` (in an administrator PowerShell if it reports "access denied"). Or [fnm](https://github.com/Schniz/fnm): `winget install --id Schniz.fnm -e`, open a new PowerShell, then `fnm env --use-on-cd --shell powershell \| Out-String \| Invoke-Expression`, `fnm install 22.22.0` and `fnm use 22.22.0` (the first of the three again in every new PowerShell, or add it to `$PROFILE`). Or the nodejs.org installer for 22.22.0 |
| pnpm (the `packageManager` version, through corepack) | `corepack enable` | `corepack enable` (in an administrator PowerShell if it reports EPERM) |
| npm | comes with Node | comes with Node |
| The browser | nothing to install: `pnpm compat:gpu` installs the pinned Chromium | Google Chrome: `winget install --id Google.Chrome -e` (or use the preinstalled Edge with `--browser msedge`) |

Check with `node --version` (v22.22.0 or a later 22.x), `pnpm --version` (10.28.0) and `npm --version`.

On both systems the cells install into the OS temp directory and refuse to run when any parent of it holds a `node_modules` directory (it could hide a missing dependency). If the runner reports `.../node_modules exists above the isolated project`, point the temp directory at a fresh one for the session: `export TMPDIR=/tmp/compat-tmp`, then `mkdir -p $TMPDIR` (macOS), or `$env:TEMP = 'C:\compat-tmp'`, `$env:TMP = 'C:\compat-tmp'` and `mkdir C:\compat-tmp` (PowerShell). A temp path with a space or an 8.3 short name (the default `%TEMP%` of a Windows profile such as `C:\Users\Sam Hill`, which Node reports as `C:\Users\SAMHIL~1\...`) no longer needs this: the runner uses each cell directory by its real long path (`makeCellDir`). The first Windows run failed every cell with `__vitest_browser_runner__.runTests is not a function` before that fix.

Windows only, three things to set once:

- **Execution policy.** `npm` and `pnpm` are PowerShell scripts (`.ps1` shims); if PowerShell refuses to run them, allow local scripts for your user: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Long paths.** The cells install deep `node_modules` trees under `%TEMP%`. Clone into a short path (for example `C:\src`) and, if npm reports `ENAMETOOLONG` or a path-too-long error, enable Win32 long paths in an administrator PowerShell and reboot: `New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.
- **Line endings.** Clone with `core.autocrlf=false` (the clone command below sets it for this clone only). With CRLF checkouts the packed artifacts differ from the commit's, so `verification.mjs compare` cannot show that the record ran the commit's code.

#### 2. Run

Clone into a short path (Windows: for example `C:\src`), check the Node version, and run. On macOS (zsh):

```sh
git clone -c core.autocrlf=false https://github.com/baseten/pixi-react.git
cd pixi-react
git checkout main                          # or the branch you were asked to run
node --version                             # must print v22.22.0
pnpm compat:gpu
```

On Windows (PowerShell), with the installed Chrome (or `--browser msedge`):

```powershell
git clone -c core.autocrlf=false https://github.com/baseten/pixi-react.git
cd pixi-react
git checkout main                          # or the branch you were asked to run
node --version                             # must print v22.22.0
pnpm compat:gpu --browser chrome
```

`pnpm compat:gpu`:

1. refuses a Node outside `engines.node` (it names the required v22.22.0 and `.nvmrc`), and tracked files with uncommitted changes (`--allow-dirty` overrides), and prints the full commit (compare all 40 characters with the commit you were asked to run, never a short SHA);
2. installs and builds the workspace (`--no-build` skips it) and, for `chromium`, installs the pinned Chromium;
3. wipes and packs into `.compat/gpu/full/tarballs` (`--work DIR` for another directory);
4. runs every nightly cell on the hardware profile (`--patches all --gpu hardware --no-cache`, with your `--browser`), then the boundary probes, then the incompatible pairs. A failing cell, probe or pair never stops the run (failures are data); a setup error (install, build, pack, no result at all) does;
5. builds `design/compatibility/verification/<date>-<machine>.json` and `.md` with the UTC date, the full commit, the packed artifacts and the machine slug it detects: `macos-<major>-<cpu>` on macOS, `windows-<build>-<first GPU>` on Windows (for example `windows-26200-nvidia-geforce-rtx-4070`), with `-chrome` or `-msedge` appended for an installed browser (`--machine SLUG` overrides it; Linux is refused);
6. prints a summary: cells passed and failed per backend, probes, incompatible pairs, and where the record and diagnostics are.

The full run takes one to three hours on a laptop and opens a browser window for each backend run; leave the machine alone. On macOS it keeps the Mac awake (`caffeinate`); on Windows set Sleep to "Never" first (Settings > System > Power). `--targeted` runs only the 20 WebGPU cells of appendix C's first command (a partial record, evidence only), for a quick check.

#### 3. What to send back

The two record files the run printed (`design/compatibility/verification/` plus the date and machine slug, `.json` and `.md`), in a pull request or attached to the issue; `pnpm compat:gpu --push` does it for you (a new branch `records/<machine>-<date>` from HEAD, only that directory, one `[skip ci]` commit, pushed). To commit them, stage only that directory: `git add design/compatibility/verification/`, never `git add .` or `git add -A` (a work directory holds thousands of generated files; `.compat/` and any `.compat*/` directory are git-ignored and never linted, but other leftovers may not be). If any cell failed, also a zip of the run's `out` directory (`.compat/gpu/full/out` for `pnpm compat:gpu`, `.compat/gpu/out` for the manual steps) (logs, reports, screenshots), for example `zip -r gpu-out.zip .compat/gpu/full/out` (macOS) or `Compress-Archive .compat/gpu/full/out gpu-out.zip` (PowerShell). The maintainer then runs `node design/compatibility/verification.mjs ranges --write` and `node scripts/release/compat-table.mjs --write`; the record sits beside the software one, which stays.

A full hardware record verifies the tuples that passed on it; a partial record without probes and negative cases verifies nothing and is evidence only. Within one machine and GPU profile only the newest record counts (a later failure revokes that machine's earlier verification, and a later partial run replaces an earlier full one), so rerun on the same machine with the same `--machine` slug only to supersede; records of different machines or profiles add up. The environment shim `pixi-webgpu-texture-units` applies under the hardware profile too (WebGPU, pixi.js 8.2.6 … 8.9.2): each record lists it on those runs with the WebGL texture-unit count the machine reported and the clamped value, and on a GPU whose WebGL reports 16 units or fewer it changes nothing (the Apple M5 Max reports 16, observed in the owner's 2026-10-11 Mac run, whose record is pending a re-run on the required Node version; an NVIDIA RTX 4070 on Windows reported 16 in a standalone probe). Its tuples are marked with the known issue's footnote in every table, like the software ones.

What is untested: the hardware profile has run on macOS (record 2026-10-10-macos-26-apple-m5-max, and a 2026-10-11 run whose record is pending a re-run on Node 22). On Windows the first hardware run found two defects, both fixed since without a Windows rerun: the 8.3 short temp path (every cell failed in Vitest browser mode) and the bundled Chromium's missing WebGPU adapter (the run hung; now it fails at once, and `--browser chrome` uses the installed Chrome). The `chrome` and `msedge` channels have not run in CI or on the maintainer's Linux machine, which has neither browser. `pnpm compat:gpu` itself has been tested only for its arguments, machine slugs and steps, and as a targeted run on the maintainer's Linux machine with the platform check bypassed; its first macOS and Windows runs are its real test. An earlier review found and fixed one more Windows defect: the cells' tree check spawned `npm` without its `.cmd` shim (`harness/checks/tree.mjs`).

#### Appendix A. Set four variables

Every command of this appendix reads `$BRANCH`, `$MACHINE`, `$TODAY` and `$COMPAT_BROWSER`, so it is the same in both shells (PowerShell variable names ignore case). Nothing in a command is a placeholder to edit. `$TODAY` is the UTC date, as in the records.

macOS (zsh):

```sh
BRANCH=claude/react18-minors-pixi7-widen       # the branch you were asked to run
MACHINE=$(printf 'macos-%s-%s' "$(sw_vers -productVersion | cut -d. -f1)" "$(sysctl -n machdep.cpu.brand_string)" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')
TODAY=$(date -u +%F)
COMPAT_BROWSER=chromium                        # the Chromium pinned by Playwright
echo "$MACHINE $TODAY $COMPAT_BROWSER"         # for example: macos-26-apple-m5-max 2026-10-12 chromium
```

Windows (PowerShell):

```powershell
$BRANCH = 'claude/react18-minors-pixi7-widen'   # the branch you were asked to run
$os = (Get-CimInstance Win32_OperatingSystem).Caption -replace '^Microsoft ', ''
$gpu = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Remote|Virtual|Parsec' } | Select-Object -First 1).Name
$MACHINE = ("$os $gpu".ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$TODAY = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$COMPAT_BROWSER = 'chrome'                      # the installed Google Chrome ('msedge' for Edge)
"$MACHINE $TODAY $COMPAT_BROWSER"              # for example: windows-11-pro-nvidia-geforce-rtx-4070 2026-10-12 chrome
```

On a machine with two GPUs (integrated and discrete), check that `$gpu` names the one Chromium uses (the record reports the GPU the browser saw), and set `$MACHINE` by hand if not, as lowercase words joined by hyphens. Keep the same `$MACHINE` for every later run on that machine.

#### Appendix B. Clone, install, build, and install the browser

```sh
git clone -c core.autocrlf=false https://github.com/baseten/pixi-react.git
cd pixi-react
git checkout $BRANCH
git rev-parse HEAD
node --version
pnpm install --frozen-lockfile
pnpm build
pnpm --filter ./apps/examples exec playwright install chromium
node design/compatibility/cells/run-cells.mjs pack --out .compat/gpu/tarballs
```

`node --version` must print `v22.22.0` (the runner refuses any Node outside `engines.node`; switch with `nvm use 22.22.0` or `fnm use 22.22.0`). `git rev-parse HEAD` prints the full 40-character commit: if you were given a commit to run, compare all 40 characters with it. Do not compare short forms: `git rev-parse --short` prints as many characters as the repository needs to be unambiguous, which can be more than 7.

`pnpm --filter ./apps/examples exec playwright install chromium` installs the browser of the pinned Playwright (the examples app pins the same version as the cells; `node design/compatibility/cells/run-cells.mjs toolchain --name playwright` prints it). `npx playwright` is not the way: it was "not recognized" on both a Mac and a Windows contributor machine, as the repository root has no Playwright of its own. On Windows the run itself uses the installed Chrome, but install the pinned Chromium anyway: it is what `--browser chromium` and the examples tests use.

#### Appendix C. A targeted run (23 cells)

The WebGPU versions the environment shim covers (pixi.js 8.2.6 … 8.9.2) plus 8.10.2 and 8.22.0, with React 18.3.1 and 19.3.0, on both backends (20 cells), then three Pixi 7.2/7.3 and React 18.0 cells. A browser window opens for each backend run; leave the machine alone while it runs.

```sh
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --browser $COMPAT_BROWSER --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs --react 18.3.1,19.3.0 --pixi 8.2.6,8.3.4,8.4.1,8.5.2,8.6.6,8.7.3,8.8.1,8.9.2,8.10.2,8.22.0
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --browser $COMPAT_BROWSER --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs --cell react-18.0.0_pixi-8.22.0,react-18.0.0_pixi-7.2.0,react-19.3.0_pixi-7.3.3
node design/compatibility/verification.mjs build --work .compat/gpu --tarballs .compat/gpu/tarballs --date $TODAY --commit $(git rev-parse HEAD) --machine $MACHINE --scope partial
```

If every WebGPU run fails at once with `no WebGPU adapter in this browser`, the browser has no hardware WebGPU: on Windows set `$COMPAT_BROWSER = 'chrome'` (or `'msedge'`) and run again. A run that ends with `COMPAT_PAGE_CRASHED` crashed the browser page; send the diagnostics (step 3).

#### Appendix D. Or the full run

Every nightly cell (297: every React adapter at its minimum and latest audited patch × the newest audited patch of every Pixi 8 minor and every audited Pixi 7 release), then the boundary probes and the incompatible pairs, which a record needs before it verifies anything. On the maintainer's 4-vCPU software runs the cells took about an hour in three parallel shards (about 35 s per cell per shard); one shard on a laptop takes about one to three hours. Use a fresh work directory (delete `.compat/gpu` first, then pack again as in appendix B), so a targeted run's results do not mix in.

```sh
node design/compatibility/cells/run-cells.mjs run --tier nightly --patches all --gpu hardware --browser $COMPAT_BROWSER --no-cache --work .compat/gpu --tarballs .compat/gpu/tarballs
node design/compatibility/cells/run-cells.mjs probes --tier nightly --work .compat/gpu
node design/compatibility/cells/run-cells.mjs run --negative --no-cache --gpu hardware --browser $COMPAT_BROWSER --work .compat/gpu --tarballs .compat/gpu/tarballs
node design/compatibility/verification.mjs build --work .compat/gpu --tarballs .compat/gpu/tarballs --date $TODAY --commit $(git rev-parse HEAD) --machine $MACHINE
```

A failing cell does not stop the run; its diagnostics are in `.compat/gpu/out/` (one directory per cell).

The `build` command writes `design/compatibility/verification/$TODAY-$MACHINE.json` and `.md`, with the OS, CPU, Node, npm, pnpm and browser versions and the GPU the render checks reported (WebGL `UNMASKED_RENDERER`, the WebGPU adapter and `isFallbackAdapter` with the field it came from). The Browser row names the browser and its full version and says whether it was the Chromium pinned by Playwright or an installed one (`--browser chrome` or `msedge`). A full record supersedes an earlier partial one of the same machine with no other change: a later date counts as newer, and on the same date add `--sequence 2` (it writes `$TODAY-$MACHINE.2`); building again with the same date and no `--sequence` replaces the file.

## Data-only probes

`run-cells.mjs data` runs `data-only.json`: packed adapters beside a React or pixi.js they do not declare (installed with `--legacy-peer-deps`, the reconciler swapped by an npm `overrides` entry where a group names one). Every command runs and is recorded even after a failure; the conformance run bypasses the adapters' `checkEnvironment()` (cell.json `dataOnly`), and for React below 18.3 `test/lend-act.ts` lends `act` from `react-dom/test-utils` (as in every cell with such a React). Results go to `data-results/`, are never cached and never verify anything: they appear only in the "data only, not verified" section of a verification record. Today's group probes the Pixi 7 adapter on pixi.js 7.0.5, 7.1.4 (below the floor) and the excluded 7.4.0; React 18.0–18.2 and pixi.js 7.2/7.3 were data-only probes until they became cells.

**React before 18.3 in a cell.** React exports `act` from 18.3.0 on; the conformance suite calls it. A cell with React 18.0, 18.1 or 18.2 (`cell.json` `lendAct`) loads `test/lend-act.ts`, which lends React the `act` of `react-dom/test-utils`, where those versions keep it, and logs `COMPAT_LEND_ACT`. It is the same React testing helper, not a change to the adapter or to any check.

**Version-dependent type assertions.** A Pixi adapter's declaration consumer can mark assertions that hold only from some pixi.js version on (`compat:begin <id>` … `compat:end <id>`, declared in its row's `typeAssertions` with `from` and `reason`). Below that version the runner replaces the block with a comment naming the assertion and the reason, and records it in `cell.json` (`typeAssertions.omitted`); a marker the manifest does not declare fails the cell. Today: `pixi8-names-rejected` (the Pixi 7 consumer's two assertions that Pixi 8's `label` and `context` are rejected) holds from pixi.js 7.3.0, because 7.2's declarations import an unresolvable `colord/types`, which makes `tint` `any` and the element props an open record.

## Verification records

`node design/compatibility/verification.mjs build --work DIR --date YYYY-MM-DD --commit SHA [--machine SLUG] [--scope full|partial] [--extra FILE]` turns a run's work directory (`results/`, `out/`, `data-results/`, `tarballs/`) into `../verification/<id>.json` and `.md`, where `<id>` is the date, or the date and the machine slug for another machine's record (the environment is collected when `--extra` gives none; `--extra` also carries the run notes and findings). Each record states its GPU profile and how it rendered; a software record carries the note that it ran on software rendering and that a real-GPU run can be added. `refresh` re-applies the current rule and recomputes the summary and rendering note of the checked-in records without re-running anything (what a record observed, including the shims it applied and any expected blank render of a record before 2026-10-11, stays as recorded); `ranges --write` derives `verifiedRanges` from the current records: the newest per machine and GPU profile, added up across machines and profiles (each entry names the records behind it); `compare --record ID --tarballs DIR` shows whether freshly packed artifacts carry the same code as the run (Markdown and build logs aside). `validate.mjs` fails when `verifiedRanges` differs from what the records derive, a record's summary or Markdown is stale, or a record's environment shims differ from what the manifest applies.

## Manifest: `adapterMatrix` in `../seed.json`

| Key | Meaning |
| --- | --- |
| `toolchain` | Exact TypeScript, Vitest, `@vitest/browser`, Playwright and Vite versions installed in every cell. |
| `commands` | Command order and per-command timeouts (seconds). |
| `renderers`, `rendererNote` | Render backends (`webgl`, `webgpu`). |
| `gpuProfiles`, `defaultGpuProfile`, `softwareRendererPatterns` | GPU profiles (`software`, `hardware`): the Chromium flags of each backend, headless or headed, and whether the render check must see software rendering or a real GPU (renderer strings that mean software). |
| `environmentShims` | Labelled workarounds for upstream pixi.js bugs that the harness applies to one backend of one Pixi adapter on a pixi.js range, under every GPU profile: id, range, `fixedIn`, `action`, `does`, `reason`, `evidence`, `links`, `knownIssue` ([above](#environment-shims)). `validateAdapterMatrix` requires all of them, a range that ends at or below `fixedIn` and covers a nightly cell, a known action, and a known issue whose range contains the shim's. Today: `pixi-webgpu-texture-units`. |
| `knownIssues` | Known upstream issues: a Pixi adapter, a backend, a pixi.js range (`from` inclusive, `before` exclusive), `fixedIn`, a summary, advice and links. They change no verdict (owner rulings: verified + known issue; 2026-10-11, the matrix measures this project); the release table, COMPATIBILITY.md and the record Markdown mark each verified tuple or range it covers with its footnote, which names the environment shim that works around it, if any. `validateAdapterMatrix` requires the range, a backend the adapter has and https links. Today: WebGPU before pixi.js 8.10 (pixijs/pixijs#11389). |
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
