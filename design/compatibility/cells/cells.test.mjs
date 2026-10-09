// Offline tests of the cell generator, cache keys, entry scoping and drift detection. Run with
// `node --test design/compatibility/cells/*.test.mjs`; nothing here installs a package.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cellKey, loadSeed, negativeCells, renderCompatibilityDoc, selectCells, validateAdapterMatrix } from './matrix.mjs';
import { entryClosure } from './pack.mjs';
import { compareWithEvidence } from './probes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seed = loadSeed();
const evidence = JSON.parse(readFileSync(join(here, '../evidence.json'), 'utf8'));

test('the adapterMatrix section validates against the rest of the seed', () => validateAdapterMatrix(seed));

test('PR tier: every React epoch at its latest patch against Pixi 8.2.6 and 8.22.0', () =>
{
    const ids = selectCells(seed, 'pr').map((cell) => cell.id);

    assert.deepEqual(ids.sort(), [
        'react-18.3.1_pixi-8.2.6', 'react-18.3.1_pixi-8.22.0',
        'react-19.0.8_pixi-8.2.6', 'react-19.0.8_pixi-8.22.0',
        'react-19.1.9_pixi-8.2.6', 'react-19.1.9_pixi-8.22.0',
        'react-19.2.8_pixi-8.2.6', 'react-19.2.8_pixi-8.22.0',
        'react-19.3.0_pixi-8.2.6', 'react-19.3.0_pixi-8.22.0',
    ].sort());
});

test('nightly tier is the full cross-product, generated from the seed', () =>
{
    const nightly = selectCells(seed, 'nightly');
    const pixi = new Set(nightly.map((cell) => cell.pixi.version));
    const react = new Set(nightly.map((cell) => cell.react.version));

    assert.equal(react.size, 5);
    assert.equal(pixi.size, 21, 'Pixi 8.2 through 8.22, one latest audited patch per minor');
    assert.equal(nightly.length, react.size * pixi.size);
    assert.ok(!pixi.has('8.5.0'), 'the excluded 8.5.0 is never selected');
    assert.ok(pixi.has('8.5.2'));
    assert.equal(selectCells(seed, 'nightly', { patches: 'all' }).length, 8 * 21, 'minimum and latest React patches');
});

test('every cell pins exact versions taken from an audited tuple', () =>
{
    for (const cell of selectCells(seed, 'nightly', { patches: 'all' }))
    {
        const tuple = seed.probes.find((probe) => probe.id === `react-${cell.react.version}`);

        assert.equal(cell.deps.react, tuple.packages.react);
        assert.equal(cell.deps['@types/react'], tuple.packages['@types/react']);
        assert.equal(cell.react.reconciler, tuple.packages['react-reconciler']);
        assert.ok(seed.registry['pixi.js'].selected[cell.deps['pixi.js']], `${cell.id}: pixi.js is in the audited registry sample`);
    }
});

