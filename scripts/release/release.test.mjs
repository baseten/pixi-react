// Offline tests of the release tooling (issue 15): `node --test scripts/release/*.test.mjs`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareWithUpstream, KNOWN_GAPS, UPSTREAM_BASELINE } from './bundles.mjs';
import { loadReleaseConfig, makeRewriter, OUTPUT_MARKER, outputDirProblem, repoRoot, resetOutputDir } from './config.mjs';
import { checkTree, scanInstalls } from './consumers.mjs';
import { inspectPackage, resolveExport } from './inspect.mjs';
import { abiChanges, abiDeclarationProblems, checkPolicy, classifyReleaseState, compareVersions, currentPlan, mainMergeBase, publishedInputs, readAbiDeclarations, releaseState } from './policy.mjs';
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
        // Issue 16: the Pixi 7 adapter follows the same `@pixi/react-<suffix>` pattern as the ruling's pixi-8.
        'packages/pixi-7': '@pixi/react-pixi-7',
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
        version: '8.1.0',
        private: true,
        scripts: { build: 'x', postinstall: 'y' },
        dependencies: { '@pixi-react-provisional/core': '8.1.0', 'react-reconciler': '0.34.0' },
        devDependencies: { '@pixi-react-provisional/react-shared': '0.0.0' },
        peerDependencies: { react: '19.3.0' },
    }, pkg, target);

    assert.equal(manifest.name, '@pixi/react-19.3');
    assert.deepEqual(manifest.dependencies, { '@pixi/react-core': '8.1.0', 'react-reconciler': '0.34.0' });
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.private, true, 'private while publishing is disabled');
    assert.throws(() => releaseManifest({ name: pkg.workspaceName, dependencies: { '@pixi-react-provisional/react-shared': '0.0.0' } }, pkg, target), /never published/);
    assert.throws(() => releaseManifest({ name: pkg.workspaceName, dependencies: { '@pixi-react-provisional/core': 'workspace:^' } }, pkg, target), /still workspace:/);
    assert.equal(tarballName('@pixi/react-19.3', '8.1.0'), 'pixi-react-19.3-8.1.0.tgz');
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
    const entry = { dir: 'packages/react-19.3', publicName: '@pixi/react-19.3', version: '8.1.0' };
    const staged = [{ publicName: '@pixi/react-core', version: '8.1.0' }, { publicName: '@pixi/react-19.3', version: '8.1.0' }];
    const good = {
        name: '@pixi/react-19.3', version: '8.1.0', private: true, license: 'MIT',
        exports: { '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' }, require: { types: './dist/index.d.ts', default: './dist/index.js' } } },
        imports: { '#reconciler': 'react-reconciler' },
        dependencies: { '@pixi/react-core': '8.1.0', 'react-reconciler': '0.34.0', 'its-fine': '2.1.1' },
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
        // Publishing enabled: stage.mjs drops `private`, which inspection must accept; `private: true` still fails.
        const enabled = { ...target, publishEnabled: true };

        assert.match(inspectPackage(dir, entry, staged, enabled).problems.join('\n'), /"private" is true; publishing is enabled/);
        const publishable = { ...good };

        delete publishable.private;
        writeFileSync(join(dir, 'package.json'), JSON.stringify(publishable));
        assert.deepEqual(inspectPackage(dir, entry, staged, enabled).problems, []);
        assert.match(inspectPackage(dir, entry, staged, target).problems.join('\n'), /"private" is undefined; publishing is disabled/);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }

    const bad = fakePackage({
        ...good,
        private: false,
        scripts: { postinstall: 'node build.js' },
        dependencies: { '@pixi/react-core': '8.0.5', 'react-reconciler': '^0.34.0', react: '19.3.0' },
        peerDependencies: { react: '^19.3.0' },
    }, { ...files, 'dist/index.js': 'require(\'lodash\'); require(\'#missing\');' });

    try
    {
        const problems = inspectPackage(bad, entry, staged, target).problems.join('\n');

        for (const expected of [/"private" is false/, /dependencies\.@pixi\/react-core is 8\.0\.5; packages of this release depend on each other at exactly the same version 8\.1\.0/, /react is a dependency/, /react-reconciler is \^0\.34\.0/, /without an exact its-fine/, /not a list of exact versions/, /lifecycle script "postinstall"/, /imports undeclared lodash/, /#missing/])
        {
            assert.match(problems, expected);
        }
    }
    finally
    {
        rmSync(bad, { recursive: true, force: true });
    }
});

