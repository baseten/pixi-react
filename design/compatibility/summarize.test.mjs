import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

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

for (const workdir of ['/tmp/pixi-version-audit/pixi-8.5.0', '/private/tmp/pixi-audit3/tuples/pixi-8.5.0', '/tmp/audit with spaces/pixi-8.5.0']) {
    test(`normalizes copied probes and dependency diagnostics from ${workdir}`, t => {
        const row = installed('pixi-8.5.0', { 'pixi.js': '8.5.0' });
        row.workdir = workdir;
        row.runtime = { status: 1, stdout: '', stderr: `Error: expected failure\n    at ${pathToFileURL(workdir).href}/pixi.mjs:37:8\n    at ${workdir}/node_modules/pixi.js/Container.mjs:10:1` };
        row.types = { status: 2, stdout: `${workdir}/pixi.tsx:1: type error` };
        const [result] = summarize(t, [row]);
        assert.equal(result.failure, 'Error: expected failure\n    at <tuple>/pixi.mjs:37:8\n    at <tuple>/node_modules/pixi.js/Container.mjs:10:1');
        assert.equal(result.typeDiagnostics, '<tuple>/pixi.tsx:1: type error');
        const failed = { id: row.id, packages: row.packages, workdir, certification: 'not-certified', install: { status: 1, stderr: `${workdir}/package.json: install error`, stdout: `${workdir}/npm output`, error: `${workdir}/npm spawn error` } };
        assert.deepEqual(summarize(t, [failed])[0].installDiagnostics, { status: 1, stderr: '<tuple>/package.json: install error', stdout: '<tuple>/npm output', error: '<tuple>/npm spawn error' });
    });
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
