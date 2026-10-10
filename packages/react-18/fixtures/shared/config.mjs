/**
 * Vitest browser projects shared by the React 18 fixtures. Each fixture is a workspace package that pins one exact
 * React/react-dom/@types tuple and runs the PACKED core, renderer, react-18 and pixi-8 packages, which
 * `install.mjs` extracts into its `.installed/node_modules`. The four package names are aliased to those installs,
 * so every import (the tests, the shared sources and the packages themselves) reaches one installed copy of each.
 *
 * Each fixture runs two Pixi cells in Chromium: the Pixi 8 floor (8.2.6) and the newest tested Pixi 8 (8.22.0),
 * with the same unchanged Pixi8Adapter. The tests and the shared probe import the bare `pixi.js`, which a cell aliases
 * to its version-pinned install.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = ['core', 'renderer', 'react-18', 'pixi-8'];

export const PIXI_CELLS = Object.freeze([
    { version: '8.2.6', module: 'pixi.js' },
    { version: '8.22.0', module: 'pixi.js-current' },
]);

/** The browser (`import`) entry of an installed package, read from its own `exports` map. */
function importEntry(fixtureDir, name)
{
    const dir = join(fixtureDir, '.installed', 'node_modules', '@pixi-react-provisional', name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

    return join(dir, manifest.exports['.'].import.default);
}

function project(fixtureDir, kind, { version, module })
{
    return {
        root: fixtureDir,
        esbuild: { jsx: 'automatic' },
        cacheDir: join(fixtureDir, 'node_modules', '.vite', `${kind}-${version}`),
        resolve: {
            alias: [
                ...PACKAGES.map((name) => ({
                    find: new RegExp(`^@pixi-react-provisional/${name}$`),
                    replacement: importEntry(fixtureDir, name),
                })),
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
                ...PACKAGES.map((name) => `@pixi-react-provisional/${name}`),
                module,
                'react',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                'react-dom',
                'react-dom/client',
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
            testTimeout: 15_000,
        },
    };
}

/** The browser projects of one fixture: the conformance suite and the React 18 suite, on each Pixi cell. */
export function fixtureWorkspace(fixtureDir)
{
    return PIXI_CELLS.flatMap((cell) => [project(fixtureDir, 'conformance', cell), project(fixtureDir, 'react18', cell)]);
}
