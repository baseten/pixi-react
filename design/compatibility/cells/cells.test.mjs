// Offline tests of the cell generator, cache keys, entry scoping and drift detection. Run with
// `node --test design/compatibility/cells/*.test.mjs`; nothing here installs a package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyTypeAssertions, cellKey, expectedBlankFor, gpuProfileOf, loadSeed, negativeCells, platformCommand, renderCompatibilityDoc, renderTable, selectCells, typeAssertionsFor, validateAdapterMatrix } from './matrix.mjs';
import { entryClosure, extractTarball } from './pack.mjs';
import { compareWithEvidence } from './probes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seed = loadSeed();
const evidence = JSON.parse(readFileSync(join(here, '../evidence.json'), 'utf8'));

test('the adapterMatrix section validates against the rest of the seed', () => validateAdapterMatrix(seed));

test('PR tier: React 18.3 and every React 19 epoch at its latest patch against Pixi 8.2.6 and 8.22.0, React 18.0 at 8.2.6, plus two Pixi 7 cells', () =>
{
    const ids = selectCells(seed, 'pr').map((cell) => cell.id);

    assert.deepEqual(ids.sort(), [
        'react-18.3.1_pixi-8.2.6', 'react-18.3.1_pixi-8.22.0',
        'react-19.0.8_pixi-8.2.6', 'react-19.0.8_pixi-8.22.0',
        'react-19.1.9_pixi-8.2.6', 'react-19.1.9_pixi-8.22.0',
        'react-19.2.8_pixi-8.2.6', 'react-19.2.8_pixi-8.22.0',
        'react-19.3.0_pixi-8.2.6', 'react-19.3.0_pixi-8.22.0',
        // The lowest React 18 minor at the Pixi 8 minimum; React 18.1 and 18.2 run nightly.
        'react-18.0.0_pixi-8.2.6',
        // Pixi 7 (issue 16): React 18.0 at the Pixi 7 minimum (7.2.0) and React 19.3 at the current Pixi 7; the rest is nightly.
        'react-18.0.0_pixi-7.2.0', 'react-19.3.0_pixi-7.4.3',
    ].sort());
    for (const cell of selectCells(seed, 'pr')) assert.equal(cell.pixi.adapter.id, cell.pixi.version.startsWith('7.') ? 'pixi-7' : 'pixi-8', cell.id);
});

test('PR tier: a non-default Pixi adapter may add at most two cells', () =>
{
    const widened = structuredClone(seed);

    widened.adapterMatrix.tiers.pr.pixiAdapters.pixi7 = { react: { epochs: 'all', patch: 'latest' }, pixi: { versions: ['minimum'] } };
    assert.throws(() => validateAdapterMatrix(widened), /pixi7 adds 8 cells; at most 2/);
});

