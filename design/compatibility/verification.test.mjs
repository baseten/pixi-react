// Offline tests of the verification records (issue 17): the per-tuple rule that derives verifiedRanges, environment
// shims (and the retired expected-blank-render list in old records), and that the checked-in records, their Markdown and seed.json's verifiedRanges agree.
// Run with `node --test design/compatibility/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateAdapterMatrix } from './cells/matrix.mjs';
import { browserOfRows, checkRenderedRecords, currentRecords, describeBrowser, deriveVerifiedRanges, ENVIRONMENT_SHIMS_SINCE, loadRecords, recordGate, refreshRecord, renderingOf, renderRecord, SOFTWARE_NOTE, summarizeRecord, validateRecord } from './verification.mjs';

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
const [shim] = seed.adapterMatrix.environmentShims;
const shimmedPass = () => ({ ...pass('webgpu'), environmentShims: [{ id: shim.id, kind: shim.action.kind, parameter: shim.action.parameter, max: shim.action.max, original: 32, clamped: 16 }] });
const BEFORE_FIX = ['8.2.6', '8.3.4', '8.4.1', '8.5.2', '8.6.6', '8.7.3', '8.8.1', '8.9.2'];

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

test('a hardware record names its real GPU once', () =>
{
    const environment = { gpu: 'real GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max); apple / metal-3, isFallbackAdapter false' };

    assert.match(renderingOf(seed, 'hardware', environment).note, /^Real GPU: ANGLE \(Apple/);
    assert.doesNotMatch(renderingOf(seed, 'hardware', environment).note, /real GPU: real GPU/i);
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

test('a tuple verified with an environment shim stays verified and carries the shim id; a shimmed failure is a failure', () =>
{
    const shimmed = record([
        cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: shimmedPass() }),
        cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }),
    ], { id: '2026-10-11', date: '2026-10-11' });

    assert.deepEqual(deriveVerifiedRanges([shimmed]), [
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-8', records: ['2026-10-11'], backends: { webgl: ['8.9.2', '8.22.0'], webgpu: ['8.9.2', '8.22.0'] }, environmentShims: { webgpu: { [shim.id]: ['8.9.2'] } } },
    ]);
    // Still blank with the shim: an ordinary failure, nothing verified on WebGPU.
    const blank = record([cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: { ...blankRun(), environmentShims: shimmedPass().environmentShims } }, { status: 'fail', commands: { ...commands, conformance: 'fail' } })], { id: '2026-10-11', date: '2026-10-11' });

    assert.deepEqual(deriveVerifiedRanges([blank]).map((entry) => [entry.backends, entry.environmentShims]), [[{ webgl: ['8.9.2'] }, undefined]]);
    assert.equal(summarizeRecord(seed, blank).backends.webgpu.failed, 1);
    assert.equal(summarizeRecord(seed, shimmed).backends.webgpu.withEnvironmentShim, 1);
});

test('records list exactly the shims the manifest applies (none before 2026-10-11), and no expected blank render from then on', () =>
{
    const checked = loadRecords().find((item) => item.id === '2026-10-10.2');
    const withCells = (cells, date) =>
    {
        const candidate = { ...clone(checked), id: date, date, cells };

        delete candidate.sequence;
        delete candidate.machine;
        candidate.summary = summarizeRecord(seed, candidate);

        return candidate;
    };
    const shimmed = cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: shimmedPass() }, { status: 'pass' });

    assert.equal(ENVIRONMENT_SHIMS_SINCE, '2026-10-11');
    assert.doesNotThrow(() => validateRecord(seed, withCells([shimmed], '2026-10-11')));
    // A run in the shim's range that did not apply it, a shim on WebGL or on a fixed pixi.js, an older record with a shim.
    assert.throws(() => validateRecord(seed, withCells([cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: pass('webgpu') }, { status: 'pass' })], '2026-10-11')), /environment shims applied differ/);
    assert.throws(() => validateRecord(seed, withCells([cell('19.3.0', '8.9.2', { webgl: { ...pass('webgl'), environmentShims: shimmedPass().environmentShims }, webgpu: shimmedPass() }, { status: 'pass' })], '2026-10-11')), /environment shims applied differ/);
    assert.throws(() => validateRecord(seed, withCells([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: shimmedPass() }, { status: 'pass' })], '2026-10-11')), /environment shims applied differ/);
    assert.throws(() => validateRecord(seed, withCells([shimmed], '2026-10-10')), /applied no environment shim/);
    // The retired expected-blank status is valid only in a record from before the shims, as it recorded it.
    const blank = cell('19.3.0', '8.9.2', { webgl: pass('webgl'), webgpu: { ...blankRun(), status: 'expected-fail', expectedBlankRender: 'pixi8-webgpu-blank-before-8.10-software' } }, { status: 'pass' });

    assert.doesNotThrow(() => validateRecord(seed, withCells([blank], '2026-10-10')));
    assert.throws(() => validateRecord(seed, withCells([blank], '2026-10-11')), /expected blank render in a record from 2026-10-11 on/);
});

