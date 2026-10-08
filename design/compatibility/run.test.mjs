import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

for (const [id, surfacePath] of [
    ['pixi-7.4.2', '@pixi/extensions/lib/index.d.ts'],
    ['pixi-8.2.6', 'pixi.js/lib/extensions/Extensions.d.ts'],
])
{
    test(`captures the installed ${id} extension declaration without an install`, (t) =>
    {
        const root = mkdtempSync(join(tmpdir(), 'audit-runner-test-'));

        t.after(() => rmSync(root, { recursive: true, force: true }));
        const seed = JSON.parse(readFileSync(new URL('seed.json', import.meta.url)));
        const tuple = seed.probes.find((probe) => probe.id === id);
        const cwd = join(root, id);

        for (const [name, version] of Object.entries(tuple.packages))
        {
            const directory = join(cwd, 'node_modules', name);

            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }));
        }
        for (const name of ['app', 'display', 'sprite', 'text', 'ticker', 'events', 'particle-container', 'extensions']) mkdirSync(join(cwd, 'node_modules', '@pixi', name), { recursive: true });
        const path = join(cwd, 'node_modules', surfacePath);
        const declaration = 'declare const extensions: {\n    remove(...extensions: any[]): any;\n    add(...extensions: any[]): any;\n};\n';

        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, declaration);
        writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ packages: {} }));
        const run = spawnSync(process.execPath, [fileURLToPath(new URL('run.mjs', import.meta.url)), id], {
            encoding: 'utf8',
            env: { ...process.env, AUDIT_WORKDIR: root, AUDIT_REUSE_INSTALL: '1' },
        });

        // This fixture contains declarations only; runtime and type programs cannot succeed.
        assert.equal(run.status, 1, run.stderr);
        const { results } = JSON.parse(readFileSync(join(root, 'results.json')));

        assert.equal(results.length, 1);
        assert.deepEqual(results[0].install, { status: 0, reused: true });
        assert.deepEqual(results[0].surfaces[surfacePath.split('/').join(sep)], {
            sha256: createHash('sha256').update(declaration).digest('hex'),
            declarations: ['remove(...extensions: any[]): any;', 'add(...extensions: any[]): any;'],
        });
    });
}

for (const reused of [false, true])
{
    test(`rejects an unmatched filter with ${reused ? 'stale' : 'no'} audit output`, (t) =>
    {
        const parent = mkdtempSync(join(tmpdir(), 'audit-empty-selection-test-'));
        const root = join(parent, 'audit');
        const output = join(root, 'results.json');
        const stale = '{"results":[{"id":"stale-audit"}]}\n';

        t.after(() => rmSync(parent, { recursive: true, force: true }));
        if (reused)
        {
            mkdirSync(root);
            writeFileSync(output, stale);
        }
        else assert.equal(existsSync(root), false);
        const run = spawnSync(process.execPath, [fileURLToPath(new URL('run.mjs', import.meta.url)), 'nonexistent-audit-tuple'], {
            encoding: 'utf8',
            env: { ...process.env, AUDIT_WORKDIR: root },
        });

        assert.equal(run.status, 1, run.stdout);
        assert.match(run.stderr, /No audit tuples match.*nonexistent-audit-tuple/);
        assert.doesNotMatch(run.stdout, /Evidence directory:/);
        if (reused) assert.equal(readFileSync(output, 'utf8'), stale);
        else assert.equal(existsSync(root), false);
    });
}
