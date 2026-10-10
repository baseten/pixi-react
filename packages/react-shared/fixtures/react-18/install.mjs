#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Installs the PACKED modular packages into the current fixture, the way a consumer's package manager would:
 *
 * 1. `pnpm pack` each built package the fixture composes: core, the version-neutral factory (renderer), the fixture's
 *    React 18 minor package (`packages/react-18.<minor>`, the fixture's grandparent) and the unchanged Pixi 8
 *    adapter. A tarball holds exactly the files a registry would serve, with `workspace:` ranges rewritten to
 *    versions.
 * 2. Extract each tarball into `<fixture>/.installed/node_modules/<name>`. From there the packages resolve each other
 *    (one core instance) and the fixture's own React 18, react-dom 18 and pixi.js installs, never this workspace's
 *    React 19 copies.
 *    Vite's pre-bundle cache is removed too, since it would otherwise keep serving the previous install.
 * 3. Check the resolved React dependency tree: every installed package resolves the fixture's exact React, nothing
 *    resolves a React 19, the only reconciler is the adapter package's exact dependency (its react-reconciler, with
 *    its-fine 1.2.5), and no other installed package declares a reconciler. The tree is written to
 *    `.installed/react-tree.json` and printed.
 *
 * Run from a fixture directory (its `test:*` and `typecheck` scripts do) after the packages are built.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = process.cwd();
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'));
const expectedReact = fixture.devDependencies.react;
/** The React 18 minor package under test: `packages/react-18.<minor>/fixtures/<fixture>` → `packages/react-18.<minor>`. */
const adapterDir = resolve(fixtureDir, '../..');
const adapter = JSON.parse(readFileSync(join(adapterDir, 'package.json'), 'utf8'));
/** The dependencies the adapter package declares, exactly (issue 49); the fixture installs the same versions. */
const ADAPTER_DEPENDENCIES = Object.freeze({
    'react-reconciler': adapter.dependencies['react-reconciler'],
    'its-fine': adapter.dependencies['its-fine'],
});

/** Workspace directory → package name. The order is irrelevant: each is packed and extracted on its own. */
const PACKED = Object.freeze({
    core: '@pixi-react-provisional/core',
    renderer: '@pixi-react-provisional/renderer',
    [basename(adapterDir)]: adapter.name,
    'pixi-8': '@pixi-react-provisional/pixi-8',
});

const installed = join(fixtureDir, '.installed', 'node_modules');
const packed = join(fixtureDir, '.packed');

