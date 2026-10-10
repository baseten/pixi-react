import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

function summarize(t, results, expectedStatus = 0)
{
    const root = mkdtempSync(join(tmpdir(), 'audit-summary-test-'));

    t.after(() => rmSync(root, { recursive: true, force: true }));
    const input = join(root, 'results.json');
    const output = join(root, 'evidence.json');

    writeFileSync(input, JSON.stringify({ results }));
    const run = spawnSync(process.execPath, [new URL('summarize.mjs', import.meta.url).pathname, input, output], { encoding: 'utf8' });

    assert.equal(run.status, expectedStatus, run.stderr);
    if (expectedStatus !== 0) return run.stderr;

    return JSON.parse(readFileSync(output)).results;
}

for (const workdir of ['/tmp/pixi-version-audit/pixi-8.5.0', '/private/tmp/pixi-audit3/tuples/pixi-8.5.0', '/tmp/audit with spaces/pixi-8.5.0'])
{
    test(`normalizes copied probes and dependency diagnostics from ${workdir}`, (t) =>
    {
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

function installed(id, packages)
{
    return { id, packages, certification: 'not-certified', install: { status: 0 }, runtime: { status: 0, stdout: '{"hostKeys":["appendChild"]}', stderr: '' }, types: { status: 0, stdout: '' }, surfaces: { 'pixi.js/Container.d.ts': { declarations: ['destroy(): void;'] } }, lock: { packages: {} } };
}

for (const packages of [{ react: '19.0.0' }, { 'pixi.js': '8.2.6' }])
{
    for (const status of [1, null])
    {
        test(`retains failed install diagnostics (${Object.keys(packages)[0]}, ${status}) without later probe data`, (t) =>
        {
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

test('records removed, added and changed declarations without repeating unchanged paths', (t) =>
{
    const before = installed('before', { 'pixi.js': '7.4.3' });
    const after = installed('after', { 'pixi.js': '8.2.6' });

    before.surfaces = {
        '@pixi/app/lib/Application.d.ts': { declarations: ['init(): void;'] },
        '@pixi/events/lib/FederatedPointerEvent.d.ts': { declarations: [] },
        'pixi.js/Container.d.ts': { declarations: ['destroy(): void;'] },
        'pixi.js/Ticker.d.ts': { declarations: ['update(): void;'] },
    };
    after.surfaces = {
        'pixi.js/Application.d.ts': { declarations: ['init(): Promise<void>;'] },
        'pixi.js/Container.d.ts': { declarations: ['destroy(options?: DestroyOptions): void;'] },
        'pixi.js/Ticker.d.ts': { declarations: ['update(): void;'] },
    };
    assert.equal(Object.hasOwn(after.surfaces, '@pixi/app/lib/Application.d.ts'), false);
    const rows = summarize(t, [before, after, { ...after, id: 'unchanged' }]);

    assert.deepEqual(rows[1].declarationDelta, {
        '@pixi/app/lib/Application.d.ts': { before: ['init(): void;'], after: null },
        '@pixi/events/lib/FederatedPointerEvent.d.ts': { before: [], after: null },
        'pixi.js/Application.d.ts': { before: null, after: ['init(): Promise<void>;'] },
        'pixi.js/Container.d.ts': { before: ['destroy(): void;'], after: ['destroy(options?: DestroyOptions): void;'] },
    });
    assert.deepEqual(rows[2].declarationDelta, {});
});

test('retains all eight removed v7 declaration paths at the installed v8 boundary', (t) =>
{
    const evidence = JSON.parse(readFileSync(new URL('evidence.json', import.meta.url)));
    const before = evidence.results.find((row) => row.id === 'pixi-7.4.3');
    const after = evidence.results.find((row) => row.id === 'pixi-8.2.6');
    const removed = Object.keys(before.surfaces);

    assert.equal(removed.length, 8);
    assert.ok(removed.every((path) => path.startsWith('@pixi/') && !Object.hasOwn(after.surfaces, path)));
    const rows = summarize(t, [before, after].map((row) => ({
        ...installed(row.id, row.packages),
        surfaces: row.surfaces,
    })));

    for (const path of removed)
    {
        const expected = { before: before.surfaces[path].declarations, after: null };

        assert.deepEqual(rows[1].declarationDelta[path], expected);
        assert.deepEqual(after.declarationDelta[path], expected);
    }
});

test('Windows and Unix captures retain identical Pixi and React surfaces and boundary deltas', (t) =>
{
    const evidence = JSON.parse(readFileSync(new URL('evidence.json', import.meta.url)));
    const unix = evidence.results.map((row) => ({ ...installed(row.id, row.packages), surfaces: row.surfaces }));
    const windows = unix.map((row) => ({
        ...row,
        surfaces: Object.fromEntries(Object.entries(row.surfaces).map(([path, surface]) => [path.replaceAll('/', '\\'), surface])),
    }));

    assert.ok(windows.every((row) => Object.keys(row.surfaces).length > 0 && Object.keys(row.surfaces).every((path) => path.includes('\\') && !path.includes('/'))));
    const unixRows = summarize(t, unix);
    const windowsRows = summarize(t, windows);

    for (const [index, row] of evidence.results.entries())
    {
        assert.deepEqual(unixRows[index].surfaces, row.surfaces, row.id);
        assert.deepEqual(windowsRows[index].surfaces, row.surfaces, row.id);
        if (!row.packages.react)
        {
            assert.deepEqual(unixRows[index].declarationDelta, row.declarationDelta, row.id);
            assert.deepEqual(windowsRows[index].declarationDelta, row.declarationDelta, row.id);
        }
    }
    assert.deepEqual(windowsRows, unixRows);
});

test('separator-only changes do not appear as declaration additions or removals', (t) =>
{
    const before = installed('before', { 'pixi.js': '8.2.6' });

    before.surfaces = {
        'pixi.js\\lib\\Container.d.ts': { declarations: ['destroy(): void;'] },
        'pixi.js\\lib\\Application.d.ts': { declarations: ['init(): Promise<void>;'] },
        'pixi.js\\lib\\Unselected.d.ts': { declarations: ['ignored(): void;'] },
    };
    const selected = {
        'pixi.js/lib/Container.d.ts': { declarations: ['destroy(): void;'] },
        'pixi.js/lib/Application.d.ts': { declarations: ['init(): Promise<void>;'] },
    };
    const after = { ...installed('after', before.packages), surfaces: selected };
    const rows = summarize(t, [before, after]);

    assert.deepEqual(rows[0].surfaces, selected);
    assert.deepEqual(rows[1].surfaces, selected);
    assert.deepEqual(rows[1].declarationDelta, {});
});

test('interleaved baseline, federated and assets declarations keep independent histories', (t) =>
{
    const row = (id, series, surfaces) => ({
        ...installed(id, { 'pixi.js': '6.5.1', ...(series === 'pixi6-federated' ? { '@pixi/events': '6.5.1' } : {}), ...(series === 'pixi6-assets' ? { '@pixi/assets': '6.5.1' } : {}) }),
        declarationSeries: series,
        surfaces: Object.fromEntries(Object.entries(surfaces).map(([name, declarations]) => [`pixi.js/${name}.d.ts`, { declarations }])),
    });
    const rows = summarize(t, [
        row('base-before', 'pixi6-baseline', { Container: ['base old'], Sprite: ['stable'], Particle: [] }),
        row('events-before', 'pixi6-federated', { Container: ['events old'] }),
        row('base-after', 'pixi6-baseline', { Container: ['base new'], Sprite: ['stable'], Ticker: ['added'] }),
        row('assets-before', 'pixi6-assets', { Container: ['assets old'] }),
        row('events-after', 'pixi6-federated', { Container: ['events new'] }),
        row('assets-after', 'pixi6-assets', { Container: ['assets old'] }),
    ]);

    assert.deepEqual(rows[2].declarationDelta, {
        'pixi.js/Container.d.ts': { before: ['base old'], after: ['base new'] },
        'pixi.js/Ticker.d.ts': { before: null, after: ['added'] },
        'pixi.js/Particle.d.ts': { before: [], after: null },
    });
    assert.deepEqual(rows[1].declarationDelta, { 'pixi.js/Container.d.ts': { before: null, after: ['events old'] } });
    assert.deepEqual(rows[4].declarationDelta, { 'pixi.js/Container.d.ts': { before: ['events old'], after: ['events new'] } });
    assert.deepEqual(rows[3].declarationDelta, { 'pixi.js/Container.d.ts': { before: null, after: ['assets old'] } });
    assert.deepEqual(rows[5].declarationDelta, {});
    assert.equal(rows[4].declarationSeries, 'pixi6-federated');
});

for (const series of [undefined, 'unknown', 'pixi6-baseline', 'pixi6-assets'])
{
    test(`rejects federated raw evidence with declarationSeries ${series}`, (t) =>
    {
        const row = { ...installed('events', { 'pixi.js': '6.5.1', '@pixi/events': '6.5.1' }), declarationSeries: series };

        assert.match(summarize(t, [row], 1), /events: declarationSeries/);
    });
}

test('failed historical installs preserve their series without replacing its preceding surface', (t) =>
{
    const before = { ...installed('before', { 'pixi.js': '6.5.1' }), declarationSeries: 'pixi6-baseline' };
    const failed = { id: 'failed', packages: before.packages, declarationSeries: before.declarationSeries, install: { status: 1 } };
    const rows = summarize(t, [before, failed, { ...before, id: 'after' }]);

    assert.equal(rows[1].declarationSeries, 'pixi6-baseline');
    assert.deepEqual(rows[2].declarationDelta, {});
});

for (const separator of ['/', '\\'])
{
    test(`retains actual extension paths and their v7/v8 boundary with ${JSON.stringify(separator)} separators`, (t) =>
    {
        const legacyPath = '@pixi/extensions/lib/index.d.ts';
        const modernPath = 'pixi.js/lib/extensions/Extensions.d.ts';
        const legacy = { sha256: 'a'.repeat(64), declarations: ['add(...extensions: Array<ExtensionFormatLoose | any>): any;'] };
        const modern = { sha256: 'b'.repeat(64), declarations: ['add(...extensions: Array<ExtensionFormat | any>): /*elided*/ any;'] };
        const before = { ...installed('pixi-7.4.3', { 'pixi.js': '7.4.3' }), surfaces: { [legacyPath.replaceAll('/', separator)]: legacy } };
        const after = {
            ...installed('pixi-8.2.6', { 'pixi.js': '8.2.6' }), surfaces: {
                [modernPath.replaceAll('/', separator)]: modern,
                ['pixi.js/lib/rendering/WebGLExtensions.d.ts'.replaceAll('/', separator)]: { declarations: [] },
            }
        };
        const rows = summarize(t, [before, after, { ...after, id: 'unchanged' }]);

        assert.deepEqual(rows[0].surfaces, { [legacyPath]: legacy });
        assert.deepEqual(rows[1].surfaces, { [modernPath]: modern });
        assert.deepEqual(rows[0].declarationDelta, { [legacyPath]: { before: null, after: legacy.declarations } });
        assert.deepEqual(rows[1].declarationDelta, {
            [legacyPath]: { before: legacy.declarations, after: null },
            [modernPath]: { before: null, after: modern.declarations },
        });
        assert.deepEqual(rows[2].declarationDelta, {});
    });
}

test('retained evidence includes the extension declaration for every Pixi tuple', () =>
{
    const evidence = JSON.parse(readFileSync(new URL('evidence.json', import.meta.url)));
    const rows = evidence.results.filter((row) => row.packages['pixi.js']);

    assert.equal(rows.length, 40);
    for (const row of rows)
    {
        const path = row.packages['pixi.js'].startsWith('7.') ? '@pixi/extensions/lib/index.d.ts' : 'pixi.js/lib/extensions/Extensions.d.ts';
        const surface = row.surfaces[path];

        assert.ok(surface, `${row.id}: ${path}`);
        assert.match(surface.sha256, /^[a-f0-9]{64}$/);
        assert.ok(surface.declarations.some((declaration) => declaration.startsWith('add(')), row.id);
        assert.ok(surface.declarations.some((declaration) => declaration.startsWith('remove(')), row.id);
    }
});

for (const probe of ['runtime', 'types'])
{
    for (const [name, processResult] of [
        ['timeout', { status: null, signal: 'SIGTERM', error: 'spawnSync node ETIMEDOUT', stdout: 'partial output', stderr: 'timeout stderr' }],
        ['signal', { status: null, signal: 'SIGKILL', stdout: '', stderr: 'terminated stderr' }],
        ['spawn failure', { status: null, signal: null, error: 'spawnSync node ENOENT', stdout: null, stderr: null }],
        ['nonzero', { status: 2, signal: null, stdout: 'failure output', stderr: 'failure stderr' }],
    ])
    {
        test(`retains complete ${probe} ${name} diagnostics`, (t) =>
        {
            const row = installed('diagnostic', { react: '19.2.0' });

            row[probe] = processResult;
            const [result] = summarize(t, [row]);
            const field = probe === 'runtime' ? 'runtimeDiagnostics' : 'typeProcessDiagnostics';

            assert.deepEqual(result[field], processResult);
        });
    }
}

test('retains partial JSON when a runtime terminates during output', (t) =>
{
    const row = installed('diagnostic', { react: '19.2.0' });

    row.runtime = { status: null, signal: 'SIGTERM', error: 'ETIMEDOUT', stdout: '{"hostKeys":[', stderr: 'timeout' };
    const [result] = summarize(t, [row]);

    assert.equal(result.observation, null);
    assert.deepEqual(result.runtimeDiagnostics, row.runtime);
});
