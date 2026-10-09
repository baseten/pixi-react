import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'rollup-plugin-esbuild';
import injectProcessEnv from 'rollup-plugin-inject-process-env';
import sourcemaps from 'rollup-plugin-sourcemaps';
import repo from './package.json' with { type: 'json' };
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';

const moduleTarget = 'es2020';
const paths = {
    distributable: path.join(process.cwd(), 'dist'),
    library: path.join(process.cwd(), 'lib'),
    source: path.join(process.cwd(), 'src'),
};

const {
    peerDependencies = {},
} = repo;

const require = createRequire(import.meta.url);

/**
 * The facade ships its adapters bundled: core, renderer, the react-19.3 package (which already bundles its
 * react-reconciler, scheduler and its-fine) and pixi-8 are built into `lib/` and `dist/`, so the published package
 * depends on no `@pixi-react-provisional/*` package at runtime. Only the peers stay external.
 *
 * `@pixi-react-provisional/pixi-8` resolves to its `bind` module, not its entry: the entry requires pixi.js and binds
 * to it at load, while the facade's single implementation must not import pixi.js itself (D6). The facade's entries
 * pass their own pixi.js module to the bundled `bindPixi` instead.
 */
const PROVISIONAL_SCOPE = '@pixi-react-provisional/';
const REACT_ADAPTER_NAME = `${PROVISIONAL_SCOPE}react-19.3`;
const bundledEntries = {
    '@pixi-react-provisional/pixi-8': path.join(path.dirname(require.resolve('@pixi-react-provisional/pixi-8/package.json')), 'dist', 'cjs', 'bind.js'),
};

/**
 * @param {object} [options]
 * @param {boolean} [options.adaptersChunk] - Resolve the facade's runtime imports of the adapter packages to the
 * separately built `lib/adapters.js` (see the `lib-adapters-*` targets) instead of bundling them into this build.
 */
function bundleAdapters({ adaptersChunk = false } = {})
{
    return {
        name: 'bundle-adapters',
        resolveId(source, importer)
        {
            if (adaptersChunk && source.startsWith(PROVISIONAL_SCOPE) && importer?.startsWith(paths.source))
            {
                // An absolute external id is rendered relative to the importing source module, so the id is placed
                // where `lib/adapters.js` sits relative to the emitted modules: beside `src/index.ts`.
                return { id: path.join(paths.source, 'adapters.js'), external: true };
            }

            return bundledEntries[source] ?? null;
        },
        /**
         * The bundled react-19.3 adapter names its own provisional package in diagnostics (the certification pointer,
         * the unsupported-React message and the DevTools renderer name). That package is not what this package's
         * users install, so the bundled copy names `@pixi/react` instead. Any other reference left in the output is
         * a build error (see `generateBundle`).
         */
        transform(code, id)
        {
            if (id.startsWith(paths.source) || !code.includes(REACT_ADAPTER_NAME)) return null;

            return { code: code.replaceAll(REACT_ADAPTER_NAME, '@pixi/react'), map: null };
        },
        generateBundle(_options, bundle)
        {
            for (const [fileName, file] of Object.entries(bundle))
            {
                const text = file.type === 'chunk' ? file.code : String(file.source);

                if (!fileName.endsWith('.map') && text.includes(PROVISIONAL_SCOPE))
                {
                    this.error(`${fileName} still references ${PROVISIONAL_SCOPE}*; the facade must bundle its adapters.`);
                }
            }
        },
    };
}

/**
 * `lib/adapters.js` follows React's own pattern: it is a switch between `adapters.production.js` and
 * `adapters.development.js`, each bundled with `process.env.NODE_ENV` replaced by a literal and tree-shaken, so each
 * holds only one build of the bundled react-reconciler and scheduler. Without this, the one `lib/adapters.js` carried
 * both builds behind a runtime `NODE_ENV` test that consumers' bundlers keep (an unused `__commonJS(...)` wrapper is
 * not a pure call to them), where upstream's dependency on react-reconciler let them resolve only one build.
 */
const ADAPTERS_SWITCH = [
    '\'use strict\';',
    '',
    '// The bundled adapters, as React ships its own packages: one build per NODE_ENV.',
    'if (process.env.NODE_ENV === \'production\')',
    '{',
    '    module.exports = require(\'./adapters.production.js\');',
    '}',
    'else',
    '{',
    '    module.exports = require(\'./adapters.development.js\');',
    '}',
    '',
].join('\n');

/** Files of the other build: each per-NODE_ENV adapters bundle must not contain them. */
const OTHER_BUILD = {
    production: /(?:react-reconciler(?:-constants)?|scheduler)\.development\b/,
    development: /(?:react-reconciler(?:-constants)?|scheduler)\.production\b/,
};

/**
 * Replaces `process.env.NODE_ENV` with `nodeEnv` in every module before the CommonJS conversion, so tree-shaking
 * drops the other build; then fails the build if any of it is left, and emits the `lib/adapters.js` switch.
 * @param {'production' | 'development'} nodeEnv
 */
