#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Packed-consumer checks for the staged release tarballs (issue 15). Each scenario is a clean npm project created
 * outside the repository (`$PIXI_REACT_RELEASE_CONSUMERS`, default `<os tmpdir>/pixi-react-release-consumers`) that
 * installs only staged tarballs plus exact registry versions, with `npm install --ignore-scripts --strict-peer-deps`:
 * no lifecycle script runs, no workspace or alias is reachable, and a missing or conflicting peer fails the install.
 *
 * Scenarios (derived, not listed by hand):
 * - `facade`: the default `@pixi/react` with React 19.3 and the newest certified pixi.js. No modular package may be
 *   installed with it.
 * - `explicit-<cell>`: one per PR-tier compatibility cell of the #13 manifest (design/compatibility/seed.json): core,
 *   renderer, that cell's React adapter and the Pixi adapter, with the cell's exact React, types and pixi.js. Only
 *   that cell's reconciler and bridge may be installed; a React 18 consumer gets no React 19 package of any kind.
 * - `renderer-only` and `core-only`: the neutral factory and core install no React, no reconciler and no pixi.js.
 *
 * Each scenario runs `npm ls --all` (must be clean), the tree expectations (pinned packages counted as physical copies), `consumer/check-modules.mjs` (import and
 * require, adapter manifests, composition and registration), `consumer/check-declarations.cjs` (NodeNext import and
 * require declarations, runtime/declaration parity) and `tsc` over the scenario's `.mts` and `.cts` programs.
 *
 * Usage: node scripts/release/consumers.mjs [--tarballs <dir>] [--only <scenario>]... [--skip-install] [--list]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeed, selectCells } from '../../design/compatibility/cells/matrix.mjs';
import { loadReleaseConfig, repoRoot } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Exact versions of the consumer toolchain. esbuild matches the workspace's (scripts/build-react-adapter.mjs). */
export const TOOLCHAIN = { esbuild: '0.21.5' };

/** The newest certified React 19 line the facade composes (D1) and its types. */
const FACADE_REACT = { react: '19.3.0', 'react-dom': '19.3.0', '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@types/react-reconciler': '0.28.9' };

