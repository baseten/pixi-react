#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Dated verification records (issue 17) and the `verifiedRanges` derived from them.
 *
 * A verification record is the machine-readable result of one nightly run of the compatibility matrix
 * (`run-cells.mjs run --tier nightly --patches all`, every boundary probe, every negative case) at one commit on one
 * machine under one GPU profile, with each render backend checked separately, plus the data-only probes in a separate
 * section that never verifies anything. `design/compatibility/verification/<id>.json` is the record and `<id>.md` is
 * rendered from it; `<id>` is the date, or the date and a machine slug (`2026-10-12-macos-m2`) for a record from another
 * machine. Within one machine and GPU profile the newest record supersedes the older ones (a later failure revokes
 * that machine's earlier verification); records of distinct machines or profiles add up, so a hardware (real-GPU)
 * record adds evidence beside the software one.
 *
 * Verification is evidence, not a support guarantee.
 *
 * The rule (`VERIFICATION_RULE`), per tuple (React adapter, exact React, Pixi adapter, exact pixi.js) and per render
 * backend: the tuple is verified on the backend when its cell passed on that backend in a record (every command, every
 * conformance scenario and the render check) and every boundary probe and negative case of that record behaved as
 * expected. A backend run that applied an environment shim (`adapterMatrix.environmentShims`, a labelled workaround for
 * an upstream pixi.js bug) is judged like any other: a pass verifies the tuple, which carries the shim's id
 * (`verifiedRanges[].environmentShims`), and a failure is a failure. Runs that records before 2026-10-11 list as expected
 * blank renders (the retired `expectedBlankRender` list) verify nothing. Backends are never inferred from each other.
 *
 * Usage:
 *   node design/compatibility/verification.mjs build --work DIR --date YYYY-MM-DD --commit SHA [--machine SLUG] [--sequence N]
 *       [--tarballs DIR]   # the packed artifacts the cells installed (default DIR/tarballs); a full record needs them
 *       [--scope full|partial] [--extra FILE]   # a record from a run's work directory (partial: only the cells it ran)
 *   node design/compatibility/verification.mjs refresh [--record ID] [--extra FILE]   # re-apply the manifest's lists and the rule
 *   node design/compatibility/verification.mjs render [--check]   # the .md files from the .json records
 *   node design/compatibility/verification.mjs ranges [--write]   # verifiedRanges from the records (into seed.json)
 *   node design/compatibility/verification.mjs compare --record ID --tarballs DIR   # same packed code as the run?
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, release, totalmem, type, version } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundaryProbes, BROWSERS, compareVersions, nodeRequirement, satisfiesNodeRange, environmentShimsFor, fileSetHash, gpuProfileOf, knownIssueFootnote, knownIssueMark, knownIssuesFor, loadSeed, negativeCells, platformCommand, selectCells, splitConformanceReport } from './cells/matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RECORDS_DIR = join(here, 'verification');
export const STATEMENT = 'Verification is evidence, not a support guarantee.';
export const SCHEMA_VERSION = 2;
export const VERIFICATION_RULE = 'A tuple (React adapter, exact React, Pixi adapter, exact pixi.js) is verified on a render backend when its cell '
    + 'passed on that backend in this record (every command, every conformance scenario and the render check) and every boundary probe '
    + 'and every negative case of this record behaved as expected. A backend run that applied an environment shim (adapterMatrix.environmentShims, '
    + 'a labelled workaround for an upstream pixi.js bug) is judged like any other: a pass verifies the tuple, which carries the shim id, and a '
    + 'failure is a failure. A run a record before 2026-10-11 lists as an expected blank render (the retired expectedBlankRender list) verifies '
    + 'nothing. Each tuple lists every backend it is verified on; backends are never inferred from each other.';
/**
 * The day environment shims replaced the expected-blank-render list (owner ruling, 2026-10-11). A record from this day on
 * lists, on every backend run, exactly the shims the manifest applies to it, and has no expected blank render; an older
 * record lists no shim and may keep the expected blank renders it recorded (they verify nothing).
 */
export const ENVIRONMENT_SHIMS_SINCE = '2026-10-11';
/**
 * From this day on a record must come from the required Node (package.json `engines.node`, the version in .nvmrc), and
 * a full record must name the packed artifacts its cells installed (so `compare` can check its code). Older records are
 * kept as recorded (2026-10-10-macos-26-apple-m5-max has no artifacts; a finding says so).
 */
export const RECORD_REQUIREMENTS_SINCE = '2026-10-11';
/** What a record says about how it rendered, by GPU profile: software verification counts, with this note. */
export const SOFTWARE_NOTE = 'Software rendering: no GPU took part. WebGL ran on ANGLE over SwiftShader and WebGPU on Dawn over SwiftShader\'s '
    + 'Vulkan device, a fallback adapter (isFallbackAdapter true). It counts as verification; a run on a real GPU '
    + '(run-cells.mjs --gpu hardware) can be added later as extra evidence.';
const RECORD_FILE = /^(\d{4}-\d{2}-\d{2})(-[a-z0-9]+(?:-[a-z0-9]+)*)?(\.[2-9]|\.[1-9]\d+)?\.json$/;

/**
 * A record's id: the date, the machine slug for another machine's record, and `.N` for the Nth record of that machine
 * and date (`--sequence N`, N >= 2), so a later run on the same day supersedes an earlier one without replacing its file.
 */
export const recordIdOf = ({ date, machine, sequence }) => `${date}${machine ? `-${machine}` : ''}${sequence > 1 ? `.${sequence}` : ''}`;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const backendNames = (seed) => Object.keys(seed.adapterMatrix.renderers);

/** The cells a verification run must produce: the nightly tier with both React patches, at every render backend. */
export const expectedCells = (seed) => selectCells(seed, 'nightly', { patches: 'all', renderers: backendNames(seed) });

function readRows(dir)
{
    if (!existsSync(dir)) return [];

    return readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => readJson(join(dir, name)));
}

const counts = (conformance) => (conformance ? { passed: conformance.passed, failed: conformance.failed, skipped: conformance.skipped, total: conformance.total } : null);

/**
 * The Vitest report of one backend run, split by test file: the conformance suite's scenarios, and the render backend
 * check (harness/test/backend.test.tsx), which the runner's totals count as one more test.
 */
function splitReport(file)
{
    if (!file || !existsSync(file)) return null;
    const { scenarios, backendCheck } = splitConformanceReport(readJson(file));

    return { suite: scenarios, backendCheck };
}