test('refresh keeps what a record observed: an old expected blank render stays unverified, never a pass', () =>
{
    const records = loadRecords();
    const old = records.find((item) => item.id === '2026-10-10.2');
    const refreshed = refreshRecord(seed, old);

    assert.deepEqual(refreshed.cells, old.cells);
    assert.equal(refreshed.summary.backends.webgpu.expectedBlank, 88);
    assert.equal(refreshed.summary.backends.webgpu.verifiedTuples, 143);
    // A failure is not turned into anything else either.
    const failed = cell('18.3.1', '8.9.2', { webgl: pass('webgl'), webgpu: blankRun() }, { status: 'fail', commands: { ...commands, conformance: 'fail' }, failure: { command: 'conformance', renderer: 'webgpu', lines: ['x'] } });
    const again = refreshRecord(seed, { ...record([failed]), environment: {} });

    assert.equal(again.cells[0].backends.webgpu.status, 'fail');
    assert.equal(again.rendering.note, SOFTWARE_NOTE);
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

test('the software records: 2026-10-11 verifies every nightly tuple on both backends, with the shim on WebGPU below 8.10; the older ones keep their blank renders', () =>
{
    const records = loadRecords();
    const first = records.find((item) => item.id === '2026-10-10');
    const second = records.find((item) => item.id === '2026-10-10.2');
    const third = records.find((item) => item.id === '2026-10-11');

    assert.equal(first.summary.backends.webgpu.expectedBlank, 64);
    assert.equal(second.summary.backends.webgpu.expectedBlank, 88);
    assert.equal(second.summary.backends.webgpu.verifiedTuples, 143);
    assert.equal(third.rendering.kind, 'software');
    assert.equal(third.summary.backends.webgl.verifiedTuples, 297);
    assert.equal(third.summary.backends.webgpu.cells, 231);
    assert.equal(third.summary.backends.webgpu.verifiedTuples, 231);
    assert.equal(third.summary.backends.webgpu.expectedBlank, 0);
    assert.equal(third.summary.backends.webgpu.withEnvironmentShim, 88);
    assert.equal(third.summary.backends.webgl.withEnvironmentShim, 0);
    // The newest record of the machine supersedes the two before it.
    assert.deepEqual(currentRecords([first, third, second]).map((item) => item.id), ['2026-10-11']);
    // Every WebGPU run below 8.10 applied the shim (32 texture units clamped to 16), and no other run did.
    for (const item of third.cells)
    {
        for (const [backend, entry] of Object.entries(item.backends))
        {
            const expected = backend === 'webgpu' && BEFORE_FIX.includes(item.pixi) ? [shim.id] : [];

            assert.deepEqual((entry.environmentShims ?? []).map((applied) => applied.id), expected, `${item.id} ${backend}`);
            for (const applied of entry.environmentShims ?? []) assert.deepEqual([applied.original, applied.clamped], [32, 16]);
        }
    }
    const softwareOnly = deriveVerifiedRanges([third]).filter((entry) => entry.pixiAdapter === 'pixi-8');

    for (const entry of softwareOnly) assert.deepEqual(entry.environmentShims, { webgpu: { [shim.id]: BEFORE_FIX } }, `${entry.reactAdapter} ${entry.react}`);
});

test('a full hardware record verifies what passed on it; a known issue is shown beside covered tuples, not hidden', () =>
{
    const records = loadRecords();
    const mac = records.find((item) => item.id === '2026-10-10-macos-26-apple-m5-max');
    const webgpu = new Set(seed.verifiedRanges.filter((entry) => entry.pixiAdapter === 'pixi-8').flatMap((entry) => entry.backends.webgpu ?? []));

    assert.equal(mac.scope, 'full');
    assert.equal(mac.rendering.kind, 'hardware');
    assert.ok(recordGate(mac));
    for (const version of BEFORE_FIX) assert.ok(webgpu.has(version), `${version} is verified on WebGPU`);
    // Its tuples below 8.10 carry the same footnote mark, without a shim (it ran before them).
    const markdown = renderRecord(mac, seed);

    assert.match(markdown, /## Environment shims and known issues\n\n\\\* WebGPU on pixi\.js <8\.10 needs the workaround for \[pixijs\/pixijs#11389\]/);
    assert.match(markdown, /No environment shim was applied: this record ran before environment shims existed/);
    assert.match(markdown, /\| react-19\.3\.0_pixi-8\.9\.2 \|[^\n]*\| pass\\\* 83\/8\/0 \|\n/);
    assert.doesNotMatch(markdown, /\d \(shimmed\)/);
    // knownIssues must name a range and links.
    const broken = clone(seed);

    broken.adapterMatrix.knownIssues[0].links = [];
    assert.throws(() => validateAdapterMatrix(broken), /links/);
    broken.adapterMatrix.knownIssues[0] = { ...seed.adapterMatrix.knownIssues[0], pixi: { from: '8.10.0', before: '8.2.0' } };
    assert.throws(() => validateAdapterMatrix(broken), /from must be below/);
});

test('data-only results never reach verifiedRanges', () =>
{
    const records = loadRecords();
    const verified = new Set(seed.verifiedRanges.flatMap((entry) => Object.values(entry.backends).flat().map((pixi) => `${entry.react}|${pixi}`)));

    for (const item of records)
    {
        for (const row of item.dataOnly?.results ?? [])
        {
            // A data-only tuple may coincide with a verified one only if a record's nightly matrix ran it as a cell (React
            // 18.0-18.2 and pixi.js 7.2/7.3 were data-only probes in the first 2026-10-10 record and cells in 2026-10-10.2).
            const nightly = records.some((record) => record.cells.some((candidate) => candidate.react === row.react && candidate.pixi === row.pixi));

            if (!nightly) assert.ok(!verified.has(`${row.react}|${row.pixi}`), `${row.id} is data only`);
        }
    }
});

test('records name the browser of their runs, and say so loudly when it was an installed one rather than the pinned Chromium', () =>
{
    const run = (browser, extra = {}) => ({ kind: 'cell', browser: browser.id, backends: { webgpu: { status: 'pass', browser, backend: { actual: 'webgpu' } } }, ...extra });
    const chrome = { id: 'chrome', channel: 'chrome', name: 'Google Chrome', version: '154.0.7700.10' };
    const pinned = { id: 'chromium', channel: null, name: 'Chromium', version: '133.0.6943.16' };

    assert.deepEqual(browserOfRows([run(chrome)]), { id: 'chrome', channel: 'chrome', pinned: false, name: 'Google Chrome', version: '154.0.7700.10' });
    assert.equal(browserOfRows([{ kind: 'cell', backends: {} }]), null);
    assert.throws(() => browserOfRows([run(chrome), run(pinned)]), /mix browsers/);
    const env = (browser) => ({ chromium: 'Chromium 154.0.0.0 headed', playwright: '1.50.1', gpu: 'real GPU: nvidia / lovelace', browser });
    const installed = describeBrowser(env(browserOfRows([run(chrome)])));

    assert.match(installed, /Google Chrome 154\.0\.7700\.10 \(headed\), installed on the machine \(Playwright channel `chrome`\), not the Chromium pinned by Playwright 1\.50\.1/);
    assert.match(describeBrowser(env(browserOfRows([run(pinned)]))), /^Chromium 133\.0\.6943\.16 \(headed\), the Chromium pinned by Playwright 1\.50\.1$/);
    // Records from before browsers were recorded keep their Browser row.
    assert.equal(describeBrowser({ chromium: 'Chromium 133.0.6943.16 headless', playwright: '1.50.1' }), 'Chromium 133.0.6943.16 headless, Playwright 1.50.1');
    assert.match(renderingOf(seed, 'hardware', env(browserOfRows([run(chrome)]))).note, /The browser was Google Chrome 154\.0\.7700\.10 as installed on the machine \(Playwright channel chrome\), not the Chromium pinned by Playwright\./);
    assert.doesNotMatch(renderingOf(seed, 'hardware', env(browserOfRows([run(pinned)]))).note, /installed/);
});

test('a software record cannot name an installed browser', () =>
{
    const [software] = loadRecords().filter((candidate) => candidate.gpuProfile === 'software');
    const bad = clone(software);

    bad.environment.browser = { id: 'chrome', channel: 'chrome', pinned: false, name: 'Google Chrome', version: '154.0.7700.10' };
    assert.throws(() => validateRecord(seed, bad), /installed browser \(chrome\) is allowed only in a hardware record/);
    bad.environment.browser = { id: 'chromium', channel: null, pinned: true, name: 'Chromium', version: '133.0.6943.16' };
    validateRecord(seed, bad);
});