function readCoreAbi(root)
{
    const source = readFileSync(join(root, 'packages/core/src/abi.ts'), 'utf8');
    const match = source.match(/CORE_ABI = Object\.freeze\(\{ major: (\d+), minor: (\d+) \}/);

    if (!match) throw new Error('CORE_ABI not found in packages/core/src/abi.ts');

    return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Every consumer scenario for the staged tarballs in `manifest` (release-manifest.json). */
export function scenarios(manifest, { root = repoRoot } = {})
{
    const config = loadReleaseConfig({ root, namespace: manifest.namespace });
    const seed = loadSeed();
    const matrix = seed.adapterMatrix;
    const staged = (dir) =>
    {
        const entry = manifest.packages.find((item) => item.dir === dir);

        if (!entry) throw new Error(`no staged tarball for ${dir}`);

        return entry;
    };
    const publicOfArtifact = (artifact) => staged(matrix.artifacts[artifact].dir);
    const core = staged('packages/core');
    const renderer = staged('packages/renderer');
    const facade = staged('packages/react');
    const pixiAdapter = matrix.pixiAdapters.pixi8;
    const pixi = publicOfArtifact(pixiAdapter.artifact);
    const abi = readCoreAbi(root);
    const reactAdapterPackages = Object.values(matrix.reactAdapters).map((adapter) => publicOfArtifact(adapter.artifact).publicName);
    const ours = config.packages.map((pkg) => manifest.packages.find((item) => item.dir === pkg.dir).publicName);
    const currentPixi = seed.pixiEpochs.find((epoch) => epoch.id === 'pixi8').current;
    const list = [];

    list.push({
        id: 'facade',
        install: [facade],
        registry: { ...FACADE_REACT, 'pixi.js': currentPixi, typescript: matrix.toolchain.typescript, esbuild: TOOLCHAIN.esbuild },
        tree: { exactly: { [facade.publicName]: facade.version, 'react-reconciler': '0.34.0', react: '19.3.0', 'pixi.js': currentPixi }, absent: ours.filter((name) => name !== facade.publicName) },
        modules: { loadOnly: [facade.publicName], expectExports: { [facade.publicName]: ['Application', 'applyProps', 'createRoot', 'extend', 'useApplication', 'useExtend', 'useTick'] }, facade: facade.publicName },
        declarations: [facade.publicName],
        runtimeEntries: [facade.publicName],
        program: 'facade',
        programValues: { FACADE: facade.publicName },
        bundle: 'facade',
    });
    for (const cell of selectCells(seed, 'pr'))
    {
        const adapter = cell.react.adapter;
        const reactPackage = publicOfArtifact(adapter.artifact);
        const tuple = cell.react.tuple.packages;
        const otherReconcilers = seed.reactEpochs.map((epoch) => epoch.reconciler).filter((version) => version && version !== cell.react.reconciler);
        const isReact18 = cell.react.version.startsWith('18.');

        list.push({
            id: `explicit-${cell.id}`,
            cell: cell.id,
            install: [core, renderer, reactPackage, pixi],
            registry: {
                react: cell.react.version,
                'react-dom': cell.react.version,
                '@types/react': tuple['@types/react'],
                '@types/react-dom': adapter.typesReactDom,
                'pixi.js': cell.pixi.version,
                typescript: matrix.toolchain.typescript,
                ...(cell.pixi.version === currentPixi && (isReact18 || adapter.artifact === 'react-19.3') ? { esbuild: TOOLCHAIN.esbuild } : {}),
            },
            tree: {
                exactly: {
                    [core.publicName]: core.version,
                    [renderer.publicName]: renderer.version,
                    [reactPackage.publicName]: reactPackage.version,
                    [pixi.publicName]: pixi.version,
                    'react-reconciler': tuple['react-reconciler'],
                    'its-fine': tuple['its-fine'],
                    react: cell.react.version,
                    'pixi.js': cell.pixi.version,
                },
                absent: [facade.publicName, ...reactAdapterPackages.filter((name) => name !== reactPackage.publicName)],
                forbiddenVersions: { 'react-reconciler': otherReconcilers, ...(isReact18 ? { react: ['^19'], 'react-dom': ['^19'] } : {}) },
            },
            modules: {
                loadOnly: [core.publicName, renderer.publicName, reactPackage.publicName, pixi.publicName],
                compose: {
                    renderer: renderer.publicName,
                    react: { spec: reactPackage.publicName, className: adapter.className, adapterId: adapter.adapterId, version: reactPackage.version },
                    pixi: { spec: pixi.publicName, className: pixiAdapter.className, adapterId: pixiAdapter.adapterId, version: pixi.version },
                },
            },
            declarations: [core.publicName, renderer.publicName, reactPackage.publicName, pixi.publicName, `${pixi.publicName}/jsx`, `${pixi.publicName}/jsx/${isReact18 ? 'react-18' : 'react-19'}`],
            runtimeEntries: [core.publicName, renderer.publicName, reactPackage.publicName, pixi.publicName],
            program: 'explicit',
            programValues: { RENDERER: renderer.publicName, REACT: reactPackage.publicName, CLASS: adapter.className, PIXI: pixi.publicName },
            bundleValues: { RENDERER: renderer.publicName, REACT: reactPackage.publicName, CLASS: adapter.className, PIXI: pixi.publicName, REACT_ID: adapter.adapterId },
            abiMajor: abi.major,
        });
    }
    list.push({
        id: 'renderer-only',
        install: [core, renderer],
        registry: { typescript: matrix.toolchain.typescript, esbuild: TOOLCHAIN.esbuild },
        tree: { exactly: { [core.publicName]: core.version, [renderer.publicName]: renderer.version }, absent: ['react', 'react-dom', 'react-reconciler', 'its-fine', 'pixi.js', ...ours.filter((name) => name !== core.publicName && name !== renderer.publicName)] },
        modules: { loadOnly: [core.publicName, renderer.publicName], expectExports: { [renderer.publicName]: ['createRenderer'] } },
        declarations: [core.publicName, renderer.publicName],
        runtimeEntries: [core.publicName, renderer.publicName],
        program: 'renderer',
        programValues: { RENDERER: renderer.publicName },
        bundle: 'renderer',
        bundleValues: { RENDERER: renderer.publicName },
    });
    list.push({
        id: 'core-only',
        install: [core],
        registry: { typescript: matrix.toolchain.typescript },
        tree: { exactly: { [core.publicName]: core.version }, absent: ['react', 'react-reconciler', 'pixi.js', ...ours.filter((name) => name !== core.publicName)], onlyDirect: true },
        modules: { loadOnly: [core.publicName], expectExports: { [core.publicName]: ['CORE_ABI', 'CompatibilityError', 'PixiAdapter', 'ReactAdapter', 'compose'] } },
        declarations: [core.publicName],
        runtimeEntries: [core.publicName],
        program: 'core',
        programValues: { CORE: core.publicName, ABI_MAJOR: String(abi.major) },
    });

    // The explicit bundle scenarios: React 19.3 and React 18 with the newest certified pixi.js.
    for (const item of list)
    {
        if (item.program === 'explicit') item.bundle = item.registry.esbuild ? 'explicit' : null;
        if (!item.bundle) delete item.registry.esbuild;
    }

    return list;
}

function run(command, args, options = {})
{
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...options });
}