/** One backend of one result row, as recorded. */
function backendEntry(backend, reportFile)
{
    if (!backend) return { status: 'not run' };
    const info = backend.backend ?? {};
    const split = splitReport(reportFile);

    return {
        status: backend.status,
        ...(backend.note ? { note: backend.note } : {}),
        // The environment shims the run applied (harness/test/environment-shims.ts): id, parameter, original and clamped value.
        ...(backend.environmentShims?.length ? { environmentShims: backend.environmentShims } : {}),
        ...(split ? { scenarios: split.suite, backendCheck: split.backendCheck } : {}),
        conformance: counts(backend.conformance),
        renderer: info.actual ?? null,
        readback: info.readback ?? null,
        ...(info.webglRenderer ? { webglRenderer: info.webglRenderer } : {}),
        ...(info.gpuAdapter ? { gpuAdapter: info.gpuAdapter } : {}),
        ...(info.gpu ? { gpu: info.gpu } : {}),
        // The browser of this run (name, full version, Playwright channel), when the harness reported it.
        ...(backend.browser ?? info.browser ? { browser: backend.browser ?? info.browser } : {}),
    };
}

/** Why a row failed, in a few lines: the failed command and the first failing lines of its output. */
function failureSummary(row)
{
    if (row.status !== 'fail') return null;
    const lines = (row.message ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const useful = lines.filter((line) => /FAIL|Error|×|expected|failed|rejected/.test(line)).slice(0, 6);

    return { command: row.failedCommand ?? null, renderer: row.failedRenderer ?? null, lines: useful.length ? useful : lines.slice(0, 4) };
}

/**
 * The identity of an artifact's packed files without its Markdown (README) and without build logs (`.turbo/`, which a
 * package without a `files` list packs): what a later documentation-only commit leaves unchanged. `contentSha256`
 * covers every packed file.
 */
export const codeHash = (files) => fileSetHash(Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith('.md') && !path.startsWith('.turbo/'))));

/** Packages whose resolved version and integrity a record keeps for each cell (from the cell's package-lock.json). */
const RESOLVED = ['react', 'react-dom', 'pixi.js', 'react-reconciler', 'its-fine', 'scheduler', '@types/react', '@types/react-dom', 'typescript', 'vitest', 'playwright'];

/** What a cell's diagnostics directory says about its install and configuration: integrities, formats, capabilities. */
function cellEvidence(outDir, integrities)
{
    const evidence = {};
    const lockFile = join(outDir, 'package-lock.json');

    if (existsSync(lockFile))
    {
        const text = readFileSync(lockFile, 'utf8');
        const lock = JSON.parse(text);
        const resolved = {};

        evidence.lockfileSha256 = createHash('sha256').update(text).digest('hex');
        for (const [path, entry] of Object.entries(lock.packages ?? {}))
        {
            const name = RESOLVED.find((candidate) => path.endsWith(`node_modules/${candidate}`));

            if (!name || !entry.version) continue;
            resolved[name] ??= [];
            if (!resolved[name].includes(entry.version)) resolved[name].push(entry.version);
            if (entry.integrity) integrities[`${name}@${entry.version}`] = entry.integrity;
        }
        evidence.resolved = resolved;
    }
    const configFile = join(outDir, 'cell.json');

    if (existsSync(configFile))
    {
        const config = readJson(configFile);

        evidence.formats = config.formats;
        evidence.jsx = 'automatic';
        evidence.conformanceCapabilities = config.conformanceCapabilities;
        evidence.pixiProvides = Object.keys(config.adapters?.pixi?.provides ?? {});
    }

    return evidence;
}

const firstLine = (text) => (text ?? '').split('\n')[0].trim();

function commandVersion(name)
{
    const command = platformCommand(name, ['--version']);
    const result = spawnSync(command.file, command.args, { encoding: 'utf8', shell: command.shell });

    return result.status === 0 ? firstLine(result.stdout) : 'unknown';
}

/** A short description of a WebGPU adapter as the render check reported it. */
const describeAdapter = (adapter) => (adapter
    ? `${[adapter.vendor, adapter.architecture, adapter.device, adapter.description].filter(Boolean).join(' / ') || 'unnamed adapter'}, isFallbackAdapter ${adapter.isFallbackAdapter ?? 'unknown'}${adapter.fallbackSource ? ` (${adapter.fallbackSource === 'unknown' ? 'neither adapter.info.isFallbackAdapter nor adapter.isFallbackAdapter exists' : `from ${adapter.fallbackSource}`})` : ''}`
    : null);

/**
 * The browser of a run's backend runs (the harness reports name, full version and Playwright channel per run), or null
 * when none reported it (results from before browsers were recorded). One record covers one browser.
 */
export function browserOfRows(rows)
{
    const seen = rows.flatMap((row) => Object.values(row.backends ?? {}).map((backend) => backend.browser ?? backend.backend?.browser).filter(Boolean));
    const ids = [...new Set(rows.filter((row) => row.kind === 'cell' && row.browser).map((row) => row.browser))];
    const versions = [...new Set(seen.map((browser) => `${browser.name} ${browser.version}`))];

    assert.ok(ids.length <= 1, `the results mix browsers (${ids.join(', ')}): one record covers one browser`);
    assert.ok(versions.length <= 1, `the results mix browser versions (${versions.join(', ')}): one record covers one browser`);
    const id = ids[0] ?? seen[0]?.id ?? (seen.length ? 'chromium' : null);

    if (!id) return null;
    const known = BROWSERS[id];

    assert.ok(known, `unknown browser ${id}`);

    return { id, channel: known.channel, pinned: known.pinned, name: seen[0]?.name ?? null, version: seen[0]?.version ?? null };
}

/** The Browser row of a record: which browser, its version, and whether it was the Chromium pinned by Playwright. */
export function describeBrowser(env)
{
    if (!env.browser) return `${env.chromium}, Playwright ${env.playwright}`;
    const { name, version, channel, pinned } = env.browser;
    const mode = (/headless/).test(env.chromium ?? '') ? 'headless' : 'headed';
    const named = `${name ?? 'unknown browser'} ${version ?? '(version not reported)'}`;

    return pinned
        ? `${named} (${mode}), the Chromium pinned by Playwright ${env.playwright}`
        : `**${named} (${mode}), installed on the machine (Playwright channel \`${channel}\`), not the Chromium pinned by Playwright ${env.playwright}**; Playwright ${env.playwright} drove it`;
}

/**
 * The machine a run's results came from, when the caller gives none (`--extra`): OS, CPU, Node, npm, pnpm, and what the
 * browser reported in the render checks (Chromium version, WebGL renderer, WebGPU adapter).
 */
