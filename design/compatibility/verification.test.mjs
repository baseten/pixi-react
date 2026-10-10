// Offline tests of the verification records (issue 17): the per-tuple rule that derives verifiedRanges, the
// expected-blank-render list, and that the checked-in records, their Markdown and seed.json's verifiedRanges agree.
// Run with `node --test design/compatibility/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classifyExpectedBlank, validateAdapterMatrix, validateExpectedBlankRender } from './cells/matrix.mjs';
import { checkExpectedBlankAgainstRecords, checkRenderedRecords, currentRecords, deriveVerifiedRanges, loadRecords, recordGate, refreshRecord, SOFTWARE_NOTE, summarizeRecord, validateRecord } from './verification.mjs';

const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const pass = (renderer) => ({ status: 'pass', scenarios: { passed: 79, failed: 0, skipped: 10 }, backendCheck: 'pass', renderer, conformance: { passed: 80, failed: 0, skipped: 10, total: 90 } });
const commands = { install: 'pass', tree: 'pass', modules: 'pass', types: 'pass', conformance: 'pass' };
const cell = (react, pixi, backends, extra = {}) => ({ id: `react-${react}_pixi-${pixi}`, reactAdapter: 'react-x', react, pixiAdapter: pixi.startsWith('7.') ? 'pixi-7' : 'pixi-8', pixi, commands, backends, ...extra });
const record = (cells, extra = {}) => ({
    id: '2026-10-10',
    date: '2026-10-10',
    gpuProfile: 'software',
    summary: { backends: { webgl: {}, webgpu: {} } },
    cells,
    probes: [{ id: 'pixi-8.2.6', status: 'pass' }],
    negatives: [{ id: 'negative-x', status: 'expected-fail' }],
    ...extra,
});
const notApplicable = { status: 'not applicable' };
const blankRun = (extra = {}) => ({
    status: 'fail',
    scenarios: { passed: 86, failed: 0, skipped: 5 },
    backendCheck: 'fail',
    conformance: { passed: 86, failed: 1, skipped: 5, total: 92 },
    renderer: 'webgpu',
    readback: { screenshot: [255, 255, 255, 255], canvas: [0, 0, 0, 0], extract: [0, 0, 0, 0], screenshotMatches: false, canvasMatches: false, extractMatches: false },
    ...extra,
});
const [blankEntry] = seed.adapterMatrix.expectedBlankRender;

test('each tuple is verified per backend: a failed WebGPU cell does not stop other versions verifying', () =>
{
    const green = record([
        cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }),
        cell('19.3.0', '7.4.3', { webgl: pass('webgl'), webgpu: notApplicable }),
    ]);

    assert.deepEqual(deriveVerifiedRanges([green]), [
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-7', records: ['2026-10-10'], backends: { webgl: ['7.4.3'] } },
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-8', records: ['2026-10-10'], backends: { webgl: ['8.22.0'], webgpu: ['8.22.0'] } },
    ]);

    const mixed = record([
        cell('19.3.0', '8.2.6', { webgl: pass('webgl'), webgpu: { status: 'fail', renderer: 'webgpu' } }, { commands: { ...commands, conformance: 'fail' } }),
        cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: { status: 'expected-fail', renderer: 'webgpu' } }),
        cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }),
    ]);

    assert.deepEqual(deriveVerifiedRanges([mixed]).map((entry) => entry.backends), [{ webgl: ['8.2.6', '8.9.2', '8.22.0'], webgpu: ['8.22.0'] }]);
});

test('a failed probe, negative case, command or missing cell verifies nothing', () =>
{
    const cells = [cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') })];

    assert.deepEqual(deriveVerifiedRanges([record(cells, { probes: [{ id: 'pixi-8.2.6', status: 'fail' }] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record(cells, { negatives: [{ id: 'negative-x', status: 'fail' }] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record(cells, { probes: [{ id: 'pixi-8.2.6', status: 'missing' }] })]), []);
    // A targeted run without probes or negative cases is evidence only.
    assert.equal(recordGate(record(cells, { probes: [], negatives: [] })), false);
    assert.deepEqual(deriveVerifiedRanges([record(cells, { probes: [], negatives: [] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }, { commands: { ...commands, types: 'fail' } })])]), []);
    assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: { status: 'not run' }, webgpu: pass('webgpu') })])]).map((entry) => entry.backends), [{ webgpu: ['8.22.0'] }]);
});