test('inspection rejects a ^ or ~ range, or another version, between our packages (negative)', () =>
{
    const entry = { dir: 'packages/renderer', publicName: '@pixi/react-renderer', version: '8.1.0' };
    const staged = [{ publicName: '@pixi/react-core', version: '8.1.0' }, { publicName: '@pixi/react-renderer', version: '8.1.0' }];
    const manifest = (dependencies, extra = {}) => ({
        name: '@pixi/react-renderer', version: '8.1.0', private: true, license: 'MIT',
        exports: { '.': { import: { types: './index.d.mts', default: './index.mjs' }, require: { types: './index.d.ts', default: './index.js' } } },
        dependencies,
        ...extra,
    });
    const files = { 'index.js': 'require(\'@pixi/react-core\');', 'index.mjs': 'export {};', 'index.d.ts': 'export {};', 'index.d.mts': 'export {};' };
    const problemsFor = (pkg) =>
    {
        const dir = fakePackage(pkg, files);

        try
        {
            return inspectPackage(dir, entry, staged, target).problems.join('\n');
        }
        finally
        {
            rmSync(dir, { recursive: true, force: true });
        }
    };

    assert.equal(problemsFor(manifest({ '@pixi/react-core': '8.1.0' })), '');
    assert.match(problemsFor(manifest({ '@pixi/react-core': '^8.1.0' })), /dependencies\.@pixi\/react-core is \^8\.1\.0; packages of this release depend on each other at exactly the same version 8\.1\.0 \(no \^ or ~ ranges\)/);
    assert.match(problemsFor(manifest({ '@pixi/react-core': '~8.1.0' })), /dependencies\.@pixi\/react-core is ~8\.1\.0; .* \(no \^ or ~ ranges\)/);
    assert.match(problemsFor(manifest({}, { optionalDependencies: { '@pixi/react-core': '>=8.1.0' } })), /optionalDependencies\.@pixi\/react-core is >=8\.1\.0/);
    assert.match(problemsFor(manifest({}, { peerDependencies: { '@pixi/react-core': '8.1.0' } })), /@pixi\/react-core is a peer; it must be an exact dependency/);
    // The tarball's own version must be the release manifest's (the lockstep version).
    assert.match(problemsFor({ ...manifest({ '@pixi/react-core': '8.1.0' }), version: '8.1.1' }), /version 8\.1\.1, the release manifest says 8\.1\.0/);
});