function assertNoAncestorNodeModules(dir)
{
    for (let current = dirname(dir); current !== dirname(current); current = dirname(current))
    {
        if (existsSync(join(current, 'node_modules'))) throw new Error(`${current}/node_modules is reachable from ${dir}; set PIXI_REACT_RELEASE_CONSUMERS to a clean location`);
    }
}

/** Every installed package node of `npm ls --all --json`: `[{ name, version, path }]`. */
function flattenTree(node, out = [], trail = [])
{
    for (const [name, child] of Object.entries(node.dependencies ?? {}))
    {
        out.push({ name, version: child.version, path: [...trail, name].join(' > '), missing: child.missing, invalid: child.invalid });
        flattenTree(child, out, [...trail, name]);
    }

    return out;
}

/**
 * Every physical copy under `<dir>/node_modules`, nested `node_modules` included: `{ [name]: [{ location, version }] }`.
 * `npm ls` reports the logical tree, which can show one version for two physical copies; two copies of core mean two
 * registries, so the `exactly` expectations are checked against this instead.
 */
export function scanInstalls(dir)
{
    const installs = {};
    const visit = (modules) =>
    {
        if (!existsSync(modules)) return;
        for (const entry of readdirSync(modules, { withFileTypes: true }))
        {
            if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
            const packageDirs = entry.name.startsWith('@')
                ? readdirSync(join(modules, entry.name), { withFileTypes: true }).filter((child) => child.isDirectory()).map((child) => join(modules, entry.name, child.name))
                : [join(modules, entry.name)];

            for (const packageDir of packageDirs)
            {
                const manifestPath = join(packageDir, 'package.json');

                if (existsSync(manifestPath))
                {
                    const { name, version } = JSON.parse(readFileSync(manifestPath, 'utf8'));

                    (installs[name] ??= []).push({ location: relative(dir, packageDir), version });
                }
                visit(join(packageDir, 'node_modules'));
            }
        }
    };

    visit(join(dir, 'node_modules'));
    for (const copies of Object.values(installs)) copies.sort((a, b) => a.location.localeCompare(b.location));

    return installs;
}

function satisfiesCaretMajor(version, range)
{
    // Only the forms used above: `^<major>` and exact versions.
    if (range.startsWith('^')) return version.split('.')[0] === range.slice(1).split('.')[0];

    return version === range;
}

/** `tree` is `npm ls --all --json`; `installs` is `scanInstalls(dir)`, the physical copies. */
export function checkTree(scenario, tree, installs)
{
    const problems = [];
    const nodes = flattenTree(tree);
    const copiesOf = (name) => installs[name] ?? [];
    const versionsOf = (name) => [...new Set([...nodes.filter((node) => node.name === name), ...copiesOf(name)].map((node) => node.version))];

    for (const node of nodes) if (node.missing || node.invalid) problems.push(`npm ls: ${node.path} is ${node.missing ? 'missing' : 'invalid'}`);
    for (const [name, version] of Object.entries(scenario.tree.exactly ?? {}))
    {
        const copies = copiesOf(name);

        if (copies.length !== 1 || copies[0].version !== version)
        {
            problems.push(`${name}: installed ${copies.map((copy) => `${copy.version} at ${copy.location}`).join(', ') || 'nothing'}, expected exactly ${version} once`);
        }
    }
    for (const name of scenario.tree.absent ?? []) if (versionsOf(name).length) problems.push(`${name} is installed (${versionsOf(name).join(', ')}); this consumer must not get it`);
    for (const [name, ranges] of Object.entries(scenario.tree.forbiddenVersions ?? {}))
    {
        for (const version of versionsOf(name)) if (ranges.some((range) => satisfiesCaretMajor(version, range))) problems.push(`${name}@${version} is installed; this consumer must not get it`);
    }
    if (scenario.tree.onlyDirect)
    {
        const extra = nodes.filter((node) => !(node.name in (scenario.tree.exactly ?? {})) && !(node.name in scenario.registry));

        if (extra.length) problems.push(`unexpected transitive packages: ${extra.map((node) => node.path).join(', ')}`);
    }

    return { problems, packages: nodes.length };
}

const fill = (text, values) => Object.entries(values ?? {}).reduce((result, [key, value]) => result.replaceAll(`__${key}__`, value), text);