export function collectEnvironment(seed, rows, gpuProfile)
{
    const infos = rows.flatMap((row) => Object.values(row.backends ?? {}).map((backend) => backend.backend).filter(Boolean));
    const userAgent = infos.find((info) => info.userAgent)?.userAgent ?? '';
    const chrome = userAgent.match(/(HeadlessChrome|Chrome)\/([\d.]+)/);
    const browser = browserOfRows(rows);
    const webgl = [...new Set(infos.map((info) => info.webglRenderer).filter(Boolean))];
    const webgpu = [...new Set(infos.map((info) => describeAdapter(info.gpuAdapter)).filter(Boolean))];
    const cpu = cpus();

    return {
        os: `${version()} (${type()} ${release()})`,
        kernel: release(),
        arch: arch(),
        cpu: `${cpu.length} x ${cpu[0]?.model ?? 'unknown CPU'}, ${Math.round(totalmem() / 2 ** 30)} GiB RAM`,
        node: process.versions.node,
        npm: commandVersion('npm'),
        pnpm: commandVersion('pnpm'),
        playwright: seed.adapterMatrix.toolchain.playwright,
        chromium: chrome ? `Chromium ${chrome[2]}${chrome[1] === 'HeadlessChrome' ? ' headless' : ' headed'}` : 'unknown',
        ...(browser ? { browser } : {}),
        gpu: gpuProfile === 'hardware' ? `real GPU: ${[...webgl, ...webgpu].join('; ') || 'not reported'}` : 'none used: every backend renders in software',
        backends: { ...(webgl.length ? { webgl: webgl.join('; ') } : {}), ...(webgpu.length ? { webgpu: webgpu.join('; ') } : {}) },
    };
}

/** The sentence a hardware record's rendering note adds when its runs used an installed browser, not the pinned Chromium. */
const installedBrowserNote = (environment) => (environment?.browser && !environment.browser.pinned
    ? ` The browser was ${[environment.browser.name ?? environment.browser.id, environment.browser.version].filter(Boolean).join(' ')} as installed on the machine (Playwright channel ${environment.browser.channel}), not the Chromium pinned by Playwright.`
    : '');

/** How a record rendered: the GPU profile and a plain statement, which the record and every summary of it repeat. */
export function renderingOf(seed, gpuProfile, environment)
{
    const profile = gpuProfileOf(seed, gpuProfile);

    return profile.expect === 'software'
        ? { profile: profile.id, kind: 'software', note: SOFTWARE_NOTE }
        // The collected environment already says "real GPU: ..."; say it once.
        : { profile: profile.id, kind: 'hardware', note: `Real GPU: ${(environment?.gpu ?? 'see the environment').replace(/^real GPU:\s*/i, '')}. The render check confirmed no backend ran on a software renderer or a fallback adapter.${installedBrowserNote(environment)}` };
}

/** Whether a record's boundary probes and negative cases all behaved as expected: without it, the record verifies nothing. */
export function recordGate(record)
{
    return record.probes.length > 0 && record.probes.every((probe) => ['pass', 'expected-fail'].includes(probe.status))
        && record.negatives.length > 0 && record.negatives.every((negative) => negative.status === 'expected-fail');
}

/** Whether a backend entry's conformance suite itself ran: at least one scenario passed and none failed. */
export const scenariosRan = (entry) => Boolean(entry?.scenarios) && entry.scenarios.passed >= 1 && entry.scenarios.failed === 0;

/** The commands every matrix cell of a record runs (`adapterMatrix.commands.order`): each must be recorded. */
export const requiredCommands = (seed = loadSeed()) => seed.adapterMatrix.commands.order;

/** The required commands a cell's record lacks (a command that never ran is not a pass). */
export const missingCommands = (cell, required) => required.filter((name) => !Object.hasOwn(cell.commands ?? {}, name));

/** The verification rule for one tuple of a record on one backend. */
export function tupleVerified(record, cell, backend, gate = recordGate(record), required = requiredCommands())
{
    const entry = cell.backends[backend];

    // The backend passed with its suite and render check counted separately, every command the manifest requires was
    // recorded, and every one but the per-backend conformance run (whose result is the backend entry) passed.
    return gate && entry?.status === 'pass' && scenariosRan(entry) && entry.backendCheck === 'pass'
        && missingCommands(cell, required).length === 0
        && Object.entries(cell.commands).every(([name, status]) => name === 'conformance' || status === 'pass');
}

/** The summary block of a record, from its cells, probes and negative cases. */
export function summarizeRecord(seed, record)
{
    const gate = recordGate(record);
    const backends = {};

    for (const name of backendNames(seed))
    {
        const applicable = record.cells.filter((cell) => cell.backends[name] && cell.backends[name].status !== 'not applicable');

        backends[name] = {
            cells: applicable.length,
            passed: applicable.filter((cell) => cell.backends[name].status === 'pass').length,
            expectedBlank: applicable.filter((cell) => cell.backends[name].status === 'expected-fail').length,
            withEnvironmentShim: applicable.filter((cell) => cell.backends[name].environmentShims?.length).length,
            failed: applicable.filter((cell) => cell.backends[name].status === 'fail').length,
            notRun: applicable.filter((cell) => !['pass', 'fail', 'expected-fail'].includes(cell.backends[name].status)).length,
            backendCheckFailed: applicable.filter((cell) => cell.backends[name].backendCheck === 'fail').length,
            notApplicable: record.cells.length - applicable.length,
            scenarios: applicable.reduce((total, cell) =>
            {
                const scenarios = cell.backends[name].scenarios;

                return scenarios ? { passed: total.passed + scenarios.passed, failed: total.failed + scenarios.failed, skipped: total.skipped + scenarios.skipped } : total;
            }, { passed: 0, failed: 0, skipped: 0 }),
            verifiedTuples: applicable.filter((cell) => tupleVerified(record, cell, name, gate, requiredCommands(seed))).length,
        };
    }
    const { probes, negatives } = record;

    return {
        cells: record.cells.length,
        cellsPassedEveryBackend: record.cells.filter((cell) => cell.status === 'pass' && Object.values(cell.backends).every((entry) => ['pass', 'not applicable'].includes(entry.status))).length,
        cellsWithExpectedBlank: record.cells.filter((cell) => Object.values(cell.backends).some((entry) => entry.status === 'expected-fail')).length,
        backends,
        probes: { total: probes.length, passed: probes.filter((probe) => ['pass', 'expected-fail'].includes(probe.status)).length, expectedFailures: probes.filter((probe) => probe.status === 'expected-fail').length, failed: probes.filter((probe) => probe.status === 'fail').length, missing: probes.filter((probe) => probe.status === 'missing').length },
        negatives: { total: negatives.length, rejectedAsExpected: negatives.filter((row) => row.status === 'expected-fail').length, failed: negatives.filter((row) => row.status === 'fail').length, missing: negatives.filter((row) => row.status === 'missing').length },
    };
}

/**
 * Builds a verification record from a run's work directory (`results/` of the nightly cells, probes and negative
 * cases; `data-results/` of the data-only probes). `scope: 'partial'` records only the cells that have a result (a
 * targeted run); a full record lists every nightly cell and counts a missing one as missing.
 */
