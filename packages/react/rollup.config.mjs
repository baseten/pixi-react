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
    dependencies = {},
    peerDependencies = {},
} = repo;

const require = createRequire(import.meta.url);

/**
 * The facade ships OUR adapter code bundled: core, renderer, react-19.3 and pixi-8 are built into `lib/` and `dist/`,
 * so the published package depends on no `@pixi-react-provisional/*` package at runtime (issue 49). Third-party code
 * is not bundled into `lib/`: react-19.3's exact `react-reconciler` and `its-fine` are this package's own
 * dependencies, as upstream depends on `react-reconciler`, so the consumer's bundler resolves react-reconciler's
 * production or development build. The `dist/` bundles stay self-contained, as upstream's were: they bundle the
 * reconciler, its scheduler and its-fine too.
 *
 * `@pixi-react-provisional/pixi-8` resolves to its `bind` module, not its entry: the entry requires pixi.js and binds
 * to it at load, while the facade's single implementation must not import pixi.js itself (D6). The facade's entries
 * pass the pixi.js exports it needs (`PIXI8_BINDING_EXPORTS`, imported by name) to the bundled `bindPixi` instead.
 */
const PROVISIONAL_SCOPE = '@pixi-react-provisional/';
const REACT_ADAPTER_NAME = `${PROVISIONAL_SCOPE}react-19.3`;
const bundledEntries = {
    '@pixi-react-provisional/pixi-8': path.join(path.dirname(require.resolve('@pixi-react-provisional/pixi-8/package.json')), 'dist', 'cjs', 'bind.js'),
};

/**
 * @param {object} [options]
 * @param {boolean} [options.adaptersChunk] - Resolve the facade's runtime imports of the adapter packages to the
 * separately built `lib/adapters.js` (see the `lib-adapters` target) instead of bundling them into this build.
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
 * Fails the build if any react-reconciler, scheduler or its-fine source ended up in a `lib/` file: `lib/` requires
 * them as dependencies (issue 49). Their markers: the reconciler's build files, its host-config reads and its
 * `reconcilerVersion`, the scheduler's queue and its-fine's fiber walker.
 */
const THIRD_PARTY_SOURCE = /react-reconciler\.(?:development|production)|scheduler\.(?:development|production)|\$\$\$config\.|reconcilerVersion:|unstable_scheduleCallback|traverseFiber/;

function noThirdPartySource()
{
    return {
        name: 'no-third-party-source',
        generateBundle(_options, bundle)
        {
            for (const [fileName, file] of Object.entries(bundle))
            {
                const match = file.type === 'chunk' && file.code.match(THIRD_PARTY_SOURCE);

                if (match)
                {
                    this.error(`${fileName} contains third-party source (${match[0]}); lib/ must require its dependencies.`);
                }
            }
        },
    };
}

const plugins = ({ env, esmExternals = false, adaptersChunk = false, library = false } = {}) => [
    bundleAdapters({ adaptersChunk }),
    ...(library ? [noThirdPartySource()] : []),
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

/** The `dist/` bundles keep only the peers (and their subpaths, such as `pixi.js/*` and `react/jsx-runtime`) external. */
const peers = [...Object.keys(peerDependencies), 'react-dom'].map(convertPackageNameToRegExp);
/** `lib/` also keeps the dependencies (`react-reconciler`, `its-fine`) external: only our own code is bundled there. */
const libraryExternal = [...peers, ...Object.keys(dependencies).map(convertPackageNameToRegExp)];

const targets = {
    // The bundled adapters for `lib/`, one CommonJS module: `src/adapters.ts` re-exports what the facade uses at
    // runtime from core, renderer, react-19.3 and pixi-8 (pixi-8's `bind` module only). It requires
    // react-reconciler and its-fine, so the consumer's bundler picks the reconciler build by NODE_ENV.
    'lib-adapters': {
        input: 'src/adapters.ts',
        path: paths.library,
        entryFileNames: 'adapters',
        env: undefined,
        library: true,
        preserveModules: false,
        esmExternals: false,
        // Module side effects are kept as written, whatever the bundled packages' `sideEffects` fields say.
        treeshake: { moduleSideEffects: true },
        formats: ['cjs'],
    },
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
        library: true,
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

export default ['lib-adapters', 'lib', 'dist-dev', 'dist-prod'].map((target) =>
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
            library: targets[target].library,
        }),
        external: targets[target].library ? libraryExternal : peers,
        makeAbsoluteExternalsRelative: true,
        treeshake: targets[target].treeshake ?? false,
    }));