function writeProject(dir, scenario, tarballDir)
{
    const dependencies = {
        ...Object.fromEntries(scenario.install.map((entry) => [entry.publicName, `file:${join(tarballDir, entry.file)}`])),
        ...scenario.registry,
    };

    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `release-consumer-${scenario.id}`, version: '0.0.0', private: true, type: 'module', dependencies }, null, 2)}\n`);
    writeFileSync(join(dir, 'scenario.json'), `${JSON.stringify({ ...scenario.modules, abiMajor: scenario.abiMajor, declarations: scenario.declarations, runtimeEntries: scenario.runtimeEntries }, null, 2)}\n`);
    cpSync(join(here, 'consumer/check-modules.mjs'), join(dir, 'check-modules.mjs'));
    cpSync(join(here, 'consumer/check-declarations.cjs'), join(dir, 'check-declarations.cjs'));
    for (const extension of ['mts', 'cts'])
    {
        const template = readFileSync(join(here, 'consumer/programs', `${scenario.program}.ts.txt`), 'utf8');

        writeFileSync(join(dir, `program.${extension}`), fill(template, scenario.programValues));
    }
    writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: true, types: [] },
        files: ['program.mts', 'program.cts'],
    }, null, 2)}\n`);
}

/** Creates, installs and checks one scenario. Returns `{ id, ok, steps }`. */
export function runScenario(scenario, { tarballDir, root: consumersRoot, skipInstall = false, log = console.log })
{
    const dir = join(consumersRoot, scenario.id);
    const steps = [];
    const step = (name, fn) =>
    {
        const started = Date.now();

        try
        {
            const detail = fn();

            steps.push({ name, ok: true, seconds: (Date.now() - started) / 1000, detail });
            log(`  ${name}: ok${detail ? ` (${detail})` : ''}`);
        }
        catch (error)
        {
            const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n').trim().slice(0, 6000);

            steps.push({ name, ok: false, seconds: (Date.now() - started) / 1000, detail });
            log(`  ${name}: FAILED\n${detail.replace(/^/gm, '    ')}`);
            throw error;
        }
    };

    log(`${scenario.id}: ${scenario.install.map((entry) => `${entry.publicName}@${entry.version}`).join(', ')} + ${Object.entries(scenario.registry).map(([name, version]) => `${name}@${version}`).join(', ')}`);
    try
    {
        if (!skipInstall)
        {
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
            assertNoAncestorNodeModules(dir);
            writeProject(dir, scenario, tarballDir);
            step('install', () =>
            {
                run('npm', ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir });

                return 'npm install --ignore-scripts --strict-peer-deps';
            });
        }
        step('tree', () =>
        {
            const tree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: dir }));
            const { problems, packages } = checkTree(scenario, tree, scanInstalls(dir));

            if (problems.length) throw new Error(problems.join('\n'));

            return `${packages} packages, npm ls clean, one physical copy of each pinned package`;
        });
        step('modules', () => run(process.execPath, ['check-modules.mjs'], { cwd: dir }).trim().split('\n').slice(1)
            .map((line) => line.trim())
            .join('; '));
        step('declarations', () => run(process.execPath, ['check-declarations.cjs'], { cwd: dir }).trim().split('\n').slice(1)
            .map((line) => line.trim())
            .join('; '));
        step('types', () =>
        {
            run(process.execPath, [join(dir, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: dir });

            return 'tsc NodeNext: program.mts (import) and program.cts (require)';
        });

        return { id: scenario.id, dir, ok: true, steps };
    }
    catch
    {
        return { id: scenario.id, dir, ok: false, steps };
    }
}

export const consumersRoot = () => resolve(process.env.PIXI_REACT_RELEASE_CONSUMERS ?? join(tmpdir(), 'pixi-react-release-consumers'));

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const args = process.argv.slice(2);
    const values = (name) => args.flatMap((arg, index) => (args[index - 1] === name ? [arg] : []));
    const tarballDir = resolve(values('--tarballs')[0] ?? join(repoRoot, '.release', 'tarballs'));
    const manifest = JSON.parse(readFileSync(join(tarballDir, 'release-manifest.json'), 'utf8'));
    const only = values('--only');
    const list = scenarios(manifest).filter((item) => !only.length || only.includes(item.id));

    if (args.includes('--list'))
    {
        for (const item of list) console.log(item.id);
        process.exit(0);
    }
    const results = list.map((item) => runScenario(item, { tarballDir, root: consumersRoot(), skipInstall: args.includes('--skip-install') }));

    writeFileSync(join(tarballDir, 'consumers.json'), `${JSON.stringify(results, null, 2)}\n`);
    const failed = results.filter((item) => !item.ok);

    console.log(`\nconsumers: ${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((item) => item.id).join(', ')}` : ''}`);
    if (failed.length) process.exit(1);
}