export function buildRecord(seed, { work, tarballs = join(work, 'tarballs'), date, commit, environment, run, dataSpec, machine, sequence = 1, scope = 'full' })
{
    const artifactsFile = join(tarballs, 'artifacts.json');
    const packed = existsSync(artifactsFile) ? readJson(artifactsFile) : {};

    // Without the packed artifacts a record cannot show which code it ran (`compare` would check nothing).
    if (!Object.keys(packed).length)
    {
        assert.ok(scope !== 'full', `${artifactsFile} is missing or empty: a full record needs the packed artifacts the cells installed (pass --tarballs with the directory the run packed to)`);
        console.warn(`warning: ${artifactsFile} is missing or empty; this partial record names no artifacts`);
    }
    const backends = backendNames(seed);
    const { rows, probes } = (() =>
    {
        const all = readRows(join(work, 'results'));

        return { rows: all.filter((row) => row.kind !== 'probe'), probes: all.filter((row) => row.kind === 'probe') };
    })();
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Matrix cells decide the GPU profile (negative cases stop before rendering).
    const profiles = [...new Set(rows.filter((row) => row.kind === 'cell').map((row) => row.gpuProfile ?? seed.adapterMatrix.defaultGpuProfile))];

    assert.ok(profiles.length <= 1, `the results mix GPU profiles (${profiles.join(', ')}): one record covers one profile`);
    const gpuProfile = profiles[0] ?? seed.adapterMatrix.defaultGpuProfile;
    // A person's environment (--extra) still gets the browser the runs reported, so a record always names it.
    const ranIn = browserOfRows(rows);
    const env = environment && Object.keys(environment).length ? { ...environment, ...(environment.browser || !ranIn ? {} : { browser: ranIn }) } : collectEnvironment(seed, rows, gpuProfile);

    assert.ok(['full', 'partial'].includes(scope), `scope ${scope}`);
    assert.ok(Number.isInteger(sequence) && sequence >= 1, `sequence ${sequence}`);
    assert.ok(gpuProfileOf(seed, gpuProfile).expect !== 'hardware' || machine, 'a hardware record needs --machine (a slug naming the machine, OS and GPU)');
    // npm integrity of every resolved package version any cell installed (cells list the versions they resolved).
    const integrities = {};
    const cells = expectedCells(seed).filter((cell) => scope === 'full' || byId.has(cell.id)).map((cell) =>
    {
        const row = byId.get(cell.id);
        const entry = {
            id: cell.id,
            reactAdapter: cell.react.adapter.id,
            react: cell.react.version,
            reconciler: cell.react.reconciler,
            pixiAdapter: cell.pixi.adapter.id,
            pixi: cell.pixi.version,
            status: row?.status ?? 'missing',
            commands: Object.fromEntries(Object.entries(row?.commands ?? {}).map(([name, step]) => [name, step.status])),
            backends: {},
        };

        for (const name of backends)
        {
            entry.backends[name] = cell.renderers.includes(name)
                ? backendEntry(row?.backends?.[name], join(work, 'out', cell.id, `conformance-${name}.json`))
                : { status: 'not applicable', reason: cell.pixi.adapter.rendererNote ?? `${cell.pixi.adapter.id} has no ${name} renderer` };
        }
        const failure = row ? failureSummary(row) : { command: null, renderer: null, lines: ['No result was produced.'] };

        if (failure) entry.failure = failure;
        entry.evidence = cellEvidence(join(work, 'out', cell.id), integrities);

        return entry;
    });
    const expectedProbes = boundaryProbes(seed, 'nightly');
    const probeRows = expectedProbes.map((probe) =>
    {
        const row = probes.find((candidate) => candidate.id === probe.id);

        return { id: probe.id, boundary: probe.boundary, status: row?.status ?? 'missing', ...(row?.warning ? { warning: row.warning.split('\n')[0] } : {}), ...(row?.status === 'fail' ? { message: (row.message ?? '').split('\n').slice(0, 4).join(' ') } : {}) };
    });
    const negatives = negativeCells(seed).map((cell) =>
    {
        const row = byId.get(cell.id);

        return { id: cell.id, failingCommand: cell.expect.failingCommand, status: row?.status ?? 'missing', message: (row?.message ?? '').split('\n')[0].slice(0, 300) };
    });
    const data = readRows(join(work, 'data-results')).map((row) => ({
        id: row.id,
        group: row.group,
        reactAdapter: row.adapterLabel,
        react: row.reactVersion,
        pixi: row.pixiVersion,
        commands: Object.fromEntries(Object.entries(row.commands ?? {}).map(([name, step]) => [name, { status: step.status, ...(step.excerpt ? { excerpt: step.excerpt.slice(0, 8) } : {}) }])),
        backends: Object.fromEntries(Object.entries(row.backends ?? {}).map(([name, backend]) => [name, { ...backendEntry(backend, join(work, 'data-out', row.id, `conformance-${name}.json`)), ...(backend.excerpt ? { excerpt: backend.excerpt.slice(0, 8) } : {}) }])),
    }));
    const record = {
        schemaVersion: SCHEMA_VERSION,
        id: recordIdOf({ date, machine, sequence }),
        date,
        ...(machine ? { machine } : {}),
        ...(sequence > 1 ? { sequence } : {}),
        issue: 17,
        statement: STATEMENT,
        rule: VERIFICATION_RULE,
        gpuProfile,
        rendering: renderingOf(seed, gpuProfile, env),
        scope,
        commit,
        environment: env,
        run,
        // The packed workspace artifacts every cell installed: content hashes of the files `pnpm pack` produced.
        artifacts: Object.fromEntries(Object.entries(packed).map(([id, artifact]) => [id, { package: artifact.package, version: artifact.version, contentSha256: artifact.hash, codeSha256: codeHash(artifact.files) }])),
        summary: null,
        cells,
        integrities: Object.fromEntries(Object.entries(integrities).sort(([a], [b]) => a.localeCompare(b))),
        probes: probeRows,
        negatives,
        dataOnly: {
            statement: 'Data only, not verified: these results are never verification, never enter verifiedRanges and never change a peer range.',
            description: dataSpec?.description ?? null,
            groups: (dataSpec?.groups ?? []).map((group) => ({ id: group.id, description: group.description, unpublished: group.unpublished ?? [] })),
            results: data,
        },
    };

    record.summary = summarizeRecord(seed, record);

    return record;
}

/**
 * verifiedRanges from records: one entry per (React adapter, exact React, Pixi adapter), listing for each backend the
 * exact pixi.js versions verified on it, and the records that verified any of them. Only the current records count
 * (`currentRecords`: the newest per machine and GPU profile); their verified tuples add up across machines and profiles.
 * Only exact tuples: no interval.
 */
