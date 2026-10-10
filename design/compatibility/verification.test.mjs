// Offline tests of the verification records (issue 17): the rule that derives verifiedRanges, and that the checked-in
// records, their Markdown and seed.json's verifiedRanges agree. Run with `node --test design/compatibility/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { backendComplete, checkRenderedRecords, deriveVerifiedRanges, loadRecords, validateRecord } from './verification.mjs';

const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
const pass = (renderer) => ({ status: 'pass', renderer, conformance: { passed: 80, failed: 0, skipped: 10, total: 90 } });
const commands = { install: 'pass', tree: 'pass', modules: 'pass', types: 'pass', conformance: 'pass' };
const cell = (react, pixi, backends, extra = {}) => ({ id: `react-${react}_pixi-${pixi}`, reactAdapter: 'react-x', react, pixiAdapter: pixi.startsWith('7.') ? 'pixi-7' : 'pixi-8', pixi, commands, backends, ...extra });
const record = (cells, extra = {}) => ({
    date: '2026-10-10',
    summary: { backends: { webgl: {}, webgpu: {} } },
    cells,
    probes: [{ id: 'pixi-8.2.6', status: 'pass' }],
    negatives: [{ id: 'negative-x', status: 'expected-fail' }],
    ...extra,
});
const notApplicable = { status: 'not applicable' };

test('a backend verifies only when its whole nightly matrix passed', () =>
{
    const green = record([
        cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }),
        cell('19.3.0', '7.4.3', { webgl: pass('webgl'), webgpu: notApplicable }),
    ]);

    assert.equal(backendComplete(green, 'webgl'), true);
    assert.equal(backendComplete(green, 'webgpu'), true);
    assert.deepEqual(deriveVerifiedRanges([green]), [
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-7', record: '2026-10-10', backends: { webgl: ['7.4.3'] } },
        { reactAdapter: 'react-x', react: '19.3.0', pixiAdapter: 'pixi-8', record: '2026-10-10', backends: { webgl: ['8.22.0'], webgpu: ['8.22.0'] } },
    ]);

    // One WebGPU failure: WebGPU verifies nothing in this record, WebGL is unaffected (never inferred from each other).
    const blank = record([
        cell('19.3.0', '8.2.6', { webgl: pass('webgl'), webgpu: { status: 'fail', renderer: 'webgpu' } }),
        cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }),
    ]);

    assert.equal(backendComplete(blank, 'webgpu'), false);
    assert.deepEqual(deriveVerifiedRanges([blank]).map((entry) => entry.backends), [{ webgl: ['8.2.6', '8.22.0'] }]);
});

test('a failed probe, negative case, command or missing cell verifies nothing', () =>
{
    const cells = [cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') })];

    assert.deepEqual(deriveVerifiedRanges([record(cells, { probes: [{ id: 'pixi-8.2.6', status: 'fail' }] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record(cells, { negatives: [{ id: 'negative-x', status: 'fail' }] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record(cells, { probes: [{ id: 'pixi-8.2.6', status: 'missing' }] })]), []);
    assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: pass('webgpu') }, { commands: { ...commands, types: 'fail' } })])]), []);
    // A failed conformance command because of one backend does not stop the other backend from verifying.
    assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: pass('webgl'), webgpu: { status: 'fail', renderer: 'webgpu' } }, { commands: { ...commands, conformance: 'fail' } })])]).map((entry) => entry.backends), [{ webgl: ['8.22.0'] }]);
    assert.deepEqual(deriveVerifiedRanges([record([cell('19.3.0', '8.22.0', { webgl: { status: 'not run' }, webgpu: pass('webgpu') })])]).map((entry) => entry.backends), [{ webgpu: ['8.22.0'] }]);
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