test('a command that was never recorded is not a pass: a cell with only conformance and backend evidence verifies nothing', () =>
{
    const bare = cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }, { status: 'pass', commands: { conformance: 'pass' } });

    assert.deepEqual(deriveVerifiedRanges([record([bare])]), []);
    for (const name of ['install', 'tree', 'modules', 'types'])
    {
        const { [name]: _omitted, ...rest } = commands;

        assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: notApplicable }, { commands: rest })])]), [], `without ${name}`);
    }
    // validateRecord rejects a cell that claims a pass without every required command; a failed cell may stop early.
    const [checked] = loadRecords();
    const withCell = (target) =>
    {
        const candidate = clone(checked);

        candidate.cells = [target];
        candidate.summary = summarizeRecord(seed, candidate);

        return candidate;
    };

    assert.throws(() => validateRecord(seed, withCell({ ...bare, backends: { webgl: { ...pass('webgl'), conformance: { passed: 80, failed: 0, skipped: 10, total: 90 } }, webgpu: notApplicable } })), /lacks required commands/);
    assert.doesNotThrow(() => validateRecord(seed, withCell(cell('19.3.0', '8.22.0', { webgl: { status: 'fail' }, webgpu: { status: 'fail' } }, { status: 'fail', commands: { install: 'fail' } }))));
});

test('a later record of the same machine and day supersedes the earlier one by its sequence number', () =>
{
    const first = record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') })]);
    const second = record([cell('19.3.0', '8.22.0', { webgl: { status: 'fail' }, webgpu: pass('webgpu') })], { id: '2026-10-10.2', sequence: 2 });
    const tenth = { ...second, id: '2026-10-10.10', sequence: 10, cells: [cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: { status: 'fail' } })] };

    assert.deepEqual(currentRecords([second, first]).map((entry) => entry.id), ['2026-10-10.2']);
    assert.deepEqual(deriveVerifiedRanges([first, second]).map((entry) => entry.backends), [{ webgpu: ['8.22.0'] }]);
    // Numeric, not lexicographic: .10 is later than .2.
    assert.deepEqual(currentRecords([first, tenth, second]).map((entry) => entry.id), ['2026-10-10.10']);
});

test('records add up: a hardware record adds tuples and names itself beside the software one', () =>
{
    const software = record([cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: { status: 'expected-fail', renderer: 'webgpu' } })]);
    const hardware = record([cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: pass('webgpu') })], { id: '2026-10-12-macos-m2', date: '2026-10-12', machine: 'macos-m2', gpuProfile: 'hardware' });

    assert.deepEqual(deriveVerifiedRanges([hardware, software]), [
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-8', records: ['2026-10-10', '2026-10-12-macos-m2'], backends: { webgl: ['8.9.2'], webgpu: ['8.9.2'] } },
    ]);
});

test('within one machine and GPU profile the newest record supersedes; across them records add up', () =>
{
    const older = record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') })], { id: '2026-10-10', date: '2026-10-10' });
    const newer = record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: { status: 'fail', renderer: 'webgpu' } }, { commands: { ...commands, conformance: 'fail' } })], { id: '2026-11-01', date: '2026-11-01' });

    // A later failure on the same machine and profile revokes the earlier WebGPU verification.
    assert.deepEqual(currentRecords([newer, older]).map((item) => item.id), ['2026-11-01']);
    assert.deepEqual(deriveVerifiedRanges([older, newer]), [
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-8', records: ['2026-11-01'], backends: { webgl: ['8.22.0'] } },
    ]);
    // A newer record that verifies nothing (a failed probe) also supersedes.
    assert.deepEqual(deriveVerifiedRanges([older, { ...older, id: '2026-11-02', date: '2026-11-02', probes: [{ id: 'pixi-8.2.6', status: 'fail' }] }]), []);
    // Another machine (or another profile on the same machine) is a separate line and adds up.
    const hardware = { ...older, id: '2026-10-12-macos-m2', date: '2026-10-12', machine: 'macos-m2', gpuProfile: 'hardware' };
    const sameMachineSoftware = { ...newer, id: '2026-11-01-macos-m2', machine: 'macos-m2', gpuProfile: 'software' };

    assert.deepEqual(currentRecords([older, newer, hardware, sameMachineSoftware]).map((item) => item.id), ['2026-10-12-macos-m2', '2026-11-01', '2026-11-01-macos-m2']);
    assert.deepEqual(deriveVerifiedRanges([older, newer, hardware]).map((entry) => [entry.records, entry.backends]), [[['2026-10-12-macos-m2', '2026-11-01'], { webgl: ['8.22.0'], webgpu: ['8.22.0'] }]]);
});