test('nightly tier is the full cross-product, generated from the seed', () =>
{
    const nightly = selectCells(seed, 'nightly');
    const pixi = new Set(nightly.map((cell) => cell.pixi.version));
    const react = new Set(nightly.map((cell) => cell.react.version));

    assert.equal(react.size, 8, 'React 18.0, 18.1, 18.2, 18.3 and 19.0 to 19.3');
    assert.equal(pixi.size, 21 + 6, 'Pixi 8.2 through 8.22, one latest audited patch per minor, and every audited Pixi 7 release in range');
    assert.equal(nightly.length, react.size * pixi.size);
    assert.ok(!pixi.has('8.5.0'), 'the excluded 8.5.0 is never selected');
    assert.ok(pixi.has('8.5.2'));
    assert.deepEqual([...pixi].filter((version) => version.startsWith('7.')).sort(), ['7.2.0', '7.2.4', '7.3.0', '7.3.3', '7.4.2', '7.4.3']);
    // React 18.0, 18.1, 18.2 and 19.3 have one audited patch each; 18.3 (18.3.1) too; 19.0 to 19.2 two.
    assert.equal(selectCells(seed, 'nightly', { patches: 'all' }).length, 11 * (21 + 6), 'minimum and latest React patches');
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

test('every Pixi adapter row names a type consumer and a probe the harness has', () =>
{
    for (const [key, adapter] of Object.entries(seed.adapterMatrix.pixiAdapters))
    {
        assert.ok(readdirSync(join(here, 'harness/typecheck')).includes(adapter.typeConsumer), `${key}: ${adapter.typeConsumer} is not in harness/typecheck`);
        assert.match(readFileSync(join(here, '../../..', adapter.probeSource), 'utf8'), new RegExp(`export function ${adapter.probeFactory}\\b`), `${key}: ${adapter.probeSource} exports ${adapter.probeFactory}`);
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
        'react-18.0': { hash: 'r180', entries: entries('.') },
        'react-18.1': { hash: 'r181', entries: entries('.') },
        'react-18.2': { hash: 'r182', entries: entries('.') },
        'react-18.3': { hash: 'r183', entries: entries('.') },
        'react-19.0': { hash: 'r190', entries: entries('.') },
        'react-19.1': { hash: 'r191', entries: entries('.') },
        'react-19.2': { hash: 'r192', entries: entries('.') },
        'react-19.3': { hash: 'r193', entries: entries('.') },
        'pixi-8': { hash: 'p8', entries: entries('.') },
        'pixi-7': { hash: 'p7', entries: entries('.') },
    };

    for (const [id, patch] of Object.entries(overrides)) artifacts[id] = { ...artifacts[id], ...patch, entries: { ...artifacts[id].entries, ...patch.entries } };

    return artifacts;
}

const keys = (artifacts, harness = 'h') => Object.fromEntries(selectCells(seed, 'pr').map((cell) => [cell.id, cellKey(seed, cell, artifacts, harness, { platform: 'linux' }).key]));
const changed = (before, after) => Object.keys(before).filter((id) => before[id] !== after[id]).sort();

test('cache keys: one adapter entry invalidates exactly the cells that use it', () =>
{
    const before = keys(artifactsWith());
    const after = keys(artifactsWith({ 'react-19.1': { hash: 'r191-changed', entries: { '.': { hash: 'entry:.:edited', files: [] } } } }));

    assert.deepEqual(changed(before, after), ['react-19.1.9_pixi-8.22.0', 'react-19.1.9_pixi-8.2.6'].sort());
});

test('cache keys: shared artifacts, versions and the harness invalidate every cell', () =>
{
    const before = keys(artifactsWith());

    assert.equal(changed(before, keys(artifactsWith({ core: { hash: 'core2' } }))).length, 13);
    assert.equal(changed(before, keys(artifactsWith({ conformance: { hash: 'c2' } }))).length, 13);
    assert.equal(changed(before, keys(artifactsWith(), 'harness2')).length, 13);
    assert.deepEqual(changed(before, keys(artifactsWith({ 'pixi-8': { hash: 'p8-2' } }))).length, 11);
    assert.deepEqual(changed(before, keys(artifactsWith({ 'pixi-7': { hash: 'p7-2' } }))), ['react-18.0.0_pixi-7.2.0', 'react-19.3.0_pixi-7.4.3']);
    assert.deepEqual(changed(before, keys(artifactsWith({ 'react-18.3': { hash: 'x', entries: { '.': { hash: 'entry:.:2', files: [] } } } }))), ['react-18.3.1_pixi-8.22.0', 'react-18.3.1_pixi-8.2.6'].sort());
    assert.deepEqual(changed(before, keys(artifactsWith({ 'react-18.0': { hash: 'x', entries: { '.': { hash: 'entry:.:2', files: [] } } } }))), ['react-18.0.0_pixi-7.2.0', 'react-18.0.0_pixi-8.2.6'].sort());
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
    assert.deepEqual(changed(before, keyed((m) => { m.reactAdapters.react183.declaredPeers = { react: '18.3.2' }; })),
        ['react-18.3.1_pixi-8.22.0', 'react-18.3.1_pixi-8.2.6'].sort());
    assert.equal(changed(before, keyed((m) => { m.pixiAdapters.pixi8.declaredPeers = { 'pixi.js': '>=8.2.6' }; })).length, 11);
    assert.deepEqual(changed(before, keyed((m) => { m.pixiAdapters.pixi7.conformanceCapabilities = ['pixi.graphics-context']; })),
        ['react-18.0.0_pixi-7.2.0', 'react-19.3.0_pixi-7.4.3']);
});

test('cache keys: the generated effective configuration is part of the key', () =>
{
    const [cell] = selectCells(seed, 'pr');
    const artifacts = artifactsWith();
    const key = (effective) => cellKey(seed, cell, artifacts, 'h', {}, effective).key;

    assert.notEqual(key({ formats: ['esm', 'cjs'] }), key({ formats: ['esm'] }));
    assert.notEqual(key({ adapters: { pixi: { provides: ['pixi.renderLayer'] } } }), key({ adapters: { pixi: { provides: [] } } }));
});

test('GPU profiles: software by default (SwiftShader flags), hardware with none and a headed browser', () =>
{
    const software = gpuProfileOf(seed);
    const hardware = gpuProfileOf(seed, 'hardware');

    assert.equal(software.id, 'software');
    assert.ok(software.headless && software.chromiumArgs.webgpu.includes('--use-webgpu-adapter=swiftshader'));
    assert.equal(hardware.expect, 'hardware');
    assert.equal(hardware.headless, false);
    assert.deepEqual(Object.values(hardware.chromiumArgs).flat().filter((arg) => /swiftshader/i.test(arg)), []);
    assert.throws(() => gpuProfileOf(seed, 'metal'), /unknown GPU profile metal/);
});

test('the expected-blank-render list applies to its own backend, versions and GPU profile only', () =>
{
    const lookup = (pixi, renderer = 'webgpu', gpuProfile = 'software', pixiAdapter = 'pixi8') => expectedBlankFor(seed, { pixiAdapter, pixi, renderer, gpuProfile })?.id ?? null;
    const [entry] = seed.adapterMatrix.expectedBlankRender;

    assert.equal(lookup('8.9.2'), entry.id);
    assert.equal(lookup('8.2.6', 'webgpu', 'software', 'pixi-8'), entry.id, 'by adapter id as well as key');
    assert.equal(lookup('8.10.2'), null);
    assert.equal(lookup('8.9.2', 'webgl'), null);
    assert.equal(lookup('8.9.2', 'webgpu', 'hardware'), null);
});

test('the table shows an expected blank render as a pass on the other backend, never as verified', () =>
{
    const row = { id: 'react-19.3.0_pixi-8.9.2', kind: 'cell', adapterLabel: 'react-19.3', reactVersion: '19.3.0', pixiVersion: '8.9.2', status: 'pass', backends: { webgl: { status: 'pass' }, webgpu: { status: 'expected-fail' } } };

    assert.match(renderTable(seed, [row]), /pass \(WebGL\), WebGPU expected blank \(unverified\)/);
});

test('package managers spawn without a POSIX shell, through .cmd shims on Windows', () =>
{
    assert.deepEqual(platformCommand('npm', ['install', '--strict-peer-deps'], 'linux'), { file: 'npm', args: ['install', '--strict-peer-deps'], shell: false });
    assert.deepEqual(platformCommand('pnpm', ['pack', '--pack-destination', 'C:\\Users\\a b\\out'], 'win32'), { file: 'pnpm.cmd', args: ['pack', '--pack-destination', '"C:\\Users\\a b\\out"'], shell: true });
});

test('tarballs extract without a tar binary, stripping the package/ prefix', (t) =>
{
    const root = mkdtempSync(join(tmpdir(), 'compat-tar-test-'));

    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'src', 'package', 'dist', 'deep'), { recursive: true });
    writeFileSync(join(root, 'src', 'package', 'package.json'), '{"name":"x"}');
    writeFileSync(join(root, 'src', 'package', 'dist', 'deep', `${'long-name-'.repeat(12)}.js`), 'export {};\n');
    const made = spawnSync('tar', ['-czf', join(root, 'x.tgz'), '-C', join(root, 'src'), 'package'], { encoding: 'utf8' });

    if (made.status !== 0) return t.skip('no tar binary to build the fixture');
    extractTarball(join(root, 'x.tgz'), join(root, 'out'));
    assert.equal(readFileSync(join(root, 'out', 'package.json'), 'utf8'), '{"name":"x"}');
    assert.equal(readFileSync(join(root, 'out', 'dist', 'deep', `${'long-name-'.repeat(12)}.js`), 'utf8'), 'export {};\n');
});

test('version-dependent type assertions: kept from their version on, omitted below it with the reason, never silently', () =>
{
    const consumer = readFileSync(join(here, 'harness/typecheck/consumer.pixi7.tsx'), 'utf8');
    const at = (version) => applyTypeAssertions(consumer, typeAssertionsFor(seed, 'pixi7', version));

    assert.deepEqual(typeAssertionsFor(seed, 'pixi7', '7.2.4').omitted.map(({ id }) => id), ['pixi8-names-rejected']);
    assert.deepEqual(typeAssertionsFor(seed, 'pixi7', '7.3.0'), { kept: ['pixi8-names-rejected'], omitted: [] });
    // 7.3+ keeps both @ts-expect-error assertions and drops only the markers.
    assert.equal((at('7.4.3').match(/@ts-expect-error `label`|@ts-expect-error Pixi 7 Graphics/g) ?? []).length, 2);
    assert.doesNotMatch(at('7.4.3'), /compat:(begin|end) pixi8-names-rejected/);
    // 7.2 omits them and says so in the generated consumer.
    assert.ok(!at('7.2.0').includes('<SpriteComponent label="sprite" />'));
    assert.match(at('7.2.0'), /type assertion pixi8-names-rejected omitted below pixi\.js 7\.3\.0: pixi\.js 7\.2's declarations import/);
    // Every other assertion stays.
    assert.ok(at('7.2.0').includes('@ts-expect-error `preference` is a Pixi 8 renderer option'));
    assert.throws(() => applyTypeAssertions('{/* compat:begin unknown */}\nx\n{/* compat:end unknown */}\n', { kept: [], omitted: [] }), /not an adapterMatrix typeAssertions entry/);
});
