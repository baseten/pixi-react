#!/usr/bin/env node
// Runs adapter compatibility cells (issue 13). Same command locally and in CI:
//
//   node design/compatibility/cells/run-cells.mjs <command> [options]
//
//   validate                       check the seed's adapterMatrix section (offline)
//   list    --tier pr|nightly      print the cells (--format json|github|table)
//   pack    --out DIR              pack the built workspace artifacts and record content hashes
//   key     --cell ID              cache keys of one cell (needs --tarballs)
//   run     --tier T | --cell IDS  run cells (--negative: the deliberately incompatible pairs; --react V,V and
//                                  --pixi V,V keep the tier's cells with those exact versions)
//   all     --tier T               probes, cells and negative cases, then the table: what the required PR check runs
//   probes  --tier T | --probe IDS run the fast #3 type/API probes at Pixi boundaries
//   table   --results DIR          render the compatibility table from result files
//   report  --tier T --out DIR     CI: table, results JSON and failure list; a missing result is a failure
//   data    [--group IDS]          data-only probes (data-only.json): recorded, never verification; results in data-results/
//
// Common options: --tarballs DIR (default .compat/tarballs, packed on demand), --work DIR (default .compat),
// --patches latest|all, --renderers webgl,webgpu (override the tier's render backends), --gpu software|hardware (the
// GPU profile, `adapterMatrix.gpuProfiles`: software rendering by default, as in CI; `hardware` uses the machine's real
// GPU and fails a run that lands on a software renderer), --headed / --headless (override the profile's browser mode),
// --no-cache, --keep (keep the isolated project).
//
// Runs on Linux, macOS and Windows (Node 22, npm and pnpm on PATH): commands are spawned without a POSIX shell, and on
// Windows npm and pnpm through their .cmd shims.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { boundaryProbes, cellArtifacts, cellKey, classifyExpectedBlank, expectedBlankFor, expectedPixiProvides, expectedTree, gpuProfileOf, loadSeed, makeCell, negativeCells, plannedRows, platformCommand, renderCompatibilityDoc, renderTable, selectCells, splitConformanceReport, validateAdapterMatrix } from './matrix.mjs';
import { packArtifacts, readArtifacts } from './pack.mjs';
import { runProbe } from './probes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const seed = loadSeed();
const matrix = seed.adapterMatrix;

function parseArguments(argv)
{
    const [command, ...rest] = argv;
    const options = { command, flags: new Set() };

    for (let index = 0; index < rest.length; index++)
    {
        const name = rest[index];

        assert.ok(name.startsWith('--'), `unexpected argument ${name}`);
        const key = name.slice(2);

        if (['no-cache', 'keep', 'negative', 'json', 'manifest-only', 'no-probes', 'headed', 'headless'].includes(key)) options.flags.add(key);
        else options[key] = rest[++index];
    }

    return options;
}

const options = parseArguments(process.argv.slice(2));

// A selector passed but empty (an unset CI matrix value) must not fall back to running everything.
for (const selector of ['cell', 'probe', 'chunk', 'group', 'react', 'pixi'])
{
    assert.ok(!(selector in options) || options[selector]?.trim(), `--${selector} was given an empty value`);
}
const work = resolve(options.work ?? join(root, '.compat'));
// The GPU profile of this run: which Chromium flags provide each backend, and whether the render check must find a
// software renderer or a real GPU.
const gpu = gpuProfileOf(seed, options.gpu);

assert.ok(!(options.flags.has('headed') && options.flags.has('headless')), '--headed and --headless contradict each other');
const headless = options.flags.has('headed') ? false : options.flags.has('headless') ? true : gpu.headless;
const csv = (value) => (value ? value.split(',').map((part) => part.trim()).filter(Boolean) : undefined);
const tail = (text, lines = 40) => text.split('\n').slice(-lines).join('\n');

/** Hash of everything besides the packed artifacts that decides a verdict: harness files, this runner, probe sources. */
function harnessHash()
{
    const files = [];
    const collect = (dir) =>
    {
        for (const entry of readdirSync(dir, { withFileTypes: true }))
        {
            const path = join(dir, entry.name);

            if (entry.isDirectory()) collect(path);
            else files.push(path);
        }
    };

    collect(join(here, 'harness'));
    for (const name of ['run-cells.mjs', 'matrix.mjs', 'pack.mjs']) files.push(join(here, name));
    for (const adapter of Object.values(matrix.pixiAdapters)) files.push(join(root, adapter.probeSource));
    const hash = createHash('sha256');

    // Paths relative to the repository with forward slashes, so the hash is the same on every platform.
    for (const file of files.sort()) hash.update(file.slice(root.length).split('\\').join('/')).update(readFileSync(file));

    return hash.digest('hex');
}