test('a pass verifies only with the suite and the render check counted separately', () =>
{
    const only = (entry) => deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: entry, webgpu: notApplicable })])]);

    assert.equal(only(pass('webgl')).length, 1);
    // The render check alone passed (conformance.test.tsx not discovered): 1 test passed in total, 0 scenarios.
    assert.deepEqual(only({ ...pass('webgl'), scenarios: { passed: 0, failed: 0, skipped: 0 }, conformance: { passed: 1, failed: 0, skipped: 0, total: 1 } }), []);
    assert.deepEqual(only({ ...pass('webgl'), scenarios: undefined }), []);
    assert.deepEqual(only({ ...pass('webgl'), backendCheck: 'not run' }), []);
    const records = loadRecords();
    const hollow = clone(records[0]);
    const target = hollow.cells.find((candidate) => candidate.backends.webgl.status === 'pass');

    target.backends.webgl.scenarios = { passed: 0, failed: 0, skipped: 0 };
    assert.throws(() => validateRecord(seed, hollow), /at least one conformance scenario passed/);
    target.backends.webgl.scenarios = { passed: 86, failed: 0, skipped: 5 };
    target.backends.webgl.backendCheck = 'not run';
    assert.throws(() => validateRecord(seed, hollow), /a passing render check/);
});

test('an expected blank render passes only when it fails exactly as listed', () =>
{
    assert.equal(classifyExpectedBlank(blankEntry, blankRun()).status, 'expected-fail');
    // The render check failed but no conformance scenario ran: not an expected blank render.
    assert.match(classifyExpectedBlank(blankEntry, blankRun({ scenarios: { passed: 0, failed: 0, skipped: 0 } })).message, /no conformance scenario ran/);
    // It rendered: the list must be pruned, so the run fails.
    const rendered = classifyExpectedBlank(blankEntry, blankRun({ backendCheck: 'pass', readback: { canvas: [255, 0, 0, 255], extract: [255, 0, 0, 255], screenshotMatches: true } }));

    assert.equal(rendered.status, 'fail');
    assert.match(rendered.message, /unexpected render.*Remove/);
    // A conformance failure is never excused.
    assert.equal(classifyExpectedBlank(blankEntry, blankRun({ scenarios: { passed: 85, failed: 1, skipped: 5 } })).status, 'fail');
    // A different failure (another renderer, another read-back, a software check that failed, no result) is not this one.
    assert.equal(classifyExpectedBlank(blankEntry, blankRun({ renderer: 'webgl' })).status, 'fail');
    assert.equal(classifyExpectedBlank(blankEntry, blankRun({ readback: { canvas: [0, 0, 0, 255], extract: [0, 0, 0, 0], screenshotMatches: false } })).status, 'fail');
    assert.equal(classifyExpectedBlank(blankEntry, blankRun({ gpu: { matchesProfile: false } })).status, 'fail');
    assert.equal(classifyExpectedBlank(blankEntry, { scenarios: undefined, backendCheck: undefined }).status, 'fail');
});

test('refresh turns a listed blank-canvas failure into an expected blank render, and nothing else', () =>
{
    const failed = cell('18.3.1', '8.9.2', { webgl: pass('webgl'), webgpu: blankRun() }, { status: 'fail', commands: { ...commands, conformance: 'fail' }, failure: { command: 'conformance', renderer: 'webgpu', lines: ['x'] } });
    const unlisted = cell('18.3.1', '8.10.2', { webgl: pass('webgl'), webgpu: blankRun() }, { status: 'fail', commands: { ...commands, conformance: 'fail' }, failure: { command: 'conformance', renderer: 'webgpu', lines: ['x'] } });
    const refreshed = refreshRecord(seed, { ...record([failed, unlisted]), environment: {} });
    const [blank, still] = refreshed.cells;

    assert.equal(blank.status, 'pass');
    assert.equal(blank.backends.webgpu.status, 'expected-fail');
    assert.equal(blank.backends.webgpu.expectedBlankRender, blankEntry.id);
    assert.equal(blank.commands.conformance, 'pass');
    assert.equal(blank.failure, undefined);
    assert.equal(still.status, 'fail', 'pixi.js 8.10.2 is not on the list');
    assert.equal(still.backends.webgpu.status, 'fail');
    assert.equal(refreshed.rendering.note, SOFTWARE_NOTE);
    assert.equal(refreshed.summary.backends.webgpu.expectedBlank, 1);
    assert.equal(refreshed.summary.backends.webgpu.failed, 1);
    // Under the hardware profile the software list does not apply.
    assert.equal(refreshRecord(seed, { ...record([failed]), gpuProfile: 'hardware', machine: 'x', environment: {} }).cells[0].backends.webgpu.status, 'fail');
});

