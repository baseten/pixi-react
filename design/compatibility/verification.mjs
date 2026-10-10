#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Dated verification records (issue 17) and the `verifiedRanges` derived from them.
 *
 * A verification record is the machine-readable result of one full nightly run of the compatibility matrix
 * (`run-cells.mjs run --tier nightly --patches all`, every boundary probe, every negative case) at one commit, with
 * each render backend checked separately, plus the data-only probes in a separate section that never verifies
 * anything. `design/compatibility/verification/<date>.json` is the record; `<date>.md` is rendered from it.
 *
 * Verification is evidence, not a support guarantee.
 *
 * The rule (`VERIFICATION_RULE`): a render backend verifies tuples only when the whole nightly matrix passed on it in
 * that record: every expected cell that runs the backend passed on it, and every boundary probe and every negative case
 * behaved as expected. Then each tuple (React adapter, exact React, Pixi adapter, exact pixi.js) is verified on that
 * backend. Backends are never inferred from each other: a tuple lists each backend it is verified on.
 *
 * Usage:
 *   node design/compatibility/verification.mjs build --work DIR --date YYYY-MM-DD --commit SHA [--environment FILE]
 *   node design/compatibility/verification.mjs render [--check]   # the .md files from the .json records
 *   node design/compatibility/verification.mjs ranges [--write]   # verifiedRanges from the records (into seed.json)
 *   node design/compatibility/verification.mjs compare --date YYYY-MM-DD --tarballs DIR   # same packed code as the run?
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundaryProbes, compareVersions, fileSetHash, negativeCells, selectCells } from './cells/matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RECORDS_DIR = join(here, 'verification');
export const STATEMENT = 'Verification is evidence, not a support guarantee.';
export const VERIFICATION_RULE = 'A render backend verifies tuples only when the whole nightly matrix passed on it in this record: every expected '
    + 'cell that runs the backend passed on it, and every boundary probe and every negative case behaved as expected. '
    + 'Each tuple then lists every backend it is verified on; backends are never inferred from each other.';

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
    const report = readJson(file);
    const tally = (predicate) =>
    {
        const results = (report.testResults ?? []).filter((result) => predicate(result.name)).flatMap((result) => result.assertionResults ?? []);

        return {
            passed: results.filter((result) => result.status === 'passed').length,
            failed: results.filter((result) => result.status === 'failed').length,
            skipped: results.filter((result) => !['passed', 'failed'].includes(result.status)).length,
        };
    };
    const check = tally((name) => name.endsWith('backend.test.tsx'));

    return { suite: tally((name) => !name.endsWith('backend.test.tsx')), backendCheck: check.failed ? 'fail' : check.passed ? 'pass' : 'not run' };
}

/** One backend of one result row, as recorded. */
function backendEntry(backend, reportFile)
{
    if (!backend) return { status: 'not run' };
    const info = backend.backend ?? {};
    const split = splitReport(reportFile);

    return {
        status: backend.status,
        ...(split ? { scenarios: split.suite, backendCheck: split.backendCheck } : {}),
        conformance: counts(backend.conformance),
        renderer: info.actual ?? null,
        readback: info.readback ?? null,
        ...(info.webglRenderer ? { webglRenderer: info.webglRenderer } : {}),
        ...(info.gpuAdapter ? { gpuAdapter: info.gpuAdapter } : {}),
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
 * The identity of an artifact's packed files without its Markdown (README): what a later documentation-only commit leaves
 * unchanged. `contentSha256` covers every packed file.
 */
export const codeHash = (files) => fileSetHash(Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith('.md'))));

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

/**
 * Builds a verification record from a run's work directory (`results/` of the nightly cells, probes and negative
 * cases; `data-results/` of the data-only probes).
 */