const environment = () => ({ platform: process.platform, arch: process.arch, node: process.versions.node, runner: 'compat-1' });

function getArtifacts()
{
    const dir = resolve(options.tarballs ?? join(work, 'tarballs'));

    if (!existsSync(join(dir, 'artifacts.json'))) packArtifacts(seed, dir, root);

    return readArtifacts(dir);
}

function selectedCells()
{
    const ids = csv(options.cell);

    if (options.flags.has('negative')) return negativeCells(seed).filter((cell) => !ids || ids.includes(cell.id));
    const tier = options.tier ?? 'pr';
    const cells = selectCells(seed, tier, { patches: options.patches, renderers: csv(options.renderers) });
    const reacts = csv(options.react);
    const pixis = csv(options.pixi);
    const chosen = cells.filter((cell) => (!ids || ids.some((id) => cell.id === id || cell.id.includes(id)))
        && (!reacts || reacts.includes(cell.react.version)) && (!pixis || pixis.includes(cell.pixi.version)));

    assert.ok(!(ids || reacts || pixis) || chosen.length > 0, `no ${tier} cell matches ${[ids, reacts, pixis].filter(Boolean).flat().join(', ')}`);

    return chosen;
}

/** Everything the in-cell checks need, as data. */
function cellConfig(cell, artifacts)
{
    const { adapter: reactAdapter } = cell.react;
    const { adapter: pixiAdapter } = cell.pixi;
    const spec = (adapter) => (adapter.entry === '.' ? artifacts[adapter.artifact].package : `${artifacts[adapter.artifact].package}${adapter.entry.slice(1)}`);
    const tree = expectedTree(cell);
    const packed = {};

    for (const adapter of [reactAdapter, pixiAdapter])
    {
        packed[artifacts[adapter.artifact].package] = { peers: adapter.declaredPeers, forbiddenDependencies: adapter.bundled ?? [] };
    }
    for (const id of matrix.commonArtifacts) packed[artifacts[id].package] = {};

    return {
        id: cell.id,
        label: cell.label,
        formats: matrix.formats,
        // The React adapter's capabilities (its React line, and what every cell's DOM and Pixi globals provide) plus the
        // Pixi adapter's scene capabilities (Pixi 8's GraphicsContext and renderer destroy options, for example).
        conformanceCapabilities: [...new Set([...reactAdapter.conformanceCapabilities, ...pixiAdapter.conformanceCapabilities])],
        probeFactory: pixiAdapter.probeFactory,
        appOptions: pixiAdapter.conformanceAppOptions,
        // Each render backend this cell runs the conformance suite on: the Chromium flags that provide it (from the GPU
        // profile) and the application options that request it (harness/vitest.config.mts and harness/test/renderer.ts
        // read these), plus the expected-blank-render entry that covers it under this profile, if any.
        renderers: Object.fromEntries(cell.renderers.map((name) =>
        {
            const blank = cell.kind === 'cell' ? expectedBlankFor(seed, { pixiAdapter: cell.pixi.adapterKey, pixi: cell.pixi.version, renderer: name, gpuProfile: gpu.id }) : null;

            return [name, { chromiumArgs: gpu.chromiumArgs[name], appOptions: pixiAdapter.renderers[name].appOptions, ...(blank ? { expectedBlankRender: { id: blank.id, signature: blank.signature } } : {}) }];
        })),
        // The GPU profile: harness/vitest.config.mts launches the browser headed or headless, and the render check
        // (harness/test/backend.test.tsx) fails a run whose renderer is not what the profile expects (software or a GPU).
        gpuProfile: { id: gpu.id, expect: gpu.expect, headless, softwarePatterns: matrix.softwareRendererPatterns },
        expectedConformanceFailures: reactAdapter.expectedConformanceFailures ?? {},
        optimizeDeps: [...new Set([...matrix.commonArtifacts.filter((id) => id !== 'conformance').map((id) => artifacts[id].package), spec(reactAdapter), spec(pixiAdapter), 'pixi.js'])],
        tree: { exact: tree.exact, absent: tree.absent, reconciler: tree.reconciler },
        // Data-only probes only: run the conformance suite past the adapters' environment checks (harness/test/binding.tsx).
        ...(cell.dataOnly ? { dataOnly: cell.dataOnly } : {}),
        packed,
        adapters: {
            react: {
                spec: spec(reactAdapter),
                className: reactAdapter.className,
                adapterId: reactAdapter.adapterId,
                sameClassAcrossFormats: reactAdapter.sameClassAcrossFormats,
                abi: reactAdapter.abi,
                provides: reactAdapter.provides,
                requires: reactAdapter.requires,
                info: { export: reactAdapter.reconciler.infoExport, field: reactAdapter.reconciler.infoField, expected: cell.react.reconciler },
            },
            pixi: {
                spec: spec(pixiAdapter),
                className: pixiAdapter.className,
                adapterId: pixiAdapter.adapterId,
                sameClassAcrossFormats: pixiAdapter.sameClassAcrossFormats,
                abi: pixiAdapter.abi,
                provides: expectedPixiProvides(seed, cell.pixi.adapterKey, cell.pixi.version),
                requires: pixiAdapter.requires,
            },
        },
    };
}

