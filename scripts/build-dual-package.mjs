#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Builds a workspace package as ONE CommonJS implementation plus a thin ESM wrapper (decision D6).
 *
 *   dist/cjs/*.js, *.d.ts   the only implementation, emitted by tsc (`tsconfig.build.json`)
 *   dist/esm/index.mjs      `import cjs from '../cjs/index.js'` and re-exports each named export
 *   dist/esm/index.d.mts    `export * from '../cjs/index.js'`
 *
 * `import` and `require` therefore load the same module instance: one set of classes, one CompatibilityError,
 * one runtime registry implementation. The wrapper lists the export names explicitly (read from the built CJS
 * module), so Node does not depend on cjs-module-lexer guessing them, and a missing export fails the build.
 *
 * A package whose implementation must use a DUAL-BUILD PEER (pixi.js ships separate ESM and CJS builds) declares
 * `"dualPackage": { "peerBinding": { "peer": "pixi.js", "module": "bind.js", "bind": "bindPixi",
 * "imports": "PIXI8_BINDING_EXPORTS" } }` in its package.json. Its implementation never imports the peer at runtime;
 * instead:
 *
 *   dist/cjs/index.js       requires the peer and calls `bind({ ...named exports })` (written by the package itself)
 *   dist/esm/index.mjs      `import { <names> } from '<peer>'`, then re-exports `bind({ <names> })`'s members from the
 *                           one CJS implementation module (`dist/cjs/<module>`), plus that module's own named exports
 *
 * so each module system's consumers get the implementation bound to the peer instance THEY load, while the
 * implementation module (and every cache in it) is still loaded once. `<names>` is the list the implementation module
 * exports under the name `imports`: the peer's exports it uses. The wrapper imports them by name and never the
 * namespace, because a namespace object passed to a function keeps every export of the peer alive in a bundler.
 *
 * The declarations are tsc's, one per source module. The runtime JavaScript is not (issue 58): each runtime entry
 * (`index.js`, and the peer-binding `module`) is one esbuild bundle of the sources it reaches, so a consumer's bundler
 * gets no per-module CommonJS boilerplate. The `index.js` of a peer-binding package requires the binding module
 * (`./<module>`) instead of bundling it, so the implementation is still loaded once. Dependencies and peers stay
 * external, and `process.env.NODE_ENV` is left as written, for the consumer's bundler to replace.
 *
 * Run from the package directory: `node ../../scripts/build-dual-package.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const packageDir = process.cwd();
const require = createRequire(join(packageDir, 'package.json'));
const dist = resolve(packageDir, 'dist');
const tsc = require.resolve('typescript/bin/tsc');

rmSync(dist, { recursive: true, force: true });
try
{
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: packageDir, stdio: 'inherit' });
}
catch (error)
{
    console.error(`tsc failed for ${packageDir}`);
    process.exit(error.status ?? 1);
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const { peerBinding } = manifest.dualPackage ?? {};

await bundleRuntime();

/** Replaces tsc's JavaScript in `dist/cjs` with one esbuild bundle per runtime entry; the declarations stay. */
async function bundleRuntime()
{
    const esbuild = require('esbuild');
    const external = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
        .flatMap((name) => [name, `${name}/*`]);
    const bindingModule = peerBinding?.module;
    const entries = ['index.js', ...(bindingModule ? [bindingModule] : [])];
    const cjs = join(dist, 'cjs');

    for (const file of readdirSync(cjs, { recursive: true }))
    {
        if ((/\.js(\.map)?$/).test(file))
        {
            rmSync(join(cjs, file));
        }
    }

    for (const file of entries)
    {
        // The entry requires the binding module rather than bundling a second copy of the implementation.
        const keepBindingExternal = file === 'index.js' && bindingModule
            ? [{
                name: 'external-binding-module',
                setup(build)
                {
                    build.onResolve({ filter: /^\./ }, ({ path, importer }) =>
                        (resolve(importer, '..', path) === join(packageDir, 'src', bindingModule) ? { path: `./${bindingModule}`, external: true } : undefined));
                },
            }]
            : [];

        const { metafile } = await esbuild.build({
            entryPoints: [join(packageDir, 'src', file.replace(/\.js$/, '.ts'))],
            outfile: join(cjs, file),
            bundle: true,
            format: 'cjs',
            platform: 'neutral',
            mainFields: ['main'],
            target: 'es2022',
            tsconfig: join(packageDir, 'tsconfig.build.json'),
            external,
            sourcemap: true,
            sourcesContent: false,
            logLevel: 'warning',
            metafile: true,
            ...(keepBindingExternal.length ? { plugins: keepBindingExternal } : {}),
        });
        const sources = Object.keys(metafile.inputs).map((input) => relative(packageDir, resolve(packageDir, input)));

        // D6: the peer-binding entry must not carry a second copy of any implementation module.
        if (keepBindingExternal.length && sources.some((source) => source !== join('src', 'index.ts')))
        {
            throw new Error(`dist/cjs/index.js must require ./${bindingModule} and bundle nothing else, but it bundles ${sources.join(', ')}.`);
        }
    }
}

