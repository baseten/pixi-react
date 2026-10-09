// Offline tests of the release tooling (issue 15): `node --test scripts/release/*.test.mjs`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadReleaseConfig, makeRewriter, repoRoot, WORK_MARKER, workDirProblem } from './config.mjs';
import { checkTree, scanInstalls } from './consumers.mjs';
import { inspectPackage, resolveExport } from './inspect.mjs';
import { checkPolicy, readPlan } from './policy.mjs';
import { releaseManifest, tarballName } from './stage.mjs';
import { syncVersionConstants } from './version.mjs';

const target = loadReleaseConfig({ namespace: 'target' });

test('the target namespace maps every publishable package to the owner ruling of 2026-10-09', () =>
{
    assert.deepEqual(Object.fromEntries(target.packages.map((pkg) => [pkg.dir, pkg.publicName])), {
        'packages/react': '@pixi/react',
        'packages/core': '@pixi/react-core',
        'packages/renderer': '@pixi/react-renderer',
        'packages/react-19.0': '@pixi/react-19.0',
        'packages/react-19.1': '@pixi/react-19.1',
        'packages/react-19.2': '@pixi/react-19.2',
        'packages/react-19.3': '@pixi/react-19.3',
        'packages/react-18': '@pixi/react-18',
        'packages/pixi-8': '@pixi/react-pixi-8',
    });
    assert.equal(target.publishEnabled, false, 'publishing stays disabled');
});

test('the namespace switch renames every package, the facade included', () =>
{
    const fallback = loadReleaseConfig({ namespace: 'fallback' });

    assert.ok(fallback.packages.every((pkg) => pkg.publicName.startsWith('@baseten/pixi-react')));
    assert.equal(makeRewriter(fallback)('require(\'@pixi/react\'); import \'@pixi-react-provisional/pixi-8/jsx\';'), 'require(\'@baseten/pixi-react\'); import \'@baseten/pixi-react-pixi-8/jsx\';');
    assert.throws(() => loadReleaseConfig({ namespace: 'nope' }), /no namespace "nope"/);
});

test('the rewriter replaces whole package names only', () =>
{
    const rewrite = makeRewriter(target);

    assert.equal(rewrite('require("@pixi-react-provisional/core")'), 'require("@pixi/react-core")');
    assert.equal(rewrite('from \'@pixi-react-provisional/react-19.3\';'), 'from \'@pixi/react-19.3\';');
    assert.equal(rewrite('`@pixi-react-provisional/react-19.3`.'), '`@pixi/react-19.3`.', 'a sentence-ending period is not part of the name');
    assert.equal(rewrite('@pixi-react-provisional/pixi-8/jsx/react-18'), '@pixi/react-pixi-8/jsx/react-18');
    assert.equal(rewrite('(for example @pixi-react-provisional/react-${minorOf(actual) ?? "19.x"})'), '(for example @pixi/react-${minorOf(actual) ?? "19.x"})');
    assert.equal(rewrite('`@pixi-react-provisional/react-shared/common`'), '`react-shared/common`');
    // Names that are not publishable stay, so the residue check in stage.mjs reports them.
    assert.equal(rewrite('@pixi-react-provisional/react-18-fixture-18.3.1'), '@pixi-react-provisional/react-18-fixture-18.3.1');
    assert.equal(rewrite('@pixi-react-provisional/react-19.4'), '@pixi-react-provisional/react-19.4');
    assert.equal(rewrite('@pixi-react-provisional/core-extra'), '@pixi-react-provisional/core-extra');
});