export function deriveVerifiedRanges(records, seed = loadSeed())
{
    const entries = new Map();
    const required = requiredCommands(seed);

    for (const record of currentRecords(records))
    {
        const gate = recordGate(record);

        for (const cell of record.cells)
        {
            for (const backend of Object.keys(cell.backends))
            {
                if (!tupleVerified(record, cell, backend, gate, required)) continue;
                const key = `${cell.reactAdapter}|${cell.react}|${cell.pixiAdapter}`;
                const entry = entries.get(key) ?? { reactAdapter: cell.reactAdapter, react: cell.react, pixiAdapter: cell.pixiAdapter, records: [], backends: {} };

                if (!entry.records.includes(recordId(record))) entry.records.push(recordId(record));
                entry.backends[backend] = [...new Set([...(entry.backends[backend] ?? []), cell.pixi])].sort(compareVersions);
                // A tuple verified with an environment shim carries the shim's id: backend -> shim id -> pixi.js versions.
                for (const shim of cell.backends[backend].environmentShims ?? [])
                {
                    entry.environmentShims ??= {};
                    entry.environmentShims[backend] ??= {};
                    entry.environmentShims[backend][shim.id] = [...new Set([...(entry.environmentShims[backend][shim.id] ?? []), cell.pixi])].sort(compareVersions);
                }
                entries.set(key, entry);
            }
        }
    }
    for (const entry of entries.values())
    {
        entry.backends = Object.fromEntries(Object.keys(entry.backends).sort().map((name) => [name, entry.backends[name]]));
        if (entry.environmentShims) entry.environmentShims = Object.fromEntries(Object.keys(entry.environmentShims).sort().map((name) => [name, entry.environmentShims[name]]));
    }

    return [...entries.values()].sort((a, b) => a.reactAdapter.localeCompare(b.reactAdapter, 'en', { numeric: true }) || compareVersions(a.react, b.react) || a.pixiAdapter.localeCompare(b.pixiAdapter));
}

/**
 * The machine and GPU profile a record speaks for. A record without a machine slug is this repository's own run (the
 * CI-equivalent software machine).
 */
export const recordLine = (record) => `${record.machine ?? 'default'}|${record.gpuProfile ?? 'software'}`;

/**
 * The records that count: within one machine and GPU profile only the newest (by date, then id) does, so a later run
 * that fails a tuple revokes that machine's earlier verification of it; distinct machines and profiles all count.
 */
export function currentRecords(records)
{
    const newest = new Map();

    for (const record of records)
    {
        const line = recordLine(record);
        const held = newest.get(line);

        const later = record.date > held?.date || (record.date === held?.date && ((record.sequence ?? 1) > (held.sequence ?? 1)
            || ((record.sequence ?? 1) === (held.sequence ?? 1) && recordId(record) > recordId(held))));

        if (!held || later) newest.set(line, record);
    }

    return [...newest.values()].sort((a, b) => recordId(a).localeCompare(recordId(b)));
}

/** A record's id: its file name without `.json` (the date, or the date and a machine slug). */
export const recordId = (record) => record.id ?? record.date;

/** The records checked in under design/compatibility/verification, oldest first. */
export function loadRecords(dir = RECORDS_DIR)
{
    if (!existsSync(dir)) return [];

    return readdirSync(dir).filter((name) => RECORD_FILE.test(name)).sort().map((name) => readJson(join(dir, name)));
}

