import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function summarize(t, results) {
    const root = mkdtempSync(join(tmpdir(), 'audit-summary-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const input = join(root, 'results.json');
    const output = join(root, 'evidence.json');
    writeFileSync(input, JSON.stringify({ results }));
    const run = spawnSync(process.execPath, [new URL('summarize.mjs', import.meta.url).pathname, input, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(output)).results;
}

function installed(id, packages) {
    return { id, packages, certification: 'not-certified', install: { status: 0 }, runtime: { status: 0, stdout: '{"hostKeys":["appendChild"]}', stderr: '' }, types: { status: 0, stdout: '' }, surfaces: { 'pixi.js/Container.d.ts': { declarations: ['destroy(): void;'] } }, lock: { packages: {} } };
}

for (const packages of [{ react: '19.0.0' }, { 'pixi.js': '8.2.6' }]) {
    for (const status of [1, null]) {
        test(`retains failed install diagnostics (${Object.keys(packages)[0]}, ${status}) without later probe data`, t => {
            const install = { status, signal: status === null ? 'SIGTERM' : null, error: status === null ? 'spawnSync npm ETIMEDOUT' : undefined, stdout: 'npm output', stderr: 'npm error ECONNRESET' };
            const failed = { id: 'failed', packages, certification: 'not-certified', install };
            assert.equal(Object.hasOwn(failed, 'runtime'), false);
            const rows = summarize(t, [installed('before', packages), failed, installed('after', packages)]);
            assert.equal(rows.length, 3);
            assert.equal(rows[1].installExit, status);
            assert.deepEqual(rows[1].installDiagnostics, JSON.parse(JSON.stringify(install)));
            assert.equal(rows[1].runtimeExit, null);
            assert.equal(rows[1].typeExit, null);
            assert.equal(rows[1].observation, null);
            assert.deepEqual(rows[1].resolvedPackages, {});
            assert.deepEqual(rows[1].surfaces, {});
            assert.equal(rows[1].certification, 'not-certified');
            assert.deepEqual(packages.react ? rows[2].hostDelta : rows[2].declarationDelta, packages.react ? { added: [], removed: [] } : {});
        });
    }
}