test('the consumer tree check rejects one of our packages at another version', () =>
{
    const dir = mkdtempSync(join(tmpdir(), 'release-lockstep-'));
    const install = (location, name, version) =>
    {
        mkdirSync(join(dir, location), { recursive: true });
        writeFileSync(join(dir, location, 'package.json'), JSON.stringify({ name, version }));
    };

    try
    {
        install('node_modules/@pixi/react-core', '@pixi/react-core', '8.1.0');
        install('node_modules/@pixi/react-renderer', '@pixi/react-renderer', '8.1.0');
        const scenario = { registry: {}, tree: { sameVersion: { names: ['@pixi/react-core', '@pixi/react-renderer', '@pixi/react-19.3'], version: '8.1.0' } } };

        assert.deepEqual(checkTree(scenario, { dependencies: {} }, scanInstalls(dir)).problems, []);
        install('node_modules/@pixi/react-renderer/node_modules/@pixi/react-core', '@pixi/react-core', '8.2.0');
        assert.match(checkTree(scenario, { dependencies: {} }, scanInstalls(dir)).problems.join('\n'), /@pixi\/react-core@8\.2\.0 at node_modules\/@pixi\/react-renderer\/node_modules\/@pixi\/react-core: install all of our packages at the same version \(8\.1\.0\)/);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * What the committed plan must look like in any release state (the required dry-run check runs this on every pull
 * request): before Release 1 (`abi.released` null) every package plans its `release1` version; afterwards either
 * nothing is planned, or the fixed group plans every package at one version.
 */
function committedPlanProblems(result, config)
{
    const planned = Object.fromEntries(result.plan.map((release) => [release.name, release.newVersion]));
    const names = config.packages.map((pkg) => pkg.workspaceName);
    const problems = [];

    if (config.releasedAbi === null)
    {
        for (const pkg of config.packages) if (planned[pkg.workspaceName] !== pkg.release1) problems.push(`Release 1: ${pkg.workspaceName} plans ${planned[pkg.workspaceName] ?? 'nothing'}, expected ${pkg.release1}`);
    }
    else if (result.plan.length)
    {
        for (const name of names) if (planned[name] !== result.version) problems.push(`${name} plans ${planned[name] ?? 'nothing'}, the lockstep release is ${result.version}`);
    }
    for (const name of Object.keys(planned)) if (!names.includes(name)) problems.push(`${name} is not a publishable package but is in the plan`);

    return problems;
}

test('the committed release plan satisfies the policy, in lockstep (Release 1: every package 8.1.0)', () =>
{
    // currentPlan: `changeset status`, or an empty plan on an already-versioned release commit.
    const { state, plan: committed } = currentPlan();
    const result = checkPolicy({ plan: committed, state });

    assert.deepEqual(result.problems, []);
    assert.deepEqual(committedPlanProblems(result, target), []);
    if (target.releasedAbi === null) assert.ok(target.packages.every((pkg) => pkg.release1 === '8.1.0'), 'release.packages.json: Release 1 is 8.1.0 for every package');
});

test('an already-versioned release commit is recognized from the versions on main (classifyReleaseState)', () =>
{
    const names = target.packages.map((pkg) => pkg.workspaceName);
    const at = (version, overrides = {}) => ({ ...Object.fromEntries(names.map((name) => [name, version])), ...overrides });
    const release1Base = at('0.0.0', { '@pixi/react': '8.0.5' });

    assert.equal(compareVersions('8.1.0', '8.0.5'), 1);
    assert.equal(compareVersions('8.10.0', '8.9.1'), 1);
    assert.equal(compareVersions('8.1.0', '8.1.0'), 0);
    // Release 1 versioned (facade 8.0.5 and modules 0.0.0 on main), and a later patch release (8.1.0 -> 8.1.1).
    const clean = { commit: 'v'.repeat(40), merges: [], changed: [] };

    assert.deepEqual(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.0'), baseVersions: release1Base, afterVersion: clean }), { versioned: true, version: '8.1.0', reasons: [], blocked: [] });
    assert.deepEqual(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1'), baseVersions: at('8.1.0'), afterVersion: clean }), { versioned: true, version: '8.1.1', reasons: [], blocked: [] });
    // Bumped, but something that ships changed after the version commit, a branch was merged after it, or no
    // version commit was found: blocked, never treated as the release.
    const changed = classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1'), baseVersions: at('8.1.0'), afterVersion: { ...clean, changed: ['packages/core/src/abi.ts'] } });

    assert.equal(changed.versioned, false);
    assert.match(changed.blocked.join(), /published packages changed after the version commit vvvvvvvvvvvv: packages\/core\/src\/abi\.ts; land the change on main with a changeset, then cut a new release branch from main and run pnpm release:version there/);
    assert.match(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1'), baseVersions: at('8.1.0'), afterVersion: { ...clean, merges: ['m'.repeat(40)] } }).blocked.join(), /mmmmmmmmmmmm merged another branch into the release branch after the version commit .*; cut a new release branch from main and run pnpm release:version there/);
    assert.match(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1'), baseVersions: at('8.1.0') }).blocked.join(), /no commit since the merge base moved them there/);
    // A pull request that changed packages without a changeset and without versioning: not versioned, so
    // `changeset status` runs and fails it.
    const unbumped = classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.0'), baseVersions: at('8.1.0') });

    assert.equal(unbumped.versioned, false);
    assert.deepEqual(unbumped.blocked, [], 'an ordinary checkout is not blocked: changeset status decides');
    assert.match(unbumped.reasons.join('\n'), /@pixi\/react is 8\.1\.0, not above its 8\.1\.0 on main/);
    // One package left behind, pending changesets, or no main to compare with: not versioned.
    assert.match(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1', { '@pixi-react-provisional/core': '8.1.0' }), baseVersions: at('8.1.0') }).reasons.join(), /core is 8\.1\.0, not above its 8\.1\.0/);
    // Pending changesets on a bumped branch (main's next change in a pull request's merge commit) block it.
    const pendingAfter = classifyReleaseState({ pendingChangesets: ['fix.md'], currentVersions: at('8.1.1'), baseVersions: at('8.1.0'), afterVersion: clean });

    assert.equal(pendingAfter.versioned, false);
    assert.match(pendingAfter.blocked.join(), /changesets are pending \(fix\.md\) on top of the version commit/);
    // Pending changesets on an unbumped branch are an ordinary checkout.
    assert.deepEqual(classifyReleaseState({ pendingChangesets: ['fix.md'], currentVersions: at('8.1.0'), baseVersions: at('8.1.0') }).blocked, []);
    assert.match(classifyReleaseState({ pendingChangesets: [], currentVersions: at('8.1.1'), baseVersions: null }).reasons.join(), /no merge base with main/);
});

test('publishedInputs covers what ships and leaves docs, CI and changelogs editable after the version commit', () =>
{
    const shipped = publishedInputs(target);

    for (const path of ['.nvmrc', 'packages/core/src/abi.ts', 'packages/react-18/README.md', 'packages/react-18/package.json', 'packages/react-shared/src/react-19/adapter.ts', 'scripts/build-react-adapter.mjs', 'scripts/release/stage.mjs', 'release.packages.json', 'pnpm-lock.yaml', 'package.json'])
    {
        assert.ok(shipped(path), path);
    }
    for (const path of ['packages/core/CHANGELOG.md', 'packages/react/CHANGELOG.md', 'design/release.md', 'apps/docs/docs/getting-started.mdx', '.github/workflows/release-dry-run.yml', 'packages/conformance/src/index.ts', 'apps/examples/package.json'])
    {
        assert.ok(!shipped(path), path);
    }
});

test('releaseState reads the versions on main from git and accepts only the versioning result itself', () =>
{
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, stdio: 'ignore' });
    const write = (path, text) =>
    {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    const setVersions = (version) =>
    {
        for (const pkg of target.packages) write(`${pkg.dir}/package.json`, JSON.stringify({ name: pkg.workspaceName, version }));
    };
    const state = () => releaseState(root, { config: target });

    try
    {
        write('.changeset/README.md', '');
        write('packages/core/src/index.ts', 'export {};\n');
        write('design/notes.md', 'notes\n');
        setVersions('8.1.0');
        gitIn('init', '-q', '-b', 'main');
        gitIn('add', '-A');
        gitIn('commit', '-q', '-m', 'main');
        gitIn('checkout', '-q', '-b', 'release');
        assert.equal(state().versioned, false, 'nothing bumped yet');
        assert.deepEqual(state().blocked, []);
        // The version commit alone is the release.
        setVersions('8.1.1');
        write('packages/core/CHANGELOG.md', '# core\n\n## 8.1.1\n');
        gitIn('add', '-A');
        gitIn('commit', '-q', '-m', 'Version packages');
        const versionCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

        assert.deepEqual({ ...state(), base: null }, { versioned: true, version: '8.1.1', reasons: [], blocked: [], base: null, versionCommit });
        // Docs, CI and a changelog wording fix after it are fine.
        write('design/notes.md', 'more notes\n');
        write('packages/core/CHANGELOG.md', '# core\n\n## 8.1.1\n\nReworded.\n');
        gitIn('commit', '-q', '-am', 'docs after the version commit');
        assert.equal(state().versioned, true);
        // A source change after it, committed or not, is blocked.
        write('packages/core/src/index.ts', 'export const late = 1;\n');
        assert.match(state().blocked.join(), /published packages changed after the version commit .*: packages\/core\/src\/index\.ts/, 'uncommitted');
        gitIn('commit', '-q', '-am', 'late source change');
        assert.equal(state().versioned, false);
        assert.match(state().blocked.join(), /packages\/core\/src\/index\.ts; land the change on main with a changeset, then cut a new release branch from main/);
        assert.throws(() => currentPlan(root, { config: target }), /not the versioning result itself/);
        gitIn('reset', '-q', '--hard', 'HEAD~1');
        // Merging main into the release branch after the version commit is blocked (rule: re-version on top of it),
        // even when main only changed docs.
        gitIn('checkout', '-q', 'main');
        write('design/main.md', 'main moved\n');
        gitIn('add', '-A');
        gitIn('commit', '-q', '-m', 'main moves on');
        gitIn('checkout', '-q', 'release');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'main');
        assert.match(state().blocked.join(), /merged another branch into the release branch after the version commit/);
        // The documented recovery: a fresh release branch from main is an ordinary checkout (nothing blocked), ready for
        // `pnpm release:version`.
        gitIn('checkout', '-q', '-b', 'release-again', 'main');
        assert.equal(state().versioned, false, 'a fresh release branch from main');
        assert.deepEqual(state().blocked, []);
        gitIn('checkout', '-q', 'release');
        gitIn('reset', '-q', '--hard', 'HEAD~1');
        // The merge commit CI checks out for the pull request (main first, the release branch second) is the release.
        gitIn('checkout', '-q', '--detach', 'main');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'release');
        assert.equal(state().versioned, true, 'a pull request merge commit');
        assert.equal(state().versionCommit, versionCommit);
        // ...but not when main's side of that merge changed a published input the versioning never saw.
        gitIn('checkout', '-q', 'main');
        write('scripts/build-react-adapter.mjs', '// changed on main after the release branch was versioned\n');
        gitIn('add', '-A');
        gitIn('commit', '-q', '-m', 'main changes a published input');
        gitIn('checkout', '-q', '--detach', 'main');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'release');
        assert.match(state().blocked.join(), /published packages changed after the version commit .*scripts\/build-react-adapter\.mjs/, 'main side of a pull request merge');
        gitIn('checkout', '-q', 'main');
        gitIn('reset', '-q', '--hard', 'HEAD~1');
        gitIn('checkout', '-q', '--detach', 'main');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'release');
        gitIn('checkout', '-q', 'main');
        // main gains a change with its changeset after the versioning: its pull request merge commit is blocked.
        write('.changeset/next.md', '---\n"@pixi-react-provisional/core": patch\n---\n\nNext.\n');
        write('packages/core/src/next.ts', 'export {};\n');
        gitIn('add', '-A');
        gitIn('commit', '-q', '-m', 'main gains a change and its changeset');
        gitIn('checkout', '-q', '--detach', 'main');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'release');
        assert.match(state().blocked.join(), /changesets are pending \(next\.md\) on top of the version commit/, 'pending changeset from main');
        gitIn('checkout', '-q', 'main');
        gitIn('reset', '-q', '--hard', 'HEAD~1');
        gitIn('checkout', '-q', '--detach', 'main');
        gitIn('merge', '-q', '--no-ff', '--no-edit', 'release');
        // A staged-only edit after the version commit is caught too (git diff HEAD includes the index).
        write('packages/core/src/index.ts', 'export const staged = 1;\n');
        gitIn('add', 'packages/core/src/index.ts');
        assert.match(state().blocked.join(), /packages\/core\/src\/index\.ts/, 'staged only');
        gitIn('reset', '-q', '--hard');
        // On main itself after the release merged, nothing is above main, so `changeset status` runs.
        gitIn('checkout', '-q', 'main');
        gitIn('merge', '-q', '--no-edit', 'release');
        assert.equal(state().versioned, false);
        assert.deepEqual(state().blocked, []);
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test('Changesets versions the publishable packages as one fixed group', () =>
{
    const config = JSON.parse(readFileSync(join(repoRoot, '.changeset/config.json'), 'utf8'));

    assert.deepEqual(config.fixed.map((group) => [...group].sort()), [target.packages.map((pkg) => pkg.workspaceName).sort()]);
    assert.deepEqual(config.linked, []);
    for (const pkg of target.packages.filter((item) => !item.facade))
    {
        const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, 'package.json'), 'utf8'));

        for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) if (target.byWorkspaceName.has(name)) assert.equal(spec, 'workspace:*', `${pkg.workspaceName} -> ${name}`);
    }
});

/** A synthetic plan over the real workspace: each entry `name: [type, newVersion, explicit?]`. */
function plan(entries, summary = 'synthetic')
{
    const releases = Object.entries(entries).map(([name, [type, newVersion]]) => ({ name, type, newVersion, oldVersion: '8.1.0', changesets: [] }));
    const explicit = Object.entries(entries).filter(([, [, , isExplicit]]) => isExplicit !== false).map(([name, [type]]) => ({ name, type }));

    return { changesets: [{ id: 'synthetic', summary, releases: explicit }], releases };
}

const group = target.packages.map((pkg) => pkg.workspaceName);
/** Every lockstep package at `type` -> `version`, the facade explicit and the others carried by the fixed group. */
const lockstepPlan = (type, version, summary) => plan(Object.fromEntries(group.map((name) => [name, [type, version, name === '@pixi/react']])), summary);
const releasedNow = () => ({ ...target, releasedAbi: readAbiDeclarations() });

test('the committed-plan expectations hold before Release 1, with an empty plan, and for a later lockstep plan', () =>
{
    const released = { ...target, releasedAbi: readAbiDeclarations() };
    const unreleased = { ...target, releasedAbi: null };
    const result = (version, entries) => ({ version, plan: entries.map(([name, newVersion]) => ({ name, newVersion })) });
    const all = (version) => group.map((name) => [name, version]);

    // Unreleased: Release 1 must be planned.
    assert.deepEqual(committedPlanProblems(result('8.1.0', all('8.1.0')), unreleased), []);
    assert.match(committedPlanProblems(result('8.0.5', []), unreleased).join('\n'), /Release 1: @pixi\/react plans nothing, expected 8\.1\.0/);
    // After a release, no pending changesets is valid: every pull request without one, and main after the release.
    assert.deepEqual(committedPlanProblems(result('8.1.0', []), released), []);
    // A later release moves every package to one version.
    assert.deepEqual(committedPlanProblems(result('8.1.1', all('8.1.1')), released), []);
    assert.deepEqual(committedPlanProblems(result('8.2.0', all('8.2.0')), released), []);
    assert.match(committedPlanProblems(result('8.2.0', [...all('8.2.0').slice(1), ['docs', '0.0.1']]), released).join('\n'), /@pixi\/react plans nothing, the lockstep release is 8\.2\.0\n.*docs is not a publishable package/);
    // The policy accepts the same later plans once something is released.
    for (const [type, version] of [['patch', '8.1.1'], ['minor', '8.2.0']]) assert.deepEqual(checkPolicy({ config: released, plan: lockstepPlan(type, version) }).problems, []);
});

test('policy: a package off the lockstep version fails (negative)', () =>
{
    const config = releasedNow();

    assert.deepEqual(checkPolicy({ config, plan: lockstepPlan('patch', '8.1.1') }).problems, []);
    const entries = Object.fromEntries(group.map((name) => [name, ['patch', '8.1.1']]));

    entries['@pixi-react-provisional/core'] = ['major', '9.0.0'];
    entries['@pixi-react-provisional/react-18'] = ['none', '8.1.0'];
    const problems = checkPolicy({ config, plan: plan(entries) }).problems.join('\n');

    assert.match(problems, /lockstep: every publishable package must release at the facade's version 8\.1\.1, but @pixi-react-provisional\/core 9\.0\.0, @pixi-react-provisional\/react-18 8\.1\.0/);
    // One version, but not the Pixi major of the facade's pixi.js peer.
    assert.match(checkPolicy({ config, plan: lockstepPlan('major', '9.0.0') }).problems.join('\n'), /lockstep: the packages would release 9\.0\.0, but their major must equal the Pixi major of the facade's pixi\.js peer \(8\)/);
});

test('an ABI change needs at least a minor lockstep release and an "ABI" note in a changeset', () =>
{
    const current = readAbiDeclarations();
    const [adapterFile] = Object.keys(current.adapters);
    const coreMinor = { ...target, releasedAbi: { ...current, core: { major: current.core.major, minor: current.core.minor - 1 } } };
    const adapterMinor = { ...target, releasedAbi: { ...current, adapters: { ...current.adapters, [adapterFile]: current.adapters[adapterFile].map((abi) => ({ ...abi, minor: abi.minor + 1 })) } } };

    assert.deepEqual(abiChanges(current, current), []);
    assert.match(abiChanges(coreMinor.releasedAbi, current).join(), /CORE_ABI 1\.-1 -> 1\.0/);
    assert.match(abiChanges(adapterMinor.releasedAbi, current).join(), new RegExp(`${adapterFile.replace(/[.]/g, '\\.')} ABI 1\\.1 -> 1\\.0`));
    for (const config of [coreMinor, adapterMinor])
    {
        const patch = checkPolicy({ config, plan: lockstepPlan('patch', '8.1.1', 'Fix the ABI handshake') }).problems.join('\n');

        assert.match(patch, /the adapter ABI changed since the last release \(.+\): the lockstep packages need at least a minor changeset/);
        const unnoted = checkPolicy({ config, plan: lockstepPlan('minor', '8.2.0', 'New capability') }).problems.join('\n');

        assert.doesNotMatch(unnoted, /need at least a minor changeset/);
        assert.match(unnoted, /a changeset of at least minor level must document it in its summary \(mention "ABI"\)/);
        assert.deepEqual(checkPolicy({ config, plan: lockstepPlan('minor', '8.2.0', 'ABI 1.1: adapters may require the new capability; mixing versions fails with ABI_MISMATCH') }).problems, []);
    }
    // No ABI change: a patch needs no note.
    assert.deepEqual(checkPolicy({ config: releasedNow(), plan: lockstepPlan('patch', '8.1.1') }).problems, []);
    // CORE_ABI's minor may not fall within a major, whatever the release.
    const fell = { ...target, releasedAbi: { ...current, core: { major: current.core.major, minor: current.core.minor + 1 } } };

    assert.match(checkPolicy({ config: fell, plan: lockstepPlan('minor', '8.2.0', 'ABI change') }).problems.join('\n'), /CORE_ABI minor fell from 1 to 0/);
    // The old one-number shape is rejected rather than misread.
    assert.match(checkPolicy({ config: { ...target, releasedAbi: { major: 1, minor: 0 } }, plan: lockstepPlan('patch', '8.1.1') }).problems.join('\n'), /abi\.released must be \{ core/);
});

test('an adapter may not declare an ABI minor newer than CORE_ABI (core would reject it at runtime)', () =>
{
    const current = readAbiDeclarations();
    const [file] = Object.keys(current.adapters);
    const withAdapter = (abi) => ({ ...current, adapters: { ...current.adapters, [file]: [abi] } });

    assert.deepEqual(abiDeclarationProblems(current), []);
    assert.deepEqual(abiDeclarationProblems(withAdapter({ ...current.core })), []);
    assert.deepEqual(abiDeclarationProblems({ ...withAdapter({ major: 1, minor: 0 }), core: { major: 1, minor: 2 } }), [], 'an adapter on an older ABI minor is accepted');
    assert.match(abiDeclarationProblems(withAdapter({ major: current.core.major, minor: current.core.minor + 1 })).join(), /declares ABI 1\.1, but core implements only 1\.0: core would reject the adapter \(ABI_MISMATCH\)/);
    assert.match(abiDeclarationProblems(withAdapter({ major: current.core.major + 1, minor: 0 })).join(), /declares ABI major 2, core implements 1/);
});

test('Release 1 must reach exactly the configured versions', () =>
{
    // Explicitly unreleased, so the test still holds after Release 1 is versioned.
    const problems = checkPolicy({ config: { ...target, releasedAbi: null }, plan: plan({ '@pixi/react': ['major', '9.0.0'], '@pixi-react-provisional/core': ['minor', '8.1.0'], '@pixi-react-provisional/renderer': ['patch', '8.0.6'] }) }).problems.join('\n');

    assert.match(problems, /Release 1: @pixi\/react would release 9\.0\.0, expected 8\.1\.0/);
    assert.match(problems, /Release 1: @pixi-react-provisional\/renderer would release 8\.0\.6, expected 8\.1\.0/);
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

test('release scripts refuse output directories they must not wipe', () =>
{
    const dir = mkdtempSync(join(tmpdir(), 'release-output-'));
    const source = join(dir, 'source');
    const stray = join(dir, 'stray');
    const previous = join(dir, 'previous');

    try
    {
        mkdirSync(join(source, 'scripts'), { recursive: true });
        mkdirSync(join(source, '.release', 'tarballs'), { recursive: true });
        writeFileSync(join(source, '.release', 'tarballs', 'old.tgz'), '');
        mkdirSync(stray);
        writeFileSync(join(stray, 'notes.txt'), 'keep');
        resetOutputDir(previous);
        writeFileSync(join(previous, 'old.txt'), '');

        for (const options of [{ root: source }, { root: source, insideRelease: true }])
        {
            assert.match(outputDirProblem(source, options), /contains the source checkout/);
            assert.match(outputDirProblem(dir, options), /contains the source checkout/);
            assert.match(outputDirProblem(join(source, 'scripts'), options), /inside the source checkout/);
            assert.match(outputDirProblem(join(source, 'new'), options), /inside the source checkout/);
            assert.match(outputDirProblem(join(source, '.release'), options), /inside the source checkout/);
            assert.match(outputDirProblem(stray, options), /not empty and was not created by a release script/);
            assert.equal(outputDirProblem(previous, options), null);
            assert.equal(outputDirProblem(join(dir, 'fresh'), options), null);
            assert.equal(outputDirProblem(join(dir, 'source-sibling'), options), null);
        }
        // Inside the checkout, only .release/ subdirectories, and an existing one still needs the marker.
        assert.match(outputDirProblem(join(source, '.release', 'fresh'), { root: source }), /inside the source checkout/);
        assert.equal(outputDirProblem(join(source, '.release', 'fresh'), { root: source, insideRelease: true }), null);
        assert.match(outputDirProblem(join(source, '.release', 'tarballs'), { root: source, insideRelease: true }), /no \.pixi-react-release-output/);
        assert.match(outputDirProblem(repoRoot), /contains the source checkout/);

        assert.throws(() => resetOutputDir(stray), /refusing to wipe/);
        assert.equal(readFileSync(join(stray, 'notes.txt'), 'utf8'), 'keep');
        resetOutputDir(previous);
        assert.deepEqual(readdirSync(previous), [OUTPUT_MARKER]);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('bundles keep no more Pixi code than upstream 8.0.5, and no Pixi tree-shaking gap is excused (issue 57)', () =>
{
    const upstream = { pixiModules: 381, pixiBytes: 513000 };

    assert.deepEqual(UPSTREAM_BASELINE, { name: '@pixi/react', version: '8.0.5' });
    assert.deepEqual(KNOWN_GAPS, {}, 'no fixture may keep an unused Pixi constructor');
    assert.deepEqual(compareWithUpstream({ pixiModules: 381, pixiBytes: 513000 }, upstream), [], 'equal is within the bound');
    assert.deepEqual(compareWithUpstream({ pixiModules: 146, pixiBytes: 200000 }, upstream), []);
    assert.equal(compareWithUpstream({ pixiModules: 633, pixiBytes: 513000 }, upstream).length, 1, 'more modules');
    assert.equal(compareWithUpstream({ pixiModules: 381, pixiBytes: 513001 }, upstream).length, 1, 'more bytes');
});

test('mainMergeBase uses the more recent of main and origin/main, so a stale local main does not mislead', () =>
{
    const root = mkdtempSync(join(tmpdir(), 'merge-base-'));
    const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    try
    {
        gitIn('init', '-q', '-b', 'main');
        gitIn('commit', '-q', '--allow-empty', '-m', 'old');
        const old = gitIn('rev-parse', 'HEAD');

        gitIn('commit', '-q', '--allow-empty', '-m', 'new');
        const fresh = gitIn('rev-parse', 'HEAD');

        gitIn('update-ref', 'refs/remotes/origin/main', fresh);
        gitIn('checkout', '-q', '-b', 'feature');
        gitIn('commit', '-q', '--allow-empty', '-m', 'feature');
        gitIn('branch', '-f', 'main', old);
        assert.equal(mainMergeBase(root), fresh, 'stale local main');
        gitIn('branch', '-f', 'main', fresh);
        gitIn('update-ref', 'refs/remotes/origin/main', old);
        assert.equal(mainMergeBase(root), fresh, 'stale origin/main');
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});