test('the expected-blank-render list needs a reason and evidence, and lists only nightly cells', () =>
{
    const broken = (mutate) =>
    {
        const copy = clone(seed);

        mutate(copy.adapterMatrix.expectedBlankRender[0]);

        return () => validateExpectedBlankRender(copy);
    };

    assert.doesNotThrow(() => validateExpectedBlankRender(seed));
    assert.throws(broken((entry) => { delete entry.reason; }), /a reason is required/);
    assert.throws(broken((entry) => { entry.reason = ' '; }), /a reason is required/);
    assert.throws(broken((entry) => { delete entry.evidence.realGpu; }), /evidence.realGpu/);
    assert.throws(broken((entry) => { entry.pixi.push('8.9.0'); }), /no nightly webgpu cell runs pixi.js 8.9.0/);
    assert.throws(broken((entry) => { entry.pixi.push('8.2.6'); }), /listed twice/);
    assert.throws(broken((entry) => { entry.pixiAdapter = 'pixi7'; }), /has no webgpu renderer/);
    assert.throws(broken((entry) => { entry.verification = 'verified'; }), /unverified/);
});

test('the list agrees with the records: a listed cell that renders must be pruned', () =>
{
    const records = loadRecords();

    assert.deepEqual(checkExpectedBlankAgainstRecords(seed, records), []);
    const rendered = clone(records);
    const target = rendered[0].cells.find((candidate) => candidate.pixi === '8.9.2' && candidate.react === '19.3.0');

    target.backends.webgpu = pass('webgpu');
    assert.match(checkExpectedBlankAgainstRecords(seed, rendered).join('\n'), /react-19\.3\.0_pixi-8\.9\.2 webgpu is pass.*prune the list/);
    const extra = clone(seed);

    extra.adapterMatrix.expectedBlankRender[0].evidence.record = '2026-01-01';
    assert.match(checkExpectedBlankAgainstRecords(extra, records).join('\n'), /not a checked-in record/);
});

test('GPU profiles: a hardware profile may not select a software path', () =>
{
    const copy = clone(seed);

    copy.adapterMatrix.gpuProfiles.hardware.chromiumArgs.webgpu = ['--use-webgpu-adapter=swiftshader'];
    assert.throws(() => validateAdapterMatrix(copy), /selects a software path/);
});

test('the checked-in records are valid, rendered, and are what seed.json verifiedRanges derives from', () =>
{
    const records = loadRecords();

    for (const item of records) validateRecord(seed, item);
    assert.deepEqual(checkRenderedRecords(), []);
    assert.deepEqual(seed.verifiedRanges, deriveVerifiedRanges(records));
    for (const entry of seed.verifiedRanges)
    {
        for (const versions of Object.values(entry.backends)) for (const version of versions) assert.match(version, /^\d+\.\d+\.\d+$/, 'exact versions only');
    }
    // A record whose summary no longer matches its cells is stale.
    const stale = clone(records[0]);

    stale.summary = summarizeRecord(seed, { ...stale, cells: stale.cells.slice(1) });
    assert.throws(() => validateRecord(seed, stale), /summary is stale/);
});

test('the 2026-10-10 record: WebGL verifies every nightly tuple, WebGPU pixi.js 8.10.2 and later; 8.2 to 8.9 are expected blank', () =>
{
    const record2026 = loadRecords().find((item) => item.id === '2026-10-10');
    const webgpu = new Set(seed.verifiedRanges.filter((entry) => entry.pixiAdapter === 'pixi-8').flatMap((entry) => entry.backends.webgpu ?? []));

    assert.equal(record2026.rendering.kind, 'software');
    assert.equal(record2026.summary.backends.webgl.verifiedTuples, 184);
    assert.equal(record2026.summary.backends.webgpu.verifiedTuples, 104);
    assert.equal(record2026.summary.backends.webgpu.expectedBlank, 64);
    assert.equal(record2026.summary.backends.webgpu.failed, 0);
    for (const version of blankEntry.pixi) assert.ok(!webgpu.has(version), `${version} is not verified on WebGPU`);
    assert.ok(webgpu.has('8.10.2') && webgpu.has('8.22.0'));
});

test('data-only results never reach verifiedRanges', () =>
{
    const records = loadRecords();
    const verified = new Set(seed.verifiedRanges.flatMap((entry) => Object.values(entry.backends).flat().map((pixi) => `${entry.react}|${pixi}`)));

    for (const item of records)
    {
        for (const row of item.dataOnly?.results ?? [])
        {
            // A data-only tuple may coincide with a verified one only if the nightly matrix verified it itself.
            const nightly = item.cells.some((candidate) => candidate.react === row.react && candidate.pixi === row.pixi);

            if (!nightly) assert.ok(!verified.has(`${row.react}|${row.pixi}`), `${row.id} is data only`);
        }
    }
});