function adaptersForNodeEnv(nodeEnv)
{
    return {
        name: 'adapters-for-node-env',
        transform(code)
        {
            if (!code.includes('process.env.NODE_ENV')) return null;

            return { code: code.replaceAll('process.env.NODE_ENV', JSON.stringify(nodeEnv)), map: null };
        },
        generateBundle(_options, bundle)
        {
            for (const [fileName, file] of Object.entries(bundle))
            {
                const match = file.type === 'chunk' && file.code.match(OTHER_BUILD[nodeEnv]);

                if (match)
                {
                    this.error(`${fileName} is the ${nodeEnv} adapters build but contains ${match[0]}.`);
                }
            }
            if (nodeEnv === 'production')
            {
                this.emitFile({ type: 'asset', fileName: 'adapters.js', source: ADAPTERS_SWITCH });
            }
        },
    };
}

const plugins = ({ env, esmExternals = false, adaptersChunk = false, nodeEnv } = {}) => [
    bundleAdapters({ adaptersChunk }),
    ...(nodeEnv ? [adaptersForNodeEnv(nodeEnv)] : []),
    json(),
    esbuild({ target: moduleTarget, minify: env === 'production' }),
    sourcemaps(),
    commonjs({ esmExternals }),
    ...(env ? [injectProcessEnv({
        NODE_ENV: env
    })] : []),
    resolve({
        browser: true,
        preferBuiltins: false,
    }),
];

/**
 * Escapes the `RegExp` special characters.
 * @param {string} str
 */
function escapeRegExp(str)
{
    return str.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&');
}

/**
 * Convert the name of a package to a `RegExp` that matches the package's export names.
 * @param {string} packageName
 */
function convertPackageNameToRegExp(packageName)
{
    return new RegExp(`^${escapeRegExp(packageName)}(/.+)?$`);
}

/** Only the peers (and their subpaths, such as `pixi.js/*` and `react/jsx-runtime`) stay external. */
const external = [...Object.keys(peerDependencies), 'react-dom'].map(convertPackageNameToRegExp);

const targets = {
    // The bundled adapters for `lib/`, one CommonJS module per NODE_ENV behind the `lib/adapters.js` switch:
    // `src/adapters.ts` re-exports what the facade uses at runtime from core, renderer, react-19.3 and pixi-8
    // (pixi-8's `bind` module only).
    ...Object.fromEntries(['production', 'development'].map((nodeEnv) => [`lib-adapters-${nodeEnv}`, {
        input: 'src/adapters.ts',
        path: paths.library,
        entryFileNames: `adapters.${nodeEnv}`,
        env: undefined,
        nodeEnv,
        preserveModules: false,
        esmExternals: false,
        // Tree-shaking removes the other NODE_ENV's build. Module side effects are kept as written, whatever the
        // bundled packages' `sideEffects` fields say.
        treeshake: { moduleSideEffects: true },
        formats: ['cjs'],
    }])),
    // One CommonJS implementation (D6). `lib/index.mjs` is not built here: scripts/write-esm-entry.mjs generates it
    // as a thin ESM wrapper over `lib/bind.js`, so `import` and `require` load the same implementation module. Its
    // runtime imports of the adapter packages load `lib/adapters.js`.
    lib: {
        path: paths.library,
        entryFileNames: '[name]',
        env: undefined,
        preserveModules: true,
        esmExternals: false,
        adaptersChunk: true,
        formats: ['cjs'],
    },
    'dist-dev': {
        path: paths.distributable,
        entryFileNames: 'pixi-react',
        env: 'development',
        preserveModules: false,
        esmExternals: true,
        formats: ['cjs', 'esm'],
    },
    'dist-prod': {
        path: paths.distributable,
        entryFileNames: 'pixi-react.min',
        env: 'production',
        preserveModules: false,
        esmExternals: true,
        formats: ['cjs', 'esm'],
    },
};

export default ['lib-adapters-production', 'lib-adapters-development', 'lib', 'dist-dev', 'dist-prod'].map((target) =>
    ({
        input: targets[target].input ?? 'src/index.ts',
        output: targets[target].formats.map((format) => ({
            dir: targets[target].path,
            entryFileNames: `${targets[target].entryFileNames}.${format === 'cjs' ? 'js' : 'mjs'}`,
            exports: 'named',
            format,
            preserveModules: targets[target].preserveModules,
            preserveModulesRoot: paths.source,
            sourcemap: true,
            // The maps keep file and line mappings but not the sources: those include the unpublished adapter
            // packages' sources and import specifiers, which this package does not ship.
            sourcemapExcludeSources: true,
        })),
        plugins: plugins({
            env: targets[target].env,
            esmExternals: targets[target].esmExternals,
            adaptersChunk: targets[target].adaptersChunk,
            nodeEnv: targets[target].nodeEnv,
        }),
        external,
        makeAbsoluteExternalsRelative: true,
        treeshake: targets[target].treeshake ?? false,
    }));