const entry = join(dist, 'cjs', 'index.js');
const names = Object.keys(require(entry)).filter((name) => name !== '__esModule' && name !== 'default').sort();

for (const name of names)
{
    if (!(/^[A-Za-z_$][\w$]*$/).test(name))
    {
        throw new Error(`Export "${name}" is not a valid ESM binding name.`);
    }
}

const destructure = (list, source) => `export const {\n${list.map((name) => `    ${name},`).join('\n')}\n} = ${source};`;
let wrapper;

if (peerBinding)
{
    const { peer, module, bind, imports } = peerBinding;
    const implementation = require(join(dist, 'cjs', module));
    const peerNames = implementation[imports];

    if (!Array.isArray(peerNames) || !peerNames.length || peerNames.some((name) => typeof name !== 'string' || !(/^[A-Za-z_$][\w$]*$/).test(name)))
    {
        throw new Error(`${module} must export "${imports}": the ${peer} export names to bind, as identifiers.`);
    }

    const peerModule = require(peer);
    const absent = peerNames.filter((name) => !(name in peerModule));

    if (absent.length)
    {
        throw new Error(`${peer} does not export ${absent.join(', ')}, listed in ${module}'s "${imports}".`);
    }

    const boundNames = Object.keys(implementation[bind](Object.fromEntries(peerNames.map((name) => [name, peerModule[name]]))));
    const fromBound = names.filter((name) => boundNames.includes(name));
    const fromModule = names.filter((name) => !boundNames.includes(name));
    const missing = fromModule.filter((name) => !(name in implementation));

    if (missing.length)
    {
        throw new Error(`Exports ${missing.join(', ')} are neither bound by ${bind}() nor exported by ${module}.`);
    }

    wrapper = [
        '// Generated by scripts/build-dual-package.mjs: the ESM entry binds the single CJS implementation (D6) to the',
        `// ${peer} instance that \`import\` loads (see "dualPackage.peerBinding" in package.json).`,
        `// Only the ${peer} exports the implementation uses are imported, by name: never the namespace (tree shaking).`,
        // Aliased, so a peer export never collides with one of the package's own export names.
        `import { ${peerNames.map((name) => `${name} as peer_${name}`).join(', ')} } from '${peer}';`,
        `import implementation from '../cjs/${module}';`,
        '',
        `const bound = implementation.${bind}({ ${peerNames.map((name) => `${name}: peer_${name}`).join(', ')} });`,
        '',
        destructure(fromBound, 'bound'),
        ...(fromModule.length ? ['', destructure(fromModule, 'implementation')] : []),
        '',
    ];
}
else
{
    wrapper = [
        '// Generated by scripts/build-dual-package.mjs: the ESM entry re-exports the single CJS implementation (D6).',
        'import cjs from \'../cjs/index.js\';',
        '',
        destructure(names, 'cjs'),
        '',
    ];
}

mkdirSync(join(dist, 'esm'), { recursive: true });
writeFileSync(join(dist, 'esm', 'index.mjs'), wrapper.join('\n'));
writeFileSync(
    join(dist, 'esm', 'index.d.mts'),
    [
        '// Generated by scripts/build-dual-package.mjs: types of the single CJS implementation (D6).',
        'export * from \'../cjs/index.js\';',
        '',
    ].join('\n'),
);

console.log(`${packageDir}: CJS implementation + ESM wrapper with ${names.length} exports`);