test('releaseManifest renames, strips scripts and devDependencies, and fails closed', () =>
{
    const pkg = target.packages.find((item) => item.dir === 'packages/react-19.3');
    const manifest = releaseManifest({
        name: pkg.workspaceName,
        version: '1.0.0',
        private: true,
        scripts: { build: 'x', postinstall: 'y' },
        dependencies: { '@pixi-react-provisional/core': '^1.0.0', 'react-reconciler': '0.34.0' },
        devDependencies: { '@pixi-react-provisional/react-shared': '0.0.0' },
        peerDependencies: { react: '19.3.0' },
    }, pkg, target);

    assert.equal(manifest.name, '@pixi/react-19.3');
    assert.deepEqual(manifest.dependencies, { '@pixi/react-core': '^1.0.0', 'react-reconciler': '0.34.0' });
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.private, true, 'private while publishing is disabled');
    assert.throws(() => releaseManifest({ name: pkg.workspaceName, dependencies: { '@pixi-react-provisional/react-shared': '0.0.0' } }, pkg, target), /never published/);
    assert.throws(() => releaseManifest({ name: pkg.workspaceName, dependencies: { '@pixi-react-provisional/core': 'workspace:^' } }, pkg, target), /still workspace:/);
    assert.equal(tarballName('@pixi/react-19.3', '1.0.0'), 'pixi-react-19.3-1.0.0.tgz');
});

test('resolveExport follows condition order like Node and TypeScript', () =>
{
    const entry = { import: { types: './a.d.mts', default: './a.mjs' }, require: { types: './a.d.ts', default: './a.js' } };

    assert.equal(resolveExport(entry, ['import', 'node']), './a.mjs');
    assert.equal(resolveExport(entry, ['types', 'require', 'node']), './a.d.ts');
    assert.equal(resolveExport({ types: './j.d.ts', default: './j.js' }, ['types', 'import']), './j.d.ts');
    assert.equal(resolveExport({ browser: './b.js' }, ['import']), null);
});

function fakePackage(manifest, files)
{
    const dir = mkdtempSync(join(tmpdir(), 'release-test-'));

    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    for (const [file, text] of Object.entries(files))
    {
        mkdirSync(join(dir, file, '..'), { recursive: true });
        writeFileSync(join(dir, file), text);
    }

    return dir;
}

test('inspectPackage accepts a well-formed adapter and reports each kind of defect', () =>
{
    const entry = { dir: 'packages/react-19.3', publicName: '@pixi/react-19.3' };
    const staged = [{ publicName: '@pixi/react-core', version: '1.0.0' }, { publicName: '@pixi/react-19.3', version: '1.0.0' }];
    const good = {
        name: '@pixi/react-19.3', version: '1.0.0', private: true, license: 'MIT',
        exports: { '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' }, require: { types: './dist/index.d.ts', default: './dist/index.js' } } },
        imports: { '#reconciler': 'react-reconciler' },
        dependencies: { '@pixi/react-core': '^1.0.0', 'react-reconciler': '0.34.0', 'its-fine': '2.1.1' },
        peerDependencies: { react: '19.3.0' },
    };
    const files = {
        'dist/index.js': 'const r = require(\'#reconciler\'); const c = require(\'@pixi/react-core\'); require(\'react\'); require(\'node:fs\');',
        'dist/index.mjs': 'import c from \'./index.js\'; export default c;',
        'dist/index.d.ts': 'import type { ReactNode } from \'react\';\n/** import { x } from \'@pixi/react-renderer\'; (a usage example) */\nexport {};',
        'dist/index.d.mts': 'export * from \'./index.js\';',
    };
    const dir = fakePackage(good, files);

    try
    {
        assert.deepEqual(inspectPackage(dir, entry, staged, target).problems, []);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }

    const bad = fakePackage({
        ...good,
        private: false,
        scripts: { postinstall: 'node build.js' },
        dependencies: { '@pixi/react-core': '1.0.0', 'react-reconciler': '^0.34.0', react: '19.3.0' },
        peerDependencies: { react: '^19.3.0' },
    }, { ...files, 'dist/index.js': 'require(\'lodash\'); require(\'#missing\');' });

    try
    {
        const problems = inspectPackage(bad, entry, staged, target).problems.join('\n');

        for (const expected of [/"private" is false/, /dependencies\.@pixi\/react-core is 1\.0\.0, expected \^1\.0\.0/, /react is a dependency/, /react-reconciler is \^0\.34\.0/, /without an exact its-fine/, /not a list of exact versions/, /lifecycle script "postinstall"/, /imports undeclared lodash/, /#missing/])
        {
            assert.match(problems, expected);
        }
    }
    finally
    {
        rmSync(bad, { recursive: true, force: true });
    }
});

