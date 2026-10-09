#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Builds one React adapter package (`react-18`, `react-19.0` … `react-19.3`), the per-minor layout of issue 49 with
 * the single-runtime packaging of decision D6:
 *
 *   dist/index.js     ONE CommonJS implementation, bundled by esbuild. It contains ONLY our own code: the package's
 *                     sources and the private `@pixi-react-provisional/react-shared` sources they import. Every
 *                     third-party module (`react`, `react-reconciler`, `its-fine`, …) and `@pixi-react-provisional/core`
 *                     stays external: they are the package's dependencies and peer, resolved by the consumer's package
 *                     manager, so the consumer's bundler picks the reconciler's production or development build.
 *   dist/index.mjs    a generated ESM wrapper: `import cjs from './index.js'` re-exporting each named export, so
 *                     `import` and `require` reach the same module instance.
 *   dist/**\/*.d.ts   declarations emitted by tsc. The react-shared declarations the package's entry reaches are
 *                     copied into dist/shared/ and their bare specifiers rewritten to relative ones, because
 *                     react-shared is not published. dist/index.d.mts re-exports index.d.ts.
 *
 * Declarations not reachable from the entry (the host config, which names react-reconciler) are removed, so no
 * published declaration names a module the package does not ship or depend on.
 *
 * Run from the package directory: `node ../../scripts/build-react-adapter.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const packageDir = process.cwd();
const require = createRequire(join(packageDir, 'package.json'));
const esbuild = require('esbuild');
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

const dist = join(packageDir, 'dist');
const SHARED = '@pixi-react-provisional/react-shared';
const sharedDir = dirname(require.resolve(`${SHARED}/package.json`));
const sharedExports = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8')).exports;

/** Everything that is not our own code stays external: the dependencies, the peers and their subpaths. */
const EXTERNAL = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
    .flatMap((name) => [name, `${name}/*`]);

if (!existsSync(join(sharedDir, 'dist')))
{
    throw new Error(`${SHARED} has no declarations (${join(sharedDir, 'dist')}); build it first.`);
}

rmSync(dist, { recursive: true, force: true });

try
{
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
        cwd: packageDir,
        stdio: 'inherit',
    });
}
catch (error)
{
    console.error('tsc (declarations) failed');
    process.exit(error.status ?? 1);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

// The react-shared declarations, under dist/shared/ (the same layout as react-shared's own dist/).
cpSync(join(sharedDir, 'dist'), join(dist, 'shared'), { recursive: true });

/** `@pixi-react-provisional/react-shared/<subpath>` → the declaration file it resolves to, inside dist/shared/. */
function sharedDeclaration(specifier)
{
    const subpath = `.${specifier.slice(SHARED.length)}`;
    const types = sharedExports[subpath]?.types;

    if (!types)
    {
        throw new Error(`${specifier} is not an export of ${SHARED}.`);
    }

    return join(dist, 'shared', relative(join(sharedDir, 'dist'), join(sharedDir, types)));
}

// Rewrite every bare react-shared specifier to a relative one.
for (const file of walk(dist).filter((path) => path.endsWith('.d.ts')))
{
    const text = readFileSync(file, 'utf8');
    const rewritten = text.replace(new RegExp(`(['"])(${SHARED.replaceAll('/', '\\/')}(?:\\/[^'"]+)?)\\1`, 'g'), (_match, quote, specifier) =>
    {
        let target = relative(dirname(file), sharedDeclaration(specifier)).split(sep).join('/').replace(/\.d\.ts$/, '.js');

        if (!target.startsWith('.'))
        {
            target = `./${target}`;
        }

        return `${quote}${target}${quote}`;
    });

    if (rewritten !== text)
    {
        writeFileSync(file, rewritten);
    }
}

pruneDeclarations();

/**
 * Keeps only the declarations reachable from the entry, so no published declaration references a module the package
 * neither ships nor depends on (the host config's declaration names react-reconciler, which ships no types).
 */
function pruneDeclarations()
{
    const keep = new Set();
    const pending = [join(dist, 'index.d.ts')];

    while (pending.length)
    {
        const file = pending.pop();

        if (keep.has(file))
        {
            continue;
        }

        if (!existsSync(file))
        {
            throw new Error(`A published declaration imports ${relative(dist, file)}, which was not emitted.`);
        }

        keep.add(file);

        for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']+)'/g))
        {
            pending.push(resolve(dirname(file), specifier.replace(/\.js$/, '.d.ts')));
        }
    }

    for (const file of walk(dist))
    {
        if (file.endsWith('.d.ts') && !keep.has(file))
        {
            rmSync(file);
        }
    }

    const removeEmpty = (dir) =>
    {
        for (const entry of readdirSync(dir, { withFileTypes: true }))
        {
            if (entry.isDirectory())
            {
                removeEmpty(join(dir, entry.name));
                if (readdirSync(join(dir, entry.name)).length === 0)
                {
                    rmSync(join(dir, entry.name), { recursive: true });
                }
            }
        }
    };

    removeEmpty(dist);
}

const outfile = join(dist, 'index.js');

/**
 * The package's `imports` aliases (`#reconciler` → `react-reconciler`) name dependencies: they stay external, and the
 * bundle requires the dependency itself.
 */
const importAliases = {
    name: 'external-import-aliases',
    setup(build)
    {
        build.onResolve({ filter: /^#/ }, ({ path }) =>
        {
            const target = manifest.imports?.[path];

            if (typeof target !== 'string' || target.startsWith('.'))
            {
                return undefined;
            }

            return { path: target, external: true };
        });
    },
};

await esbuild.build({
    entryPoints: [join(packageDir, 'src', 'index.ts')],
    plugins: [importAliases],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['main'],
    target: 'es2022',
    jsx: 'automatic',
    external: EXTERNAL,
    legalComments: 'inline',
    logLevel: 'warning',
});

const names = Object.keys(require(outfile)).filter((name) => name !== '__esModule' && name !== 'default').sort();

for (const name of names)
{
    if (!(/^[A-Za-z_$][\w$]*$/).test(name))
    {
        throw new Error(`Export "${name}" is not a valid ESM binding name.`);
    }
}

writeFileSync(
    join(dist, 'index.mjs'),
    [
        '// Generated by scripts/build-react-adapter.mjs: the ESM entry re-exports the single CJS implementation (D6).',
        'import cjs from \'./index.js\';',
        '',
        `export const {\n${names.map((name) => `    ${name},`).join('\n')}\n} = cjs;`,
        '',
    ].join('\n'),
);
writeFileSync(
    join(dist, 'index.d.mts'),
    [
        '// Generated by scripts/build-react-adapter.mjs: types of the single CJS implementation (D6).',
        'export * from \'./index.js\';',
        '',
    ].join('\n'),
);

console.log(`${manifest.name}: CJS bundle + ESM wrapper with ${names.length} exports; external: ${[...new Set(EXTERNAL.filter((name) => !name.endsWith('/*')))].join(', ')}`);