/** The generated configuration a cell's checks assert; negative cells assert their own expectation instead. */
const effectiveConfig = (cell, artifacts) => (cell.kind === 'negative' ? null : cellConfig(cell, artifacts));

const TOOLCHAIN_FOR = { types: ['typescript'], conformance: ['vitest', '@vitest/browser', 'playwright', 'vite'] };

function writeProject(cell, dir, artifacts, config)
{
    const dependencies = {};

    // Forward slashes: npm reads `file:C:/...` on Windows as well.
    for (const id of cellArtifacts(seed, cell)) dependencies[artifacts[id].package] = `file:${artifacts[id].file.split('\\').join('/')}`;
    Object.assign(dependencies, cell.deps);
    for (const command of cell.commands) for (const name of TOOLCHAIN_FOR[command] ?? []) dependencies[name] = cell.toolchain[name];
    // Data-only probes may swap a transitive dependency (the reconciler) with an npm override; verification cells never do.
    const overrides = cell.install?.overrides ? { overrides: cell.install.overrides } : {};

    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'compat-cell', private: true, type: 'module', dependencies, ...overrides }, null, 2)}\n`);
    writeFileSync(join(dir, 'cell.json'), `${JSON.stringify(config, null, 2)}\n`);

    cpSync(join(here, 'harness'), dir, { recursive: true });
    const substitute = (file, extra = {}) =>
    {
        const tokens = { '%REACT_SPEC%': config.adapters.react.spec, '%REACT_CLASS%': config.adapters.react.className, '%PIXI_SPEC%': config.adapters.pixi.spec, '%PIXI_CLASS%': config.adapters.pixi.className, ...extra };
        let text = readFileSync(file, 'utf8');

        for (const [token, value] of Object.entries(tokens)) text = text.replaceAll(token, value);
        writeFileSync(file, text);
    };
    const roots = `roots.${cell.react.adapter.typeProbes[0]}.tsx`;

    for (const name of readdirSync(join(dir, 'typecheck'))) substitute(join(dir, 'typecheck', name), { '%ROOTS_PROBE%': roots, '%PIXI_CONSUMER%': cell.pixi.adapter.typeConsumer });
    cpSync(join(dir, 'typecheck', 'adapter.ts'), join(dir, 'test', 'adapter.ts'));
    cpSync(join(root, cell.pixi.adapter.probeSource), join(dir, 'test', 'pixiProbe.ts'));
}

/** Runs one command in the cell, logging stdout and stderr to the diagnostics directory. */
function execute(name, args, { cwd, log, timeoutSeconds, env }, runner = process.execPath)
{
    const started = Date.now();
    // Node itself runs directly; npm goes through its .cmd shim on Windows.
    const command = runner === process.execPath ? { file: runner, args, shell: false } : platformCommand(runner, args);
    const result = spawnSync(command.file, command.args, { cwd, encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 256 * 1024 * 1024, env, shell: command.shell });
    const output = `$ ${runner} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n[${result.error.code ?? result.error.message}]` : ''}${result.signal ? `\n[killed by ${result.signal} after ${timeoutSeconds}s]` : ''}\n`;

    writeFileSync(log, output);

    return { name, status: result.status === 0 && !result.error ? 'pass' : 'fail', exit: result.status, signal: result.signal, ms: Date.now() - started, output };
}