test('the committed release plan satisfies the policy (Release 1: facade 8.1.0, modular packages 1.0.0)', () =>
{
    const result = checkPolicy({ plan: readPlan() });

    assert.deepEqual(result.problems, []);
    assert.deepEqual(Object.fromEntries(result.plan.map((release) => [release.name, release.newVersion])), Object.fromEntries(target.packages.map((pkg) => [pkg.workspaceName, pkg.release1])));
});

/** A synthetic plan over the real workspace: each entry `name: [type, newVersion, explicit?]`. */
function plan(entries)
{
    const releases = Object.entries(entries).map(([name, [type, newVersion]]) => ({ name, type, newVersion, oldVersion: '0.0.0', changesets: [] }));
    const explicit = Object.entries(entries).filter(([, [, , isExplicit]]) => isExplicit !== false).map(([name, [type]]) => ({ name, type }));

    return { changesets: [{ id: 'synthetic', releases: explicit }], releases };
}

test('an ABI major change needs an explicit major release of every package that depends on core', () =>
{
    const released = { ...target, releasedAbi: { major: 1, minor: 0 } };
    const dependents = target.packages.filter((pkg) => !pkg.facade && pkg.dir !== 'packages/core').map((pkg) => pkg.workspaceName);
    // Core goes to 2.0.0, but CORE_ABI in the source is still 1: the core major must equal the ABI major.
    const coreOnly = checkPolicy({ config: released, plan: plan({ '@pixi-react-provisional/core': ['major', '2.0.0'], ...Object.fromEntries(dependents.map((name) => [name, ['patch', '1.0.1', false]])) }) }).problems.join('\n');

    assert.match(coreOnly, /core will be 2\.0\.0, but its major must equal the ABI major 1/);
    for (const name of dependents) assert.match(coreOnly, new RegExp(`${name.replace(/[.]/g, '\\.')} depends on core and needs its own major changeset`));

    const withDependents = checkPolicy({ config: released, plan: plan({ '@pixi-react-provisional/core': ['major', '2.0.0'], ...Object.fromEntries(dependents.map((name) => [name, ['major', '2.0.0']])) }) }).problems;

    assert.ok(!withDependents.some((problem) => problem.includes('needs its own major changeset')), withDependents.join('\n'));
});

test('an ABI minor increase needs at least a minor core release', () =>
{
    const config = { ...target, releasedAbi: { major: 1, minor: -1 } };
    const patch = checkPolicy({ config, plan: plan({ '@pixi-react-provisional/core': ['patch', '1.0.1'] }) }).problems.join('\n');

    assert.match(patch, /CORE_ABI minor rose to 0 \(released -1\): core needs at least a minor changeset/);
    assert.doesNotMatch(checkPolicy({ config, plan: plan({ '@pixi-react-provisional/core': ['minor', '1.1.0'] }) }).problems.join('\n'), /minor rose/);
});

test('Release 1 must reach exactly the configured versions', () =>
{
    const problems = checkPolicy({ plan: plan({ '@pixi/react': ['major', '9.0.0'], '@pixi-react-provisional/core': ['major', '1.0.0'] }) }).problems.join('\n');

    assert.match(problems, /Release 1: @pixi\/react would release 9\.0\.0, expected 8\.1\.0/);
    assert.match(problems, /Release 1: @pixi-react-provisional\/renderer would release 0\.0\.0, expected 1\.0\.0/);
});