rmSync(join(fixtureDir, '.installed'), { recursive: true, force: true });
// Vite keys its pre-bundled dependencies on the lockfile and config, not on these files: drop them with the install.
rmSync(join(fixtureDir, 'node_modules', '.vite'), { recursive: true, force: true });
rmSync(packed, { recursive: true, force: true });
mkdirSync(packed, { recursive: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

for (const [dir, name] of Object.entries(PACKED))
{
    const packageDir = join(packagesDir, dir);

    if (!existsSync(join(packageDir, 'dist')))
    {
        throw new Error(`${name} is not built (no ${join(packageDir, 'dist')}); run the build first.`);
    }

    const output = execFileSync(pnpm, ['pack', '--json', '--pack-destination', packed], {
        cwd: packageDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    const { filename } = JSON.parse(output.slice(output.indexOf('{')));
    const target = join(installed, name);

    mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', filename, '-C', target, '--strip-components=1']);
}

/** Resolves `specifier`'s package.json from `fromDir`, as Node would; `null` when it does not resolve. */
function resolvedVersion(fromDir, specifier)
{
    try
    {
        const file = createRequire(join(fromDir, 'noop.js')).resolve(`${specifier}/package.json`);

        return { version: JSON.parse(readFileSync(file, 'utf8')).version, path: file };
    }
    catch
    {
        return null;
    }
}

const tree = { fixture: fixture.name, expectedReact, packages: {} };
const problems = [];

for (const name of Object.values(PACKED))
{
    const dir = join(installed, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const declared = { ...manifest.dependencies, ...manifest.peerDependencies };
    const entry = { version: manifest.version, dependencies: manifest.dependencies ?? {}, peerDependencies: manifest.peerDependencies ?? {} };

    for (const specifier of ['react', 'react-dom', 'react-reconciler', 'scheduler', 'its-fine', '@pixi-react-provisional/core'])
    {
        entry[specifier] = resolvedVersion(dir, specifier);
    }

    for (const forbidden of ['react-reconciler', 'scheduler', 'its-fine', 'react-dom'])
    {
        const allowed = name === adapter.name && forbidden in ADAPTER_DEPENDENCIES;

        if (allowed && manifest.dependencies?.[forbidden] !== ADAPTER_DEPENDENCIES[forbidden])
        {
            problems.push(`${name} declares ${forbidden}@${manifest.dependencies?.[forbidden]}, expected exactly ${ADAPTER_DEPENDENCIES[forbidden]}`);
        }
        else if (allowed && entry[forbidden]?.version !== ADAPTER_DEPENDENCIES[forbidden])
        {
            problems.push(`${name} resolves ${forbidden} ${entry[forbidden]?.version ?? '(none)'}, expected ${ADAPTER_DEPENDENCIES[forbidden]}`);
        }
        else if (!allowed && forbidden in declared)
        {
            problems.push(`${name} declares ${forbidden}`);
        }
    }

    for (const [dependency, range] of Object.entries(declared))
    {
        if ((dependency === 'react' || dependency === 'react-dom') && (/(^|[^\d.])19\./).test(range))
        {
            problems.push(`${name} declares ${dependency}@${range}, a React 19 range`);
        }
    }

    if ('react' in declared && entry.react?.version !== expectedReact)
    {
        problems.push(`${name} resolves react ${entry.react?.version ?? '(none)'}, expected ${expectedReact}`);
    }

    if (name !== PACKED.core && entry['@pixi-react-provisional/core']?.path !== join(installed, PACKED.core, 'package.json'))
    {
        problems.push(`${name} does not resolve the installed core (${entry['@pixi-react-provisional/core']?.path})`);
    }

    tree.packages[name] = entry;
}

// The fixture's own React tree, as the browser suite loads it.
tree.fixtureResolves = Object.fromEntries(['react', 'react-dom', 'react-reconciler', 'pixi.js'].map((specifier) =>
    [specifier, resolvedVersion(fixtureDir, specifier)?.version ?? null]));

if (tree.fixtureResolves.react !== expectedReact || tree.fixtureResolves['react-dom'] !== expectedReact)
{
    problems.push(`the fixture resolves react ${tree.fixtureResolves.react} and react-dom ${tree.fixtureResolves['react-dom']}`);
}

if (tree.fixtureResolves['react-reconciler'] !== ADAPTER_DEPENDENCIES['react-reconciler'])
{
    problems.push(`the fixture resolves react-reconciler ${tree.fixtureResolves['react-reconciler']}, expected only ${adapter.name}'s ${ADAPTER_DEPENDENCIES['react-reconciler']}`);
}

// pnpm's view of the fixture's installed React tree (every depth), for the record.
const ls = execFileSync(pnpm, ['ls', '--depth', 'Infinity', '--json', 'react', 'react-dom', 'react-reconciler'], {
    cwd: fixtureDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
});
const versions = new Set();
const collect = (node) =>
{
    for (const field of ['dependencies', 'devDependencies'])
    {
        for (const [dependency, child] of Object.entries(node?.[field] ?? {}))
        {
            if (['react', 'react-dom', 'react-reconciler'].includes(dependency))
            {
                versions.add(`${dependency}@${child.version}`);
            }

            collect(child);
        }
    }
};

JSON.parse(ls).forEach(collect);
tree.pnpmLs = [...versions].sort();

for (const entry of tree.pnpmLs)
{
    if (!entry.endsWith(`@${expectedReact}`) && entry !== `react-reconciler@${ADAPTER_DEPENDENCIES['react-reconciler']}`)
    {
        problems.push(`pnpm ls finds ${entry} in the fixture's tree`);
    }
}

writeFileSync(join(fixtureDir, '.installed', 'react-tree.json'), `${JSON.stringify(tree, null, 2)}\n`);
console.log(`${fixture.name}: installed packed ${Object.values(PACKED).join(', ')}`);
console.log(`  React tree (pnpm ls): ${tree.pnpmLs.join(', ')}`);

for (const [name, entry] of Object.entries(tree.packages))
{
    console.log(`  ${name}@${entry.version} -> react ${entry.react?.version ?? '-'}, react-reconciler ${entry['react-reconciler']?.version ?? '-'}`);
}

if (problems.length)
{
    console.error(`Packed install check failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