/** Structural checks of a record (validate.mjs runs them on every checked-in record). */
export function validateRecord(seed, record, name = recordId(record))
{
    assert.equal(record.schemaVersion, SCHEMA_VERSION, `${name}: schemaVersion`);
    assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/, `${name}: date`);
    assert.ok(record.sequence === undefined || (Number.isInteger(record.sequence) && record.sequence >= 2), `${name}: sequence`);
    assert.equal(record.id, recordIdOf(record), `${name}: id is the date, the machine slug if any, and .N for the Nth record of a day`);
    assert.match(record.commit, /^[0-9a-f]{40}$/, `${name}: commit`);
    assert.equal(record.statement, STATEMENT, `${name}: statement`);
    assert.equal(record.rule, VERIFICATION_RULE, `${name}: rule`);
    const profile = gpuProfileOf(seed, record.gpuProfile);

    assert.equal(record.rendering?.profile, profile.id, `${name}: rendering.profile`);
    assert.equal(record.rendering.kind, profile.expect, `${name}: rendering.kind`);
    if (profile.expect === 'software') assert.equal(record.rendering.note, SOFTWARE_NOTE, `${name}: a software record carries the software-rendering note`);
    else assert.ok(record.machine, `${name}: a hardware record names its machine`);
    assert.ok(['full', 'partial'].includes(record.scope), `${name}: scope`);
    assert.ok(record.environment?.node && record.environment?.chromium && record.environment?.os, `${name}: environment`);
    if (record.date >= RECORD_REQUIREMENTS_SINCE)
    {
        const { range, nvmrc } = nodeRequirement();

        assert.ok(satisfiesNodeRange(record.environment.node, range), `${name}: ran on Node ${record.environment.node}, outside package.json engines.node "${range}" (.nvmrc ${nvmrc}); re-run on the required Node`);
        if (record.scope === 'full') assert.ok(Object.keys(record.artifacts ?? {}).length > 0, `${name}: a full record from ${RECORD_REQUIREMENTS_SINCE} on names the packed artifacts its cells installed (verification.mjs build --tarballs DIR)`);
    }
    if (record.environment.browser)
    {
        const known = BROWSERS[record.environment.browser.id];

        assert.ok(known && known.channel === record.environment.browser.channel && known.pinned === record.environment.browser.pinned, `${name}: environment.browser`);
        assert.ok(known.pinned || profile.expect === 'hardware', `${name}: an installed browser (${known.id}) is allowed only in a hardware record`);
    }
    const ids = record.cells.map((cell) => cell.id);

    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate cell`);
    const required = requiredCommands(seed);

    for (const cell of record.cells)
    {
        // A cell that claims any pass must have recorded every command the manifest requires: a command that never ran
        // is not a pass. Only a failed or missing cell may stop early (the runner stops at its first failing command).
        const claimsPass = cell.status === 'pass' || Object.values(cell.backends).some((entry) => ['pass', 'expected-fail'].includes(entry.status));

        if (claimsPass) assert.deepEqual(missingCommands(cell, required), [], `${name}: ${cell.id} claims a pass but lacks required commands`);
        for (const [backend, entry] of Object.entries(cell.backends))
        {
            assert.ok(backendNames(seed).includes(backend), `${name}: ${cell.id}: unknown backend ${backend}`);
            if (entry.status === 'pass')
            {
                assert.ok(entry.conformance && entry.conformance.failed === 0 && entry.conformance.passed > 0, `${name}: ${cell.id} ${backend}: a pass needs conformance counts with no failure`);
                // The suite and the render check separately: a passing render check alone is not a conformance run.
                assert.ok(scenariosRan(entry), `${name}: ${cell.id} ${backend}: a pass needs at least one conformance scenario passed and none failed`);
                assert.equal(entry.backendCheck, 'pass', `${name}: ${cell.id} ${backend}: a pass needs a passing render check`);
                assert.equal(entry.renderer, backend, `${name}: ${cell.id} ${backend}: a pass must have run on the ${backend} renderer`);
            }
            if (entry.status === 'expected-fail')
            {
                // Only a record from before environment shims may keep an expected blank render, as it recorded it: the
                // suite passed, the render check failed, and it verifies nothing.
                assert.ok(record.date < ENVIRONMENT_SHIMS_SINCE, `${name}: ${cell.id} ${backend}: an expected blank render in a record from ${ENVIRONMENT_SHIMS_SINCE} on (the expectedBlankRender list was retired; a blank canvas is a failure)`);
                assert.ok(typeof entry.expectedBlankRender === 'string' && entry.expectedBlankRender.length > 0, `${name}: ${cell.id} ${backend}: expectedBlankRender names the retired list entry`);
                assert.ok(scenariosRan(entry) && entry.backendCheck === 'fail', `${name}: ${cell.id} ${backend}: an expected blank render passed every scenario and failed the render check`);
            }
            // Environment shims: a record from ENVIRONMENT_SHIMS_SINCE on lists exactly the shims the manifest applies to
            // every run that reached the render check; an older one lists none.
            const shims = (entry.environmentShims ?? []).map((shim) => shim.id);
            const ran = entry.renderer !== undefined && entry.renderer !== null;

            if (record.date < ENVIRONMENT_SHIMS_SINCE) assert.deepEqual(shims, [], `${name}: ${cell.id} ${backend}: a record from before ${ENVIRONMENT_SHIMS_SINCE} applied no environment shim`);
            else if (ran || shims.length)
            {
                const expected = environmentShimsFor(seed, { pixiAdapter: cell.pixiAdapter, renderer: backend, pixi: cell.pixi }).map((shim) => shim.id);

                assert.deepEqual(shims, expected, `${name}: ${cell.id} ${backend}: environment shims applied differ from what adapterMatrix.environmentShims applies`);
            }
        }
    }
    assert.deepEqual(record.summary, summarizeRecord(seed, record), `${name}: summary is stale (node design/compatibility/verification.mjs refresh)`);
    for (const row of record.dataOnly?.results ?? []) assert.ok(row.id.startsWith('data-'), `${name}: data-only result ${row.id}`);
}

/**
 * Re-applies the current manifest and rule to a record without re-running anything: the rule, statement, rendering note
 * and summary are recomputed. What the record observed (statuses, read-backs, shims applied) is kept as it was.
 */
export function refreshRecord(seed, record)
{
    const next = { ...record, schemaVersion: SCHEMA_VERSION, id: record.id ?? recordIdOf(record), statement: STATEMENT, rule: VERIFICATION_RULE };

    next.gpuProfile ??= seed.adapterMatrix.defaultGpuProfile;
    next.rendering = renderingOf(seed, next.gpuProfile, next.environment);
    next.scope ??= 'full';
    next.summary = summarizeRecord(seed, next);

    // Keep the key order of a built record.
    const order = ['schemaVersion', 'id', 'date', 'machine', 'sequence', 'issue', 'statement', 'rule', 'gpuProfile', 'rendering', 'scope', 'commit', 'environment', 'run', 'artifacts', 'summary', 'cells', 'integrities', 'probes', 'negatives', 'dataOnly', 'findings'];

    return Object.fromEntries([...order.filter((key) => key in next), ...Object.keys(next).filter((key) => !order.includes(key))].map((key) => [key, next[key]]));
}

/** The Markdown rendering of a record. */
export function renderRecord(record, seed = loadSeed())
{
    const label = { webgl: 'WebGL', webgpu: 'WebGPU' };
    const backends = Object.keys(record.summary.backends);
    const env = record.environment;
    const gate = recordGate(record);
    const required = requiredCommands(seed);
    // The known issues covering a tuple this record verified on a backend: the cell is marked with each one's footnote.
    const issuesOf = (cell, backend) => (cell && seed && tupleVerified(record, cell, backend, gate, required) ? knownIssuesFor(seed, { pixiAdapter: cell.pixiAdapter, renderer: backend, pixi: cell.pixi }) : []);
    const mark = (entry, cell = null, backend = null) =>
    {
        if (!entry || entry.status === 'not applicable') return 'n/a';
        if (!['pass', 'fail', 'expected-fail'].includes(entry.status)) return entry.status;
        const counts = entry.scenarios ? ` ${entry.scenarios.passed}/${entry.scenarios.skipped}/${entry.scenarios.failed}` : '';
        const shimmed = entry.environmentShims?.length ? ' (shimmed)' : '';

        if (entry.status === 'expected-fail') return `expected blank (unverified)${counts}`;
        const check = entry.backendCheck === 'fail' ? ', render check FAIL' : '';

        return `${entry.status === 'pass' ? 'pass' : '**FAIL**'}${issuesOf(cell, backend).map((issue) => knownIssueMark(seed, issue)).join('')}${counts}${shimmed}${check}`;
    };
    const id = recordId(record);
    const blanks = new Map();
    const shims = new Map();

    for (const cell of record.cells)
    {
        for (const [backend, entry] of Object.entries(cell.backends))
        {
            for (const shim of entry.environmentShims ?? [])
            {
                const item = shims.get(shim.id) ?? { backend, runs: 0, passed: 0, pixi: new Set(), values: new Set() };

                item.runs++;
                if (entry.status === 'pass') item.passed++;
                item.pixi.add(cell.pixi);
                if (shim.parameter) item.values.add(`${shim.parameter} ${shim.original ?? 'unreadable'} → ${shim.clamped ?? 'unreadable'}`);
                shims.set(shim.id, item);
            }
            if (entry.status !== 'expected-fail') continue;
            const item = blanks.get(entry.expectedBlankRender) ?? { backend, cells: 0, pixi: new Set() };

            item.cells++;
            item.pixi.add(cell.pixi);
            blanks.set(entry.expectedBlankRender, item);
        }
    }
    const anyBlank = Object.values(record.summary.backends).some((summary) => summary.expectedBlank > 0);
    const anyShim = Object.values(record.summary.backends).some((summary) => summary.withEnvironmentShim > 0);
    const lines = [
        `# Verification record ${id}`,
        '',
        `<!-- Generated by \`node design/compatibility/verification.mjs render\` from ${id}.json; do not edit. -->`,
        '',
        `**${record.statement}** This record is the result of one ${record.scope === 'full' ? 'full nightly run' : 'partial (targeted) run'} of the [compatibility matrix](../cells/COMPATIBILITY.md) at commit \`${record.commit}\`${record.machine ? ` on ${record.machine}` : ''}, with each render backend checked separately. The machine-readable record is [${id}.json](${id}.json); \`verifiedRanges\` in [seed.json](../seed.json) is derived from the records (\`node design/compatibility/verification.mjs ranges\`), and \`validate.mjs\` checks that they agree.`,
        '',
        `**Rendering: ${record.rendering.kind} (GPU profile \`${record.rendering.profile}\`).** ${record.rendering.note}`,
        '',
        `Rule: ${record.rule}`,
        '',
        '## Environment',
        '',
        '| Item | Value |',
        '| --- | --- |',
        `| Commit | \`${record.commit}\` |`,
        `| GPU profile | ${record.rendering.profile} (${record.rendering.kind} rendering) |`,
        `| OS | ${env.os}, kernel ${env.kernel}, ${env.arch} |`,
        `| CPU | ${env.cpu} |`,
        `| Node / npm / pnpm | ${env.node} / ${env.npm} / ${env.pnpm} |`,
        `| Browser | ${describeBrowser(env)} |`,
        `| GPU | ${env.gpu} |`,
        ...backends.map((backend) => `| ${label[backend] ?? backend} | ${env.backends?.[backend] ?? '-'} |`),
        '',
        '## Run',
        '',
        ...record.run.commands.map((command) => `- \`${command}\``),
        '',
        ...record.run.notes.map((note) => `- ${note}`),
        '',
        '## Summary',
        '',
        `${record.summary.cells} cells (${record.summary.cellsPassedEveryBackend} passed on every backend they run${record.summary.cellsWithExpectedBlank ? `, ${record.summary.cellsWithExpectedBlank} with an expected blank render on one backend` : ''}), ${record.summary.probes.passed} of ${record.summary.probes.total} boundary probes passed (${record.summary.probes.expectedFailures} of them by failing exactly as the audit recorded), ${record.summary.negatives.rejectedAsExpected} of ${record.summary.negatives.total} incompatible pairs rejected as expected${recordGate(record) ? '' : '. **Not every probe and negative case behaved as expected, so this record verifies nothing**'}.`,
        '',
        `| Backend | Cells | Passed |${anyShim ? ' With an environment shim |' : ''}${anyBlank ? ' Expected blank (unverified) |' : ''} Failed | Render check failed | Not run | Not applicable | Conformance scenarios passed / skipped / failed | Tuples verified |`,
        `| --- | --- | --- |${anyShim ? ' --- |' : ''}${anyBlank ? ' --- |' : ''} --- | --- | --- | --- | --- | --- |`,
        ...backends.map((backend) =>
        {
            const s = record.summary.backends[backend];

            return `| ${label[backend] ?? backend} | ${s.cells} | ${s.passed} |${anyShim ? ` ${s.withEnvironmentShim} |` : ''}${anyBlank ? ` ${s.expectedBlank} |` : ''} ${s.failed} | ${s.backendCheckFailed} | ${s.notRun} | ${s.notApplicable} | ${s.scenarios.passed} / ${s.scenarios.skipped} / ${s.scenarios.failed} | ${s.verifiedTuples} |`;
        }),
        '',
    ];

    // Known upstream issues (adapterMatrix.knownIssues) covering tuples this record verified: one footnote each, marked on
    // those tuples in the cells table, with the environment shims this record applied for it.
    const issues = new Map();

    for (const cell of record.cells)
    {
        for (const backend of Object.keys(cell.backends))
        {
            for (const issue of issuesOf(cell, backend))
            {
                const item = issues.get(issue.id) ?? { issue, cells: 0, pixi: new Set() };

                item.cells += 1;
                item.pixi.add(cell.pixi);
                issues.set(issue.id, item);
            }
        }
    }
    if (issues.size || shims.size)
    {
        lines.push(
            '## Environment shims and known issues',
            '',
            ...[...issues.values()].flatMap(({ issue, cells, pixi }) => [`${knownIssueFootnote(seed, issue)} This record verified ${cells} ${label[issue.renderer] ?? issue.renderer} ${cells === 1 ? 'tuple' : 'tuples'} it covers (pixi.js ${[...pixi].sort(compareVersions).join(', ')}), marked in the cells table; they stay verified (owner rulings 2026-10-10 and 2026-10-11).`, '']),
            ...(shims.size
                ? [...shims.entries()].map(([shim, item]) => `- Environment shim \`${shim}\` (${label[item.backend] ?? item.backend}): applied to ${item.runs} ${item.runs === 1 ? 'run' : 'runs'} on pixi.js ${[...item.pixi].sort(compareVersions).join(', ')}, ${item.passed} passed; ${[...item.values].join('; ') || 'values not reported'}. Marked "(shimmed)" in the cells table.`)
                : [record.date < ENVIRONMENT_SHIMS_SINCE ? `- No environment shim was applied: this record ran before environment shims existed (${ENVIRONMENT_SHIMS_SINCE}).` : '- No environment shim applied to any run of this record.']),
            '',
        );
    }
    if (blanks.size)
    {
        lines.push(
            '## Expected blank renders (unverified)',
            '',
            `Runs this record lists as expected blank renders under the expected-blank-render list of its time (\`adapterMatrix.expectedBlankRender\`, retired on ${ENVIRONMENT_SHIMS_SINCE} for environment shims): every conformance scenario passed and the canvas read back blank. They verify nothing; a later record supersedes them.`,
            '',
            '| Entry | Backend | Cells | pixi.js |',
            '| --- | --- | --- | --- |',
            ...[...blanks.entries()].map(([entry, item]) => `| ${entry} | ${label[item.backend] ?? item.backend} | ${item.cells} | ${[...item.pixi].sort(compareVersions).join(', ')} |`),
            '',
        );
    }
    lines.push(
        '## Cells',
        '',
        `Each backend column shows the status and the conformance scenarios passed/skipped/failed (skips are scenarios whose capability the cell does not provide). Each backend run also has a render check (harness/test/backend.test.tsx: the requested renderer is the one Pixi created, and a screenshot of the canvas shows the red rectangle it drew); "render check FAIL" marks a run whose scenarios passed but whose canvas stayed blank${anyBlank ? ', and "expected blank (unverified)" one the retired expected-blank-render list covered' : ''}. "(shimmed)" marks a run that applied an environment shim, and a footnote mark a verified tuple a known issue covers (see above). Pixi 7 has no WebGPU renderer (n/a).`,
        '',
        `| Cell | React adapter | reconciler | Pixi adapter | Commands | ${backends.map((backend) => label[backend] ?? backend).join(' | ')} |`,
        `| --- | --- | --- | --- | --- | ${backends.map(() => '---').join(' | ')} |`,
        ...record.cells.map((cell) => `| ${cell.id} | ${cell.reactAdapter} | ${cell.reconciler} | ${cell.pixiAdapter} | ${Object.values(cell.commands).every((status) => status === 'pass') ? 'all pass' : Object.entries(cell.commands).filter(([, status]) => status !== 'pass').map(([name]) => `${name} FAIL`).join(', ') || cell.status} | ${backends.map((backend) => mark(cell.backends[backend], cell, backend)).join(' | ')} |`),
        '',
    );
    const failures = record.cells.filter((cell) => cell.failure);

    if (failures.length)
    {
        lines.push('## Failures', '', ...failures.map((cell) => `- **${cell.id}** (${cell.failure.command ?? 'no result'}${cell.failure.renderer ? `, ${cell.failure.renderer}` : ''}): ${cell.failure.lines.map((line) => `\`${line.replaceAll('`', "'")}\``).join(' ')}`), '');
    }
    if (record.findings?.length) lines.push('## Findings', '', ...record.findings.map((finding) => `- ${finding}`), '');
    lines.push(
        '## Boundary probes',
        '',
        '| Tuple | Boundary | Result |',
        '| --- | --- | --- |',
        ...record.probes.map((probe) => `| ${probe.id} | ${probe.boundary} | ${probe.status}${probe.warning ? ` (${probe.warning})` : ''} |`),
        '',
        '## Deliberately incompatible pairs',
        '',
        '| Case | Must fail at | Result | Message |',
        '| --- | --- | --- | --- |',
        ...record.negatives.map((row) => `| ${row.id} | ${row.failingCommand} | ${row.status === 'expected-fail' ? 'rejected as expected' : `**${row.status}**`} | ${row.message.replaceAll('|', '\\|')} |`),
        '',
        '## Data only, not verified',
        '',
        `**${record.dataOnly.statement}**`,
        '',
        record.dataOnly.description ?? '',
        '',
    );
    for (const group of record.dataOnly.groups)
    {
        const rows = record.dataOnly.results.filter((row) => row.group === group.id);
        const commandNames = [...new Set(rows.flatMap((row) => Object.keys(row.commands)))];

        lines.push(`### ${group.id}`, '', group.description, '');
        for (const item of group.unpublished) lines.push(`- ${item.package} ${item.version}: not run, ${item.note}.`);
        if (group.unpublished.length) lines.push('');
        lines.push(
            `| Probe | ${commandNames.join(' | ')} | ${backends.map((backend) => `conformance ${label[backend] ?? backend}`).join(' | ')} |`,
            `| --- | ${commandNames.map(() => '---').join(' | ')} | ${backends.map(() => '---').join(' | ')} |`,
            ...rows.map((row) => `| ${row.id} | ${commandNames.map((name) => (row.commands[name] ? (row.commands[name].status === 'pass' ? 'pass' : 'fail') : '-')).join(' | ')} | ${backends.map((backend) => mark(row.backends[backend])).join(' | ')} |`),
            '',
        );
        const notes = rows.flatMap((row) => Object.entries(row.commands).filter(([, step]) => step.excerpt?.length).map(([name, step]) => `- ${row.id}, ${name}: ${step.excerpt.slice(0, 3).map((line) => `\`${line.replaceAll('`', "'")}\``).join(' ')}`));
        const conformanceNotes = rows.flatMap((row) => Object.entries(row.backends).filter(([, backend]) => backend.excerpt?.length).map(([name, backend]) => `- ${row.id}, conformance ${name}: ${backend.excerpt.slice(0, 3).map((line) => `\`${line.replaceAll('`', "'")}\``).join(' ')}`));

        if (notes.length || conformanceNotes.length) lines.push('Why the failing commands failed (first lines):', '', ...notes, ...conformanceNotes, '');
    }
    if (record.dataOnly.findings?.length) lines.push('### Data-only findings', '', ...record.dataOnly.findings.map((finding) => `- ${finding}`), '');

    return `${lines.join('\n')}\n`;
}

/** Problems if a checked-in `.md` differs from its record's rendering. */
export function checkRenderedRecords(dir = RECORDS_DIR)
{
    return loadRecords(dir).flatMap((record) =>
    {
        const file = join(dir, `${recordId(record)}.md`);

        return existsSync(file) && readFileSync(file, 'utf8') === renderRecord(record) ? [] : [`design/compatibility/verification/${recordId(record)}.md is stale: run node design/compatibility/verification.mjs render`];
    });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const [command, ...rest] = process.argv.slice(2);
    const option = (name) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : undefined);
    const seedFile = join(here, 'seed.json');
    const seed = readJson(seedFile);

    const writeRecord = (record) =>
    {
        writeFileSync(join(RECORDS_DIR, `${recordId(record)}.json`), `${JSON.stringify(record, null, 2)}\n`);
        writeFileSync(join(RECORDS_DIR, `${recordId(record)}.md`), renderRecord(record));
        console.log(`wrote design/compatibility/verification/${recordId(record)}.json and .md`);
    };
    // Findings and run notes (`--extra FILE`: { environment, run, findings, dataFindings }) are written by a person.
    const extra = option('extra') ? readJson(resolve(option('extra'))) : {};
    const applyExtra = (record) =>
    {
        if (extra.run) record.run = extra.run;
        if (extra.findings) record.findings = extra.findings;
        if (extra.dataFindings) record.dataOnly.findings = extra.dataFindings;
    };

    switch (command)
    {
        case 'build':
        {
            const date = option('date');
            const record = buildRecord(seed, {
                work: resolve(option('work')),
                tarballs: resolve(option('tarballs') ?? join(option('work'), 'tarballs')),
                date,
                commit: option('commit'),
                machine: option('machine'),
                sequence: option('sequence') ? Number(option('sequence')) : 1,
                scope: option('scope') ?? 'full',
                environment: extra.environment ?? {},
                run: extra.run ?? { commands: [], notes: [] },
                dataSpec: readJson(join(here, 'cells/data-only.json')),
            });

            applyExtra(record);
            validateRecord(seed, record);
            writeRecord(record);
            break;
        }
        case 'refresh':
            for (const record of loadRecords().filter((candidate) => !option('record') || recordId(candidate) === option('record')))
            {
                const next = refreshRecord(seed, record);

                applyExtra(next);
                validateRecord(seed, next);
                writeRecord(next);
            }
            break;
        case 'render':
            if (rest.includes('--check'))
            {
                const problems = checkRenderedRecords();

                if (problems.length)
                {
                    console.error(problems.join('\n'));
                    process.exit(1);
                }
                console.log('verification records are rendered');
                break;
            }
            for (const record of loadRecords()) writeFileSync(join(RECORDS_DIR, `${recordId(record)}.md`), renderRecord(record));
            console.log('rendered the verification records');
            break;
        case 'ranges':
        {
            const ranges = deriveVerifiedRanges(loadRecords());

            if (rest.includes('--write'))
            {
                seed.verifiedRanges = ranges;
                writeFileSync(seedFile, `${JSON.stringify(seed, null, 2)}\n`);
                console.log(`wrote ${ranges.length} verifiedRanges entries into seed.json`);
            }
            else console.log(JSON.stringify(ranges, null, 2));
            break;
        }
        case 'compare':
        {
            // Whether freshly packed artifacts (run-cells.mjs pack --out DIR) carry the same code as a record's run.
            const record = readJson(join(RECORDS_DIR, `${option('record') ?? option('date')}.json`));
            const packed = readJson(join(resolve(option('tarballs')), 'artifacts.json'));
            let differs = 0;

            for (const [id, artifact] of Object.entries(record.artifacts))
            {
                const now = packed[id];
                const same = now && codeHash(now.files) === artifact.codeSha256;

                differs += same ? 0 : 1;
                console.log(`${same ? 'same code' : 'DIFFERENT'}  ${id}${now && now.hash !== artifact.contentSha256 ? ' (Markdown or build logs differ)' : ''}`);
            }
            process.exitCode = differs ? 1 : 0;
            break;
        }
        default:
        {
            const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');

            console.error(lines.slice(2, lines.indexOf(' */')).join('\n'));
            process.exitCode = 2;
            break;
        }
    }
}