test('syncVersionConstants copies package.json versions into the source constants', () =>
{
    const root = mkdtempSync(join(tmpdir(), 'release-sync-'));

    try
    {
        const raw = JSON.parse(readFileSync(join(repoRoot, 'release.packages.json'), 'utf8'));

        raw.packages = { 'packages/react-19.3': raw.packages['packages/react-19.3'], 'packages/react-18': raw.packages['packages/react-18'] };
        writeFileSync(join(root, 'release.packages.json'), JSON.stringify(raw));
        mkdirSync(join(root, 'packages/react-19.3/src'), { recursive: true });
        mkdirSync(join(root, 'packages/react-18/src'), { recursive: true });
        writeFileSync(join(root, 'packages/react-19.3/package.json'), JSON.stringify({ version: '1.2.3' }));
        writeFileSync(join(root, 'packages/react-18/package.json'), JSON.stringify({ version: '0.0.0' }));
        writeFileSync(join(root, 'packages/react-19.3/src/package.ts'), 'export const PACKAGE = Object.freeze({ name: \'x\', version: \'0.0.0\' });\n');
        writeFileSync(join(root, 'packages/react-18/src/version.ts'), 'export const PACKAGE_VERSION = \'0.0.0\';\n');

        assert.deepEqual(syncVersionConstants(root), ['packages/react-19.3/src/package.ts: 0.0.0 -> 1.2.3']);
        assert.equal(readFileSync(join(root, 'packages/react-19.3/src/package.ts'), 'utf8'), 'export const PACKAGE = Object.freeze({ name: \'x\', version: \'1.2.3\' });\n');
        assert.equal(readFileSync(join(root, 'packages/react-18/src/version.ts'), 'utf8'), 'export const PACKAGE_VERSION = \'0.0.0\';\n');
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the consumer tree check counts physical copies, not logical versions', () =>
{
    const dir = mkdtempSync(join(tmpdir(), 'release-installs-'));
    const install = (location, name, version) =>
    {
        mkdirSync(join(dir, location), { recursive: true });
        writeFileSync(join(dir, location, 'package.json'), JSON.stringify({ name, version }));
    };

    try
    {
        install('node_modules/@pixi/react-core', '@pixi/react-core', '1.0.0');
        install('node_modules/@pixi/react-19.3', '@pixi/react-19.3', '1.0.0');
        const scenario = { registry: {}, tree: { exactly: { '@pixi/react-core': '1.0.0' } } };
        // `npm ls` shows the same version on both paths, so a version count alone cannot see the second copy.
        const tree = {
            dependencies: {
                '@pixi/react-core': { version: '1.0.0' },
                '@pixi/react-19.3': { version: '1.0.0', dependencies: { '@pixi/react-core': { version: '1.0.0' } } },
            }
        };

        assert.deepEqual(checkTree(scenario, tree, scanInstalls(dir)).problems, []);

        install('node_modules/@pixi/react-19.3/node_modules/@pixi/react-core', '@pixi/react-core', '1.0.0');
        assert.deepEqual(scanInstalls(dir)['@pixi/react-core'].map((copy) => copy.location), ['node_modules/@pixi/react-19.3/node_modules/@pixi/react-core', 'node_modules/@pixi/react-core']);
        assert.match(checkTree(scenario, tree, scanInstalls(dir)).problems.join('\n'), /@pixi\/react-core: installed 1\.0\.0 at node_modules\/@pixi\/react-19\.3\/node_modules\/@pixi\/react-core, 1\.0\.0 at node_modules\/@pixi\/react-core, expected exactly 1\.0\.0 once/);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the dry run refuses work directories it must not wipe', () =>
{
    const dir = mkdtempSync(join(tmpdir(), 'release-work-'));
    const source = join(dir, 'source');
    const stray = join(dir, 'stray');
    const previous = join(dir, 'previous');

    try
    {
        mkdirSync(join(source, 'scripts'), { recursive: true });
        mkdirSync(stray);
        writeFileSync(join(stray, 'notes.txt'), 'keep');
        mkdirSync(previous);
        writeFileSync(join(previous, WORK_MARKER), '');
        writeFileSync(join(previous, 'old.txt'), '');

        assert.match(workDirProblem(source, source), /contains the source checkout/);
        assert.match(workDirProblem(dir, source), /contains the source checkout/);
        assert.match(workDirProblem(join(source, 'scripts'), source), /inside the source checkout/);
        assert.match(workDirProblem(join(source, 'new'), source), /inside the source checkout/);
        assert.match(workDirProblem(stray, source), /not empty and was not created by a release dry run/);
        assert.equal(workDirProblem(previous, source), null);
        assert.equal(workDirProblem(join(dir, 'fresh'), source), null);
        assert.equal(workDirProblem(join(dir, 'source-sibling'), source), null);
        assert.match(workDirProblem(repoRoot), /contains the source checkout/);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});