export function buildRecord(seed, { work, date, commit, environment, run, dataSpec })
{
    const backends = backendNames(seed);
    const { rows, probes } = (() =>
    {
        const all = readRows(join(work, 'results'));

        return { rows: all.filter((row) => row.kind !== 'probe'), probes: all.filter((row) => row.kind === 'probe') };
    })();
    const byId = new Map(rows.map((row) => [row.id, row]));
    // npm integrity of every resolved package version any cell installed (cells list the versions they resolved).
    const integrities = {};
    const cells = expectedCells(seed).map((cell) =>
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
    const summary = {};

    for (const name of backends)
    {
        const applicable = cells.filter((cell) => cell.backends[name].status !== 'not applicable');

        summary[name] = {
            cells: applicable.length,
            passed: applicable.filter((cell) => cell.backends[name].status === 'pass').length,
            failed: applicable.filter((cell) => cell.backends[name].status === 'fail').length,
            notRun: applicable.filter((cell) => !['pass', 'fail'].includes(cell.backends[name].status)).length,
            backendCheckFailed: applicable.filter((cell) => cell.backends[name].backendCheck === 'fail').length,
            notApplicable: cells.length - applicable.length,
            scenarios: applicable.reduce((total, cell) =>
            {
                const scenarios = cell.backends[name].scenarios;

                return scenarios ? { passed: total.passed + scenarios.passed, failed: total.failed + scenarios.failed, skipped: total.skipped + scenarios.skipped } : total;
            }, { passed: 0, failed: 0, skipped: 0 }),
        };
    }

    return {
        schemaVersion: 1,
        date,
        issue: 17,
        statement: STATEMENT,
        rule: VERIFICATION_RULE,
        commit,
        environment,
        run,
        // The packed workspace artifacts every cell installed: content hashes of the files `pnpm pack` produced.
        artifacts: existsSync(join(work, 'tarballs', 'artifacts.json'))
            ? Object.fromEntries(Object.entries(readJson(join(work, 'tarballs', 'artifacts.json'))).map(([id, artifact]) => [id, { package: artifact.package, version: artifact.version, contentSha256: artifact.hash, codeSha256: codeHash(artifact.files) }]))
            : {},
        summary: {
            cells: cells.length,
            cellsPassedEveryBackend: cells.filter((cell) => cell.status === 'pass').length,
            backends: summary,
            probes: { total: probeRows.length, passed: probeRows.filter((probe) => ['pass', 'expected-fail'].includes(probe.status)).length, expectedFailures: probeRows.filter((probe) => probe.status === 'expected-fail').length, failed: probeRows.filter((probe) => probe.status === 'fail').length, missing: probeRows.filter((probe) => probe.status === 'missing').length },
            negatives: { total: negatives.length, rejectedAsExpected: negatives.filter((row) => row.status === 'expected-fail').length, failed: negatives.filter((row) => row.status === 'fail').length, missing: negatives.filter((row) => row.status === 'missing').length },
        },
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
}

/** Whether a backend's whole nightly matrix passed in a record (the verification rule). */
export function backendComplete(record, backend)
{
    const cells = record.cells.filter((cell) => cell.backends[backend] && cell.backends[backend].status !== 'not applicable');

    return cells.length > 0
        // Every command but the per-backend conformance run (whose result is the backend entry) must pass.
        && cells.every((cell) => cell.backends[backend].status === 'pass' && Object.entries(cell.commands).every(([name, status]) => name === 'conformance' || status === 'pass'))
        // A probe of a known failure (pixi-8.5.0) passes by failing exactly as recorded: `expected-fail`.
        && record.probes.every((probe) => ['pass', 'expected-fail'].includes(probe.status))
        && record.negatives.every((negative) => negative.status === 'expected-fail');
}

/**
 * verifiedRanges from records: one entry per (React adapter, exact React, Pixi adapter), listing for each backend
 * the exact pixi.js versions verified on it. Entries name the record they come from. Only exact tuples: no interval.
 */
export function deriveVerifiedRanges(records)
{
    const entries = new Map();

    for (const record of [...records].sort((a, b) => a.date.localeCompare(b.date)))
    {
        const complete = Object.fromEntries(Object.keys(record.summary.backends).map((backend) => [backend, backendComplete(record, backend)]));

        for (const cell of record.cells)
        {
            for (const [backend, ok] of Object.entries(complete))
            {
                if (!ok || cell.backends[backend]?.status !== 'pass') continue;
                const key = `${cell.reactAdapter}|${cell.react}|${cell.pixiAdapter}`;
                const entry = entries.get(key) ?? { reactAdapter: cell.reactAdapter, react: cell.react, pixiAdapter: cell.pixiAdapter, record: record.date, backends: {} };

                entry.record = record.date;
                entry.backends[backend] = [...new Set([...(entry.backends[backend] ?? []), cell.pixi])].sort(compareVersions);
                entries.set(key, entry);
            }
        }
    }

    return [...entries.values()].sort((a, b) => a.reactAdapter.localeCompare(b.reactAdapter, 'en', { numeric: true }) || compareVersions(a.react, b.react) || a.pixiAdapter.localeCompare(b.pixiAdapter));
}

/** The records checked in under design/compatibility/verification, oldest first. */
export function loadRecords(dir = RECORDS_DIR)
{
    if (!existsSync(dir)) return [];

    return readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().map((name) => readJson(join(dir, name)));
}

/** Structural checks of a record (validate.mjs runs them on every checked-in record). */
export function validateRecord(seed, record, name = record.date)
{
    assert.equal(record.schemaVersion, 1, `${name}: schemaVersion`);
    assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/, `${name}: date`);
    assert.match(record.commit, /^[0-9a-f]{40}$/, `${name}: commit`);
    assert.equal(record.statement, STATEMENT, `${name}: statement`);
    assert.equal(record.rule, VERIFICATION_RULE, `${name}: rule`);
    assert.ok(record.environment?.node && record.environment?.chromium && record.environment?.os, `${name}: environment`);
    const ids = record.cells.map((cell) => cell.id);

    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate cell`);
    for (const cell of record.cells)
    {
        for (const [backend, entry] of Object.entries(cell.backends))
        {
            assert.ok(backendNames(seed).includes(backend), `${name}: ${cell.id}: unknown backend ${backend}`);
            if (entry.status === 'pass')
            {
                assert.ok(entry.conformance && entry.conformance.failed === 0 && entry.conformance.passed > 0, `${name}: ${cell.id} ${backend}: a pass needs conformance counts with no failure`);
                assert.equal(entry.renderer, backend, `${name}: ${cell.id} ${backend}: a pass must have run on the ${backend} renderer`);
            }
        }
    }
    for (const row of record.dataOnly?.results ?? []) assert.ok(row.id.startsWith('data-'), `${name}: data-only result ${row.id}`);
}

/** The Markdown rendering of a record. */
export function renderRecord(record)
{
    const label = { webgl: 'WebGL', webgpu: 'WebGPU' };
    const backends = Object.keys(record.summary.backends);
    const env = record.environment;
    const mark = (entry) =>
    {
        if (!entry || entry.status === 'not applicable') return 'n/a';
        if (entry.status !== 'pass' && entry.status !== 'fail') return entry.status;
        const counts = entry.scenarios ? ` ${entry.scenarios.passed}/${entry.scenarios.skipped}/${entry.scenarios.failed}` : '';
        const check = entry.backendCheck === 'fail' ? ', render check FAIL' : '';

        return `${entry.status === 'pass' ? 'pass' : '**FAIL**'}${counts}${check}`;
    };
    const complete = Object.fromEntries(backends.map((backend) => [backend, backendComplete(record, backend)]));
    const lines = [
        `# Verification record ${record.date}`,
        '',
        `<!-- Generated by \`node design/compatibility/verification.mjs render\` from ${record.date}.json; do not edit. -->`,
        '',
        `**${record.statement}** This record is the result of one full nightly run of the [compatibility matrix](../cells/COMPATIBILITY.md) at commit \`${record.commit}\`, with each render backend checked separately. The machine-readable record is [${record.date}.json](${record.date}.json); \`verifiedRanges\` in [seed.json](../seed.json) is derived from it (\`node design/compatibility/verification.mjs ranges\`), and \`validate.mjs\` checks that they agree.`,
        '',
        `Rule: ${record.rule}`,
        '',
        '## Environment',
        '',
        '| Item | Value |',
        '| --- | --- |',
        `| Commit | \`${record.commit}\` |`,
        `| OS | ${env.os}, kernel ${env.kernel}, ${env.arch} |`,
        `| CPU | ${env.cpu} |`,
        `| Node / npm / pnpm | ${env.node} / ${env.npm} / ${env.pnpm} |`,
        `| Browser | ${env.chromium}, Playwright ${env.playwright} |`,
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
        `${record.summary.cells} cells (${record.summary.cellsPassedEveryBackend} passed on every backend they run), ${record.summary.probes.passed} of ${record.summary.probes.total} boundary probes passed (${record.summary.probes.expectedFailures} of them by failing exactly as the audit recorded), ${record.summary.negatives.rejectedAsExpected} of ${record.summary.negatives.total} incompatible pairs rejected as expected.`,
        '',
        '| Backend | Cells | Passed | Failed | Render check failed | Not run | Not applicable | Conformance scenarios passed / skipped / failed | Whole matrix passed (verifies) |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...backends.map((backend) =>
        {
            const s = record.summary.backends[backend];

            return `| ${label[backend] ?? backend} | ${s.cells} | ${s.passed} | ${s.failed} | ${s.backendCheckFailed} | ${s.notRun} | ${s.notApplicable} | ${s.scenarios.passed} / ${s.scenarios.skipped} / ${s.scenarios.failed} | ${complete[backend] ? 'yes' : '**no**'} |`;
        }),
        '',
        '## Cells',
        '',
        'Each backend column shows the status and the conformance scenarios passed/skipped/failed (skips are scenarios whose capability the cell does not provide). Each backend run also has a render check (harness/test/backend.test.tsx: the requested renderer is the one Pixi created, and a screenshot of the canvas shows the red rectangle it drew); "render check FAIL" marks a run whose scenarios passed but whose canvas stayed blank. Pixi 7 has no WebGPU renderer (n/a).',
        '',
        `| Cell | React adapter | reconciler | Pixi adapter | Commands | ${backends.map((backend) => label[backend] ?? backend).join(' | ')} |`,
        `| --- | --- | --- | --- | --- | ${backends.map(() => '---').join(' | ')} |`,
        ...record.cells.map((cell) => `| ${cell.id} | ${cell.reactAdapter} | ${cell.reconciler} | ${cell.pixiAdapter} | ${Object.values(cell.commands).every((status) => status === 'pass') ? 'all pass' : Object.entries(cell.commands).filter(([, status]) => status !== 'pass').map(([name]) => `${name} FAIL`).join(', ') || cell.status} | ${backends.map((backend) => mark(cell.backends[backend])).join(' | ')} |`),
        '',
    ];
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
        const file = join(dir, `${record.date}.md`);

        return existsSync(file) && readFileSync(file, 'utf8') === renderRecord(record) ? [] : [`design/compatibility/verification/${record.date}.md is stale: run node design/compatibility/verification.mjs render`];
    });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const [command, ...rest] = process.argv.slice(2);
    const option = (name) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : undefined);
    const seedFile = join(here, 'seed.json');
    const seed = readJson(seedFile);

    switch (command)
    {
        case 'build':
        {
            const date = option('date');
            const extra = option('extra') ? readJson(resolve(option('extra'))) : {};
            const record = buildRecord(seed, {
                work: resolve(option('work')),
                date,
                commit: option('commit'),
                environment: extra.environment ?? {},
                run: extra.run ?? { commands: [], notes: [] },
                dataSpec: readJson(join(here, 'cells/data-only.json')),
            });

            if (extra.findings) record.findings = extra.findings;
            if (extra.dataFindings) record.dataOnly.findings = extra.dataFindings;
            validateRecord(seed, record);
            writeFileSync(join(RECORDS_DIR, `${date}.json`), `${JSON.stringify(record, null, 2)}\n`);
            writeFileSync(join(RECORDS_DIR, `${date}.md`), renderRecord(record));
            console.log(`wrote design/compatibility/verification/${date}.json and .md`);
            break;
        }
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
            for (const record of loadRecords()) writeFileSync(join(RECORDS_DIR, `${record.date}.md`), renderRecord(record));
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
            const record = readJson(join(RECORDS_DIR, `${option('date')}.json`));
            const packed = readJson(join(resolve(option('tarballs')), 'artifacts.json'));
            let differs = 0;

            for (const [id, artifact] of Object.entries(record.artifacts))
            {
                const now = packed[id];
                const same = now && codeHash(now.files) === artifact.codeSha256;

                differs += same ? 0 : 1;
                console.log(`${same ? 'same code' : 'DIFFERENT'}  ${id}${now && now.hash !== artifact.contentSha256 ? ' (Markdown differs)' : ''}`);
            }
            process.exitCode = differs ? 1 : 0;
            break;
        }
        default:
            console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 23).join('\n'));
            process.exitCode = 2;
    }
}