test('the runner and generator never hardcode a package layout', () =>
{
    for (const name of ['matrix.mjs', 'run-cells.mjs', 'pack.mjs', 'probes.mjs'])
    {
        const text = readFileSync(join(here, name), 'utf8');

        assert.ok(!/react-1[89]|19\.[0-3]|pixi-react-provisional/.test(text.replace(/\/\/.*$/gm, '')), `${name} names a package or subpath; it belongs in seed.json adapterMatrix`);
    }
    for (const file of readdirSync(join(here, 'harness'), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()))
    {
        const text = readFileSync(join(file.parentPath, file.name), 'utf8');

        assert.ok(!/react-19|react-18\b|19\.[0-3]['"/]/.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${file.name} names a package or subpath`);
    }
});

test('negative cases each name the command that must reject them', () =>
{
    for (const cell of negativeCells(seed))
    {
        assert.ok(cell.commands.includes(cell.expect.failingCommand), cell.id);
        assert.ok(cell.expect.signatures.length > 0);
    }
});

/** Synthetic `artifacts.json`: one multi-entry react artifact, a pixi artifact, and the common ones. */
function artifactsWith(overrides = {})
{
    const entries = (...names) => Object.fromEntries(names.map((name) => [name, { hash: `entry:${name}`, files: [] }]));
    const artifacts = {
        core: { hash: 'core', entries: {} },
        renderer: { hash: 'renderer', entries: {} },
        conformance: { hash: 'conformance', entries: {} },
        'react-18': { hash: 'r18', entries: entries('.') },
        'react-19': { hash: 'r19', entries: entries('./19.0', './19.1', './19.2', './19.3') },
        'pixi-8': { hash: 'p8', entries: entries('.') },
    };

    for (const [id, patch] of Object.entries(overrides)) artifacts[id] = { ...artifacts[id], ...patch, entries: { ...artifacts[id].entries, ...patch.entries } };

    return artifacts;
}

const keys = (artifacts, harness = 'h') => Object.fromEntries(selectCells(seed, 'pr').map((cell) => [cell.id, cellKey(seed, cell, artifacts, harness, { platform: 'linux' }).key]));
const changed = (before, after) => Object.keys(before).filter((id) => before[id] !== after[id]).sort();

test('cache keys: one adapter entry invalidates exactly the cells that use it', () =>
{
    const before = keys(artifactsWith());
    const after = keys(artifactsWith({ 'react-19': { hash: 'r19-changed', entries: { './19.1': { hash: 'entry:./19.1:edited', files: [] } } } }));

    assert.deepEqual(changed(before, after), ['react-19.1.9_pixi-8.22.0', 'react-19.1.9_pixi-8.2.6'].sort());
});

test('cache keys: shared artifacts, versions and the harness invalidate every cell', () =>
{
    const before = keys(artifactsWith());

    assert.equal(changed(before, keys(artifactsWith({ core: { hash: 'core2' } }))).length, 10);
    assert.equal(changed(before, keys(artifactsWith({ conformance: { hash: 'c2' } }))).length, 10);
    assert.equal(changed(before, keys(artifactsWith(), 'harness2')).length, 10);
    assert.deepEqual(changed(before, keys(artifactsWith({ 'pixi-8': { hash: 'p8-2' } }))).length, 10);
    assert.deepEqual(changed(before, keys(artifactsWith({ 'react-18': { hash: 'x', entries: { '.': { hash: 'entry:.:2', files: [] } } } }))), ['react-18.3.1_pixi-8.22.0', 'react-18.3.1_pixi-8.2.6'].sort());
});

test('cache keys: a dependency version changes the key', () =>
{
    const [cell] = selectCells(seed, 'pr');
    const artifacts = artifactsWith();
    const base = cellKey(seed, cell, artifacts, 'h', {});
    const bumped = { ...cell, deps: { ...cell.deps, react: '18.3.2' } };

    assert.notEqual(cellKey(seed, bumped, artifacts, 'h', {}).key, base.key);
    assert.notEqual(cellKey(seed, bumped, artifacts, 'h', {}).depsKey, base.depsKey);
});

test('entry scoping follows relative imports and ignores sibling entries', () =>
{
    const root = mkdtempSync(join(tmpdir(), 'closure-'));

    try
    {
        const write = (path, text) =>
        {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
        };

        write('dist/a/index.js', 'module.exports = require("./impl.js");');
        write('dist/a/impl.js', 'module.exports = 1;');
        write('dist/a/index.mjs', 'import x from "./index.js"; export default x;');
        write('dist/a/index.d.ts', 'export * from "../shared/types.js";');
        write('dist/a/index.d.mts', 'export * from "./index.js";');
        write('dist/shared/types.d.ts', 'export type T = 1;');
        write('dist/b/index.js', 'module.exports = 2;');
        write('dist/b/index.mjs', 'export default 2;');
        write('dist/b/index.d.ts', 'export {};');
        write('dist/b/index.d.mts', 'export {};');
        const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
        const exportsOf = (dir) => ({ import: { types: `./dist/${dir}/index.d.mts`, default: `./dist/${dir}/index.mjs` }, require: { types: `./dist/${dir}/index.d.ts`, default: `./dist/${dir}/index.js` } });
        const manifest = { name: 'pkg', __root: root, exports: { './a': exportsOf('a'), './b': exportsOf('b') } };

        assert.deepEqual(entryClosure(files, manifest, './a'), ['dist/a/impl.js', 'dist/a/index.d.mts', 'dist/a/index.d.ts', 'dist/a/index.js', 'dist/a/index.mjs', 'dist/shared/types.d.ts']);
        assert.deepEqual(entryClosure(files, manifest, './b'), ['dist/b/index.d.mts', 'dist/b/index.d.ts', 'dist/b/index.js', 'dist/b/index.mjs']);
        write('dist/b/index.js', 'module.exports = require("./missing.js");');
        assert.throws(() => entryClosure(files, manifest, './b'), /missing\.js/);
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test('boundary probes: the checked-in evidence is not drift; changed surfaces, observations and known failures are', () =>
{
    const summary = (id) => structuredClone(evidence.results.find((row) => row.id === id));

    assert.deepEqual(compareWithEvidence(seed, summary('pixi-8.9.0')), { drift: [], warnings: [] });
    assert.deepEqual(compareWithEvidence(seed, summary('react-19.3.0')), { drift: [], warnings: [] });

    const surface = summary('pixi-8.9.0');
    const [path] = Object.keys(surface.surfaces);

    surface.surfaces[path].sha256 = '0'.repeat(64);
    assert.match(compareWithEvidence(seed, surface).drift.join('\n'), /surface digest differs.*changed files/);

    const observation = summary('pixi-8.10.0');

    observation.observation.observations.removeParticlesDefaultCount = 0;
    assert.match(compareWithEvidence(seed, observation).drift.join('\n'), /runtime observation changed \(observations\)/);

    const known = summary('pixi-8.5.0');

    assert.deepEqual(compareWithEvidence(seed, known).drift, [], 'the 8.5.0 failure is the recorded, expected one');
    known.failure = 'Error: something else';
    assert.match(compareWithEvidence(seed, known).drift.join('\n'), /known failure .* is gone or changed/);

    const lock = summary('pixi-8.2.6');

    lock.resolvedPackages['left-pad'] = { version: '1.0.0', integrity: 'sha512-x' };
    assert.deepEqual(compareWithEvidence(seed, lock).drift, []);
    assert.equal(compareWithEvidence(seed, lock).warnings.length, 1);
});

test('COMPATIBILITY.md is current', () =>
{
    assert.equal(readFileSync(join(here, 'COMPATIBILITY.md'), 'utf8'), renderCompatibilityDoc(seed), 'run: node design/compatibility/cells/run-cells.mjs doc > design/compatibility/cells/COMPATIBILITY.md');
});

test('generated GitHub matrices use the keys the workflows read (matrix.<key>.*)', async () =>
{
    const { execFileSync } = await import('node:child_process');
    const cli = join(here, 'run-cells.mjs');
    const emit = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
    const workflows = join(here, '../../../.github/workflows');
    const read = (file) => readFileSync(join(workflows, file), 'utf8');
    const keysUsed = (text) => new Set([...text.matchAll(/matrix\.(\w+)\./g)].map((match) => match[1]));
    const generated = {
        cell: emit('list', '--tier', 'pr', '--format', 'github'),
        probe: emit('probe-list', '--tier', 'pr'),
        chunk: emit('list', '--tier', 'nightly', '--format', 'chunks'),
    };

    for (const [key, value] of Object.entries(generated))
    {
        assert.deepEqual(Object.keys(value), [key], `${key} matrix has the single axis "${key}"`);
        assert.ok(value[key].length > 0 && value[key].every((entry) => entry.id ?? entry.cells), `${key} entries are named`);
    }

    assert.deepEqual([...keysUsed(read('compatibility.yml'))].sort(), ['cell', 'probe']);
    assert.deepEqual([...keysUsed(read('compatibility-nightly.yml'))].sort(), ['chunk']);
});

test('cache keys: a manifest expectation change invalidates the affected cells', () =>
{
    const artifacts = artifactsWith();
    const keyed = (mutate) =>
    {
        const copy = structuredClone(seed);

        mutate(copy.adapterMatrix);

        return Object.fromEntries(selectCells(copy, 'pr').map((cell) => [cell.id, cellKey(copy, cell, artifacts, 'h', { platform: 'linux' }).key]));
    };
    const before = keyed(() => undefined);

    assert.deepEqual(changed(before, keyed((m) => { m.reactAdapters.react190.expectedConformanceFailures = []; })),
        ['react-19.0.8_pixi-8.22.0', 'react-19.0.8_pixi-8.2.6'].sort());
    assert.deepEqual(changed(before, keyed((m) => { m.reactAdapters.react18.declaredPeers = { react: '18.3.2' }; })),
        ['react-18.3.1_pixi-8.22.0', 'react-18.3.1_pixi-8.2.6'].sort());
    assert.equal(changed(before, keyed((m) => { m.pixiAdapters.pixi8.declaredPeers = { 'pixi.js': '>=8.2.6' }; })).length, 10);
});
