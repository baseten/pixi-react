/**
 * Vitest browser projects shared by the fixtures of the React 18 minor packages. Each fixture is a workspace package
 * under `packages/react-18.<minor>/fixtures/` that pins one exact React/react-dom/@types tuple and runs the PACKED
 * core, renderer, React 18 minor package and pixi-8 packages, which `install.mjs` extracts into its
 * `.installed/node_modules`. The four package names are aliased to those installs (the adapter also as
 * `@pixi-react-provisional/react-18-under-test`, the name the shared sources here import), so every import (the tests,
 * the shared sources and the packages themselves) reaches one installed copy of each.
 *
 * Each fixture runs two Pixi cells in Chromium: the Pixi 8 floor (8.2.6) and the newest tested Pixi 8 (8.22.0),
 * with the same unchanged Pixi8Adapter. The tests and the shared probe import the bare `pixi.js`, which a cell aliases
 * to its version-pinned install.
 *
 * React before 18.3 has no `React.act`; the conformance harness calls it. For those fixtures `lendAct.ts` (a setup
 * file) lends React the `act` of `react-dom/test-utils`, where React 18.0 to 18.2 export it. The adapter is untouched.
 */
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIXI_CELLS = Object.freeze([
    { version: '8.2.6', module: 'pixi.js' },
    { version: '8.22.0', module: 'pixi.js-current' },
]);

/** The React 18 minor package a fixture belongs to: `packages/react-18.<minor>/fixtures/<fixture>` → `react-18.<minor>`. */
function adapterPackage(fixtureDir)
{
    return basename(resolve(fixtureDir, '../..'));
}

/** The browser (`import`) entry of an installed package, read from its own `exports` map. */
function importEntry(fixtureDir, name)
{
    const dir = join(fixtureDir, '.installed', 'node_modules', '@pixi-react-provisional', name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

    return join(dir, manifest.exports['.'].import.default);
}

/** Whether the fixture's React predates `React.act` (React 18.3). */
function needsLentAct(fixtureDir)
{
    const { react } = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')).devDependencies;
    const [major, minor] = react.split('.').map(Number);

    return major === 18 && minor < 3;
}

function project(fixtureDir, kind, { version, module })
{
    const adapter = adapterPackage(fixtureDir);
    const packages = ['core', 'renderer', adapter, 'pixi-8'];
    const lendAct = needsLentAct(fixtureDir);

    return {
        root: fixtureDir,
        esbuild: { jsx: 'automatic' },
        cacheDir: join(fixtureDir, 'node_modules', '.vite', `${kind}-${version}`),
        resolve: {
            alias: [
                ...packages.map((name) => ({
                    find: new RegExp(`^@pixi-react-provisional/${name.replace('.', '\\.')}$`),
                    replacement: importEntry(fixtureDir, name),
                })),
                { find: /^@pixi-react-provisional\/react-18-under-test$/, replacement: importEntry(fixtureDir, adapter) },
                { find: /^pixi\.js$/, replacement: module },
            ],
            // Shared sources (the Pixi 8 probe, the conformance package) sit outside the fixture: resolve these from
            // the fixture, never from a sibling install with another React or Pixi.
            dedupe: ['react', 'react-dom', 'pixi.js', module, '@pixi-react-provisional/conformance'],
        },
        optimizeDeps: {
            // The modular packages ship one CJS implementation behind an ESM wrapper (D6): pre-bundle them, with
            // React 18 and the cell's pixi.js, so the browser loads one instance of each.
            include: [
                ...packages.map((name) => `@pixi-react-provisional/${name}`),
                module,
                'react',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                'react-dom',
                'react-dom/client',
                ...(lendAct ? ['react-dom/test-utils'] : []),
            ],
        },
        test: {
            name: `${kind}-pixi-${version}`,
            browser: {
                enabled: true,
                name: 'chromium',
                provider: 'playwright',
                headless: true,
            },
            include: kind === 'conformance' ? ['test/conformance.test.tsx'] : ['test/**/*.test.tsx'],
            exclude: kind === 'conformance' ? [] : ['test/conformance.test.tsx'],
            setupFiles: lendAct ? [fileURLToPath(new URL('./lendAct.ts', import.meta.url))] : [],
            testTimeout: 15_000,
        },
    };
}

/** The browser projects of one fixture: the conformance suite and the React 18 suite, on each Pixi cell. */
export function fixtureWorkspace(fixtureDir)
{
    return PIXI_CELLS.flatMap((cell) => [project(fixtureDir, 'conformance', cell), project(fixtureDir, 'react18', cell)]);
}