function commandLine(name, cell)
{
    const bin = (path) => [path];

    switch (name)
    {
        case 'install': return { runner: 'npm', args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', cell.install?.legacyPeerDeps ? '--legacy-peer-deps' : '--strict-peer-deps', '--loglevel=error'] };
        case 'tree': return { args: ['checks/tree.mjs'] };
        case 'modules': return { args: ['checks/modules.mjs'] };
        case 'types': return { args: [...bin('node_modules/typescript/bin/tsc'), '-p', 'typecheck/tsconfig.bundler.json'], then: [{ args: [...bin('node_modules/typescript/bin/tsc'), '-p', 'typecheck/tsconfig.nodenext.json'] }] };
        // One run per render backend (cell.renderers); each writes its own report.
        case 'conformance': return { perRenderer: (renderer) => ({ args: ['node_modules/vitest/vitest.mjs', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=conformance-${renderer}.json`] }) };
        default: throw new Error(`unknown command ${name} in ${cell.id}`);
    }
}

function assertIsolated(dir)
{
    for (let parent = dirname(dir); parent !== dirname(parent); parent = dirname(parent))
    {
        assert.ok(!existsSync(join(parent, 'node_modules')), `${parent}/node_modules exists above the isolated project ${dir}; it could hide a missing dependency`);
    }
}

/** The lines of a failed command that say why: errors, failed tests and npm's peer complaints, at most 25. */
function dataExcerpt(output)
{
    const wanted = /(FAIL|Error|error|✗|×|failed|rejected|ERESOLVE|invalid|missing|expected|TS\d{4})/;

    return output.split('\n').filter((line) => wanted.test(line) && !line.startsWith('$ ')).map((line) => line.trim().slice(0, 300)).filter((line, index, all) => all.indexOf(line) === index).slice(0, 25);
}

/** What harness/test/backend.test.tsx printed about the browser's renderer (`COMPAT_BACKEND {...}`), or null. */
function backendInfo(output)
{
    const line = output.split('\n').find((text) => text.startsWith('COMPAT_BACKEND '));

    try
    {
        return line ? JSON.parse(line.slice('COMPAT_BACKEND '.length)) : null;
    }
    catch
    {
        return null;
    }
}

function runCell(cell, artifacts, { harness, verdicts, out, results })
{
    const started = Date.now();
    const { key, depsKey } = cellKey(seed, cell, artifacts, harness, environment(), effectiveConfig(cell, artifacts));
    const outDir = join(out, cell.id);
    const base = { id: cell.id, kind: cell.kind, label: cell.label, adapterLabel: cell.react.adapter.id, reactVersion: cell.react.version, pixiVersion: cell.pixi.version, gpuProfile: gpu.id, key, depsKey, expect: cell.expect, description: cell.description, commands: {} };
    const verdictFile = join(verdicts, `${key}.json`);

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    mkdirSync(results, { recursive: true });
    if (cell.kind === 'cell' && !options.flags.has('no-cache') && existsSync(verdictFile))
    {
        const previous = JSON.parse(readFileSync(verdictFile, 'utf8'));
        const row = { ...base, status: 'cached-pass', commands: previous.commands, conformance: previous.conformance, backends: previous.backends, knownFailures: previous.knownFailures, ...(previous.expectedBlank ? { expectedBlank: previous.expectedBlank } : {}), message: `verdict cached for key ${key.slice(0, 12)} (same packed artifacts, versions and harness)`, durationMs: 0 };

        writeFileSync(join(results, `${cell.id}.json`), `${JSON.stringify(row, null, 2)}\n`);

        return row;
    }

    const dir = mkdtempSync(join(tmpdir(), `compat-${cell.id.replace(/[^\w.-]/g, '_')}-`));
    const env = { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'development' };

    delete env.NODE_PATH;
    if (options.cache) env.npm_config_cache = resolve(options.cache);
    let failure = null;

    try
    {
        assertIsolated(dir);
        const config = cellConfig(cell, artifacts);

        base.knownFailures = Object.keys(config.expectedConformanceFailures);
        writeProject(cell, dir, artifacts, config);
        for (const name of cell.commands)
        {
            const spec = commandLine(name, cell);

            if (spec.perRenderer)
            {
                // Every backend runs even when an earlier one failed, so the result records each backend separately.
                base.backends = {};
                let total = 0;

                for (const renderer of cell.renderers)
                {
                    const run = spec.perRenderer(renderer);
                    const step = execute(name, run.args, { cwd: dir, log: join(outDir, `${name}-${renderer}.log`), timeoutSeconds: matrix.commands.timeoutSeconds[name], env: { ...env, COMPAT_RENDERER: renderer } }, run.runner);
                    const info = backendInfo(step.output);
                    const blank = config.renderers[renderer].expectedBlankRender;
                    let status = step.status;
                    let note;

                    total += step.ms;
                    if (blank)
                    {
                        // On the expected-blank-render list: like the 8.5.0 known-failure probe, the run must fail exactly
                        // as listed (scenarios all pass, the canvas reads back blank); a render or any other failure fails.
                        const reportFile = join(dir, `conformance-${renderer}.json`);
                        const split = existsSync(reportFile) ? splitConformanceReport(JSON.parse(readFileSync(reportFile, 'utf8'))) : {};
                        const verdict = classifyExpectedBlank({ ...blank, ...matrix.expectedBlankRender.find((entry) => entry.id === blank.id) }, { ...split, renderer: info?.actual, readback: info?.readback, gpu: info?.gpu });

                        status = verdict.status;
                        note = verdict.message;
                    }
                    base.backends[renderer] = { status, ms: step.ms, backend: info, ...(blank ? { expectedBlankRender: blank.id, note } : {}), ...(cell.kind === 'data' && step.status !== 'pass' ? { excerpt: dataExcerpt(step.output) } : {}) };
                    if (status === 'fail' && !failure) failure = { command: name, renderer, output: note ? `${note}\n${step.output}` : step.output };
                }
                // An expected blank render is not a failure of the command (and verifies nothing: see verification.mjs).
                base.commands[name] = { status: Object.values(base.backends).every((backend) => ['pass', 'expected-fail'].includes(backend.status)) ? 'pass' : 'fail', ms: total };
                const blanks = Object.entries(base.backends).filter(([, backend]) => backend.status === 'expected-fail').map(([renderer]) => renderer);

                if (blanks.length) base.expectedBlank = blanks;
                if (failure && cell.kind !== 'data') break;
                continue;
            }
            let step = execute(name, spec.args, { cwd: dir, log: join(outDir, `${name}.log`), timeoutSeconds: matrix.commands.timeoutSeconds[name], env }, spec.runner);

            for (const next of step.status === 'pass' ? spec.then ?? [] : [])
            {
                const second = execute(name, next.args, { cwd: dir, log: join(outDir, `${name}-2.log`), timeoutSeconds: matrix.commands.timeoutSeconds[name], env }, next.runner);

                step = { ...second, ms: step.ms + second.ms, output: step.output + second.output };
            }
            base.commands[name] = { status: step.status, ms: step.ms };
            if (step.status !== 'pass')
            {
                failure ??= { command: name, output: step.output };
                // A data-only probe records every command it can run; only a failed install ends it.
                if (cell.kind === 'data')
                {
                    base.commands[name].excerpt = dataExcerpt(step.output);
                    if (name !== 'install') continue;
                }
                break;
            }
        }
    }
    catch (error)
    {
        failure = { command: 'setup', output: String(error.stack ?? error) };
        base.commands.setup = { status: 'fail', ms: 0 };
        writeFileSync(join(outDir, 'setup.log'), failure.output);
    }
    finally
    {
        for (const name of ['package.json', 'package-lock.json', 'cell.json', 'npm-ls.json', 'tree-report.json', ...cell.renderers.map((renderer) => `conformance-${renderer}.json`)]) if (existsSync(join(dir, name))) cpSync(join(dir, name), join(outDir, name));
        for (const name of ['typecheck', 'test/__screenshots__']) if (existsSync(join(dir, name))) cpSync(join(dir, name), join(outDir, name.replace('/', '-')), { recursive: true });
        if (!options.flags.has('keep')) rmSync(dir, { recursive: true, force: true });
        else process.stdout.write(`kept ${dir}\n`);
    }

    for (const renderer of cell.renderers)
    {
        const file = join(outDir, `conformance-${renderer}.json`);

        if (!existsSync(file) || !base.backends?.[renderer]) continue;
        const report = JSON.parse(readFileSync(file, 'utf8'));

        base.backends[renderer].conformance = { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests + (report.numTodoTests ?? 0), total: report.numTotalTests };
        // The first backend's counts (WebGL) stay in `conformance`, as before backends were separate.
        base.conformance ??= base.backends[renderer].conformance;
    }
    base.durationMs = Date.now() - started;

    if (cell.kind === 'negative')
    {
        const wanted = cell.expect;
        const missing = failure ? wanted.signatures.filter((signature) => !failure.output.includes(signature)) : wanted.signatures;

        if (!failure) Object.assign(base, { status: 'fail', message: `Expected "${wanted.failingCommand}" to reject this installation, but every command passed: the incompatibility guard no longer fires.` });
        else if (failure.command !== wanted.failingCommand) Object.assign(base, { status: 'fail', message: `Expected "${wanted.failingCommand}" to fail but "${failure.command}" did.\n${tail(failure.output, 15)}` });
        else if (missing.length) Object.assign(base, { status: 'fail', message: `"${wanted.failingCommand}" failed, but its output lacks: ${missing.join(' | ')}.\n${tail(failure.output, 15)}` });
        else
        {
            const line = failure.output.split('\n').find((candidate) => candidate.includes(wanted.signatures.at(-1))) ?? '';

            Object.assign(base, { status: 'expected-fail', message: line.replace(/^(npm error\s+)?\s*-?\s*/, '').trim() || `fails at ${wanted.failingCommand}` });
        }
    }
    else if (cell.kind === 'data')
    {
        // Data, not a verdict: never cached, never verification.
        base.status = failure ? 'fail' : 'pass';
        base.dataOnly = cell.dataOnly;
        base.group = cell.group;
    }
    else if (failure)
    {
        Object.assign(base, { status: 'fail', failedCommand: failure.command, ...(failure.renderer ? { failedRenderer: failure.renderer } : {}), message: `${failure.command}${failure.renderer ? ` (${failure.renderer})` : ''} failed:\n${tail(failure.output, 30)}` });
    }
    else
    {
        base.status = 'pass';
        mkdirSync(verdicts, { recursive: true });
        writeFileSync(verdictFile, `${JSON.stringify({ id: cell.id, key, commands: base.commands, conformance: base.conformance, backends: base.backends, knownFailures: base.knownFailures, ...(base.expectedBlank ? { expectedBlank: base.expectedBlank } : {}), at: new Date().toISOString() }, null, 2)}\n`);
    }
    writeFileSync(join(results, `${cell.id}.json`), `${JSON.stringify(base, null, 2)}\n`);

    return base;
}

function printRow(row)
{
    const timing = Object.entries(row.commands ?? {}).map(([name, step]) => `${name} ${step.status === 'pass' ? '' : 'FAIL '}${(step.ms / 1000).toFixed(1)}s`).join(', ');
    const count = (conformance) => `${conformance.passed} passed/${conformance.skipped} skipped/${conformance.failed} failed`;
    const backends = Object.entries(row.backends ?? {}).filter(([, backend]) => backend.conformance);
    const counts = backends.length ? `, ${backends.map(([name, backend]) => `${name} ${count(backend.conformance)}`).join(', ')}` : row.conformance ? `, conformance ${count(row.conformance)}` : '';

    process.stdout.write(`${row.status.toUpperCase().padEnd(13)} ${row.id}  [${timing}${counts}]  key ${row.key.slice(0, 12)}\n`);
    for (const [name, backend] of Object.entries(row.backends ?? {})) if (backend.note) process.stdout.write(`    ${name}: ${backend.note}\n`);
    if (row.status === 'fail' || row.status === 'expected-fail') process.stdout.write(`${(row.message ?? '').split('\n').map((line) => `    ${line}`).join('\n')}\n`);
}

function commandRun(cells = selectedCells())
{
    const artifacts = getArtifacts();
    const harness = harnessHash();
    const context = { harness, verdicts: resolve(options.verdicts ?? join(work, 'verdicts')), out: join(work, 'out'), results: join(work, 'results') };
    const rows = cells.map((cell) =>
    {
        const row = runCell(cell, artifacts, context);

        printRow(row);

        return row;
    });
    const bad = rows.filter((row) => row.status === 'fail');

    const blank = rows.filter((row) => row.expectedBlank?.length).length;

    process.stdout.write(`${rows.length} cells (GPU profile ${gpu.id}): ${rows.filter((row) => row.status === 'pass').length} passed${blank ? ` (${blank} with an expected blank render, unverified on that backend)` : ''}, ${rows.filter((row) => row.status === 'cached-pass').length} cached, ${rows.filter((row) => row.status === 'expected-fail').length} rejected as expected, ${bad.length} failed. Diagnostics: ${context.out}\n`);
    process.exitCode = process.exitCode || (bad.length ? 1 : 0);
}

/** The data-only probe cells of data-only.json (optionally only some groups), at the requested render backends. */
function dataCells()
{
    const spec = JSON.parse(readFileSync(join(here, 'data-only.json'), 'utf8'));
    const groups = csv(options.group);
    const cells = [];

    for (const group of spec.groups.filter((candidate) => !groups || groups.includes(candidate.id)))
    {
        for (const pixi of group.pixi)
        {
            for (const react of group.react)
            {
                const cell = makeCell(seed, { react: { epoch: react.epoch, version: react.version, typesReact: react.typesReact }, pixi }, { renderers: csv(options.renderers) ?? Object.keys(matrix.renderers) });

                cells.push({
                    ...cell,
                    id: `data-react-${react.version}_pixi-${pixi.version}`,
                    kind: 'data',
                    group: group.id,
                    react: { ...cell.react, reconciler: react.reconciler ?? cell.react.reconciler },
                    install: { legacyPeerDeps: true, ...(react.reconciler ? { overrides: { 'react-reconciler': react.reconciler } } : {}) },
                    dataOnly: { bypassEnvironmentCheck: true },
                });
            }
        }
    }
    assert.ok(cells.length > 0, 'no data-only probe selected');

    return cells;
}

function commandData()
{
    const artifacts = getArtifacts();
    const context = { harness: harnessHash(), verdicts: join(work, 'data-verdicts'), out: join(work, 'data-out'), results: join(work, 'data-results') };
    const rows = dataCells().map((cell) =>
    {
        const row = runCell(cell, artifacts, context);

        printRow(row);
        for (const [name, step] of Object.entries(row.commands)) if (step.excerpt) process.stdout.write(`    ${name}: ${step.excerpt.slice(0, 6).join('\n      ')}\n`);
        for (const [name, backend] of Object.entries(row.backends ?? {})) if (backend.excerpt) process.stdout.write(`    conformance (${name}): ${backend.excerpt.slice(0, 6).join('\n      ')}\n`);

        return row;
    });

    process.stdout.write(`${rows.length} data-only probes: ${rows.filter((row) => row.status === 'pass').length} ran clean, ${rows.filter((row) => row.status === 'fail').length} recorded a failure. Data, not verification. Results: ${context.results}\n`);
}

function commandProbes()
{
    const tier = options.tier ?? 'pr';
    const ids = csv(options.probe);
    const probes = boundaryProbes(seed, tier).filter((probe) => !ids || ids.includes(probe.id));

    assert.ok(probes.length > 0, 'no probe selected');
    const results = join(work, 'results');
    let failed = 0;

    mkdirSync(results, { recursive: true });
    for (const probe of probes)
    {
        const row = runProbe(seed, probe, { out: join(work, 'out', 'probes'), npmCache: options.cache ? resolve(options.cache) : undefined });

        process.stdout.write(`${row.status.toUpperCase().padEnd(13)} ${row.id}  (${probe.boundary})${row.message ? `\n${row.message.split('\n').map((line) => `    ${line}`).join('\n')}` : ''}\n`);
        writeFileSync(join(results, `probe-${row.id}.json`), `${JSON.stringify({ ...row, kind: 'probe', boundary: probe.boundary }, null, 2)}\n`);
        if (row.status === 'fail') failed++;
    }
    process.stdout.write(`${probes.length} probes, ${failed} failed.\n`);
    process.exitCode = process.exitCode || (failed ? 1 : 0);
}

/** Result rows and probe rows written by earlier `run` / `probes` calls. */
function loadResults(dir)
{
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
    const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

    return { rows: files.filter((name) => !name.startsWith('probe-')).map(read), probes: files.filter((name) => name.startsWith('probe-')).map(read) };
}

/**
 * The table, boundary probes and failures as Markdown. With `expected` (cell and probe ids a tier should have produced),
 * a missing result counts as a failure, so a crashed or cancelled job cannot read as green.
 */
function buildReport({ rows, probes }, { title, expectedCells, expectedProbes })
{
    const have = new Set(rows.map((row) => row.id));
    const haveProbes = new Set(probes.map((probe) => probe.id));
    const missing = (cell) => ({ id: cell.id, kind: cell.kind, label: cell.label, adapterLabel: cell.react.adapter.id, reactVersion: cell.react.version, pixiVersion: cell.pixi.version, status: 'fail', expect: cell.expect, message: 'No result was produced (the job crashed, timed out or was cancelled).' });
    const allRows = [...rows, ...(expectedCells ?? []).filter((cell) => !have.has(cell.id)).map(missing)];
    const allProbes = [...probes, ...(expectedProbes ?? []).filter((probe) => !haveProbes.has(probe.id)).map((probe) => ({ id: probe.id, boundary: probe.boundary, status: 'fail', message: 'No result was produced.' }))];
    const probeLines = allProbes.length ? `\n## Boundary probes\n\n| Tuple | Boundary | Result |\n| --- | --- | --- |\n${allProbes.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map((probe) => `| ${probe.id} | ${probe.boundary} | ${probe.status}${probe.warning ? ` (${probe.warning.split('\n')[0]})` : ''} |`).join('\n')}\n` : '';
    const failing = [...allRows, ...allProbes].filter((row) => row.status === 'fail');
    const failureLines = failing.map((row) => `- **${row.id}**: ${(row.message ?? '').split('\n').filter(Boolean)[0] ?? 'failed'}`);

    return {
        markdown: `${renderTable(seed, allRows, { title })}${probeLines}${failing.length ? `\n## Failures\n\n${failureLines.join('\n')}\n` : ''}`,
        failures: failing.map((row) => ({ id: row.id, message: row.message, failedCommand: row.failedCommand })),
        failureLines,
        rows: allRows,
        probes: allProbes,
    };
}

function commandTable()
{
    if (options.flags.has('manifest-only'))
    {
        process.stdout.write(renderTable(seed, plannedRows(seed, options.tier ?? 'pr', { patches: options.patches }), { title: options.title ?? 'Adapter compatibility table', manifestOnly: true }));

        return;
    }
    const tier = options.tier ?? 'pr';

    process.stdout.write(buildReport(loadResults(resolve(options.results ?? join(work, 'results'))), { title: options.title ?? `Adapter compatibility table (${tier})` }).markdown);
}

/** CI: write the table, the machine-readable results and the failure list; print `failed=` for GITHUB_OUTPUT. */
function commandReport()
{
    const tier = options.tier ?? 'pr';
    const expectedCells = [...selectCells(seed, tier, { patches: options.patches, filter: csv(options.filter), renderers: csv(options.renderers) }), ...negativeCells(seed)];
    const report = buildReport(loadResults(resolve(options.results ?? join(work, 'results'))), { title: `Adapter compatibility table (${tier})`, expectedCells, expectedProbes: options.flags.has('no-probes') ? [] : boundaryProbes(seed, tier) });
    const out = resolve(options.out ?? join(work, 'report'));

    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'compatibility-table.md'), report.markdown);
    writeFileSync(join(out, 'compatibility-results.json'), `${JSON.stringify({ tier, generatedAt: new Date().toISOString(), cells: report.rows, probes: report.probes }, null, 2)}\n`);
    writeFileSync(join(out, 'failures.md'), report.failureLines.join('\n'));
    process.stdout.write(`failed=${report.failures.length > 0}\ncount=${report.failures.length}\n`);
}

switch (options.command)
{
    case 'validate':
        validateAdapterMatrix(seed);
        process.stdout.write(`adapterMatrix ok: pr ${selectCells(seed, 'pr').length} cells, nightly ${selectCells(seed, 'nightly').length} cells, ${negativeCells(seed).length} negative cases\n`);
        break;
    case 'list':
    {
        const cells = options.flags.has('negative') ? negativeCells(seed) : selectCells(seed, options.tier ?? 'pr', { patches: options.patches, filter: csv(options.filter), renderers: csv(options.renderers) });
        const brief = (cell) => ({ id: cell.id, label: cell.label, react: cell.react.version, pixi: cell.pixi.version, commands: cell.commands });

        if (options.format === 'github') process.stdout.write(JSON.stringify({ cell: cells.map(brief) }));
        else if (options.format === 'chunks')
        {
            // Nightly: one job per Pixi version, running every React cell of that version (installs and browser start-up amortised).
            const groups = Object.groupBy(cells.map(brief), (cell) => cell.pixi);

            process.stdout.write(JSON.stringify({ chunk: Object.entries(groups).map(([pixi, list]) => ({ name: `pixi.js ${pixi}`, pixi, cells: list.map((cell) => cell.id).join(',') })) }));
        }
        else process.stdout.write(`${cells.map((cell) => `${cell.id}\t${cell.label}`).join('\n')}\n`);
        break;
    }
    case 'probe-list':
        process.stdout.write(JSON.stringify({ probe: boundaryProbes(seed, options.tier ?? 'pr').map((probe) => ({ id: probe.id, boundary: probe.boundary })) }));
        break;
    case 'pack':
    {
        const artifacts = packArtifacts(seed, resolve(options.out ?? join(work, 'tarballs')), root);

        for (const [id, artifact] of Object.entries(artifacts)) process.stdout.write(`${id.padEnd(12)} ${artifact.hash.slice(0, 16)} ${Object.entries(artifact.entries).map(([entry, scope]) => `${entry}:${scope.hash.slice(0, 12)}`).join(' ')}\n`);
        break;
    }
    case 'key':
    {
        const [cell] = [...selectedCells()];
        const artifacts = getArtifacts();
        const { key, depsKey } = cellKey(seed, cell, artifacts, harnessHash(), environment(), effectiveConfig(cell, artifacts));

        if (options.format === 'github') process.stdout.write(`key=${key}\ndepsKey=${depsKey}\n`);
        else process.stdout.write(`${cell.id} key ${key} depsKey ${depsKey}\n`);
        break;
    }
    case 'doc':
        process.stdout.write(renderCompatibilityDoc(seed));
        break;
    case 'toolchain':
        process.stdout.write(`${matrix.toolchain[options.name]}\n`);
        break;
    case 'run':
        commandRun();
        break;
    case 'all':
        // The local equivalent of the required PR check: boundary probes, the tier's cells, then the negative cases.
        // Repack unless tarballs were supplied, so a rebuilt adapter is never tested from stale tarballs.
        rmSync(join(work, 'results'), { recursive: true, force: true });
        if (!options.tarballs) packArtifacts(seed, join(work, 'tarballs'), root);
        commandProbes();
        commandRun(selectCells(seed, options.tier ?? 'pr', { patches: options.patches, renderers: csv(options.renderers) }));
        commandRun(negativeCells(seed));
        options.title = `Adapter compatibility table (${options.tier ?? 'pr'})`;
        commandTable();
        break;
    case 'probes':
        commandProbes();
        break;
    case 'data':
        commandData();
        break;
    case 'table':
        commandTable();
        break;
    case 'report':
        commandReport();
        break;
    default:
        process.stderr.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
        process.exitCode = 2;
}
