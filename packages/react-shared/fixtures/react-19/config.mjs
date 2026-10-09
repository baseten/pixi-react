/**
 * Vitest configuration shared by the per-tuple fixtures of the React 19 minor packages. Each fixture is a workspace
 * package under `packages/react-19.<minor>/fixtures/` that pins one exact React/react-dom/@types tuple from the
 * audit. It runs the BUILT `@pixi-react-provisional/react-19.<minor>` package the way a consumer installs it: `dist`
 * and `package.json` are copied into the fixture's `.installed/node_modules`, so the bundle's own `require('react')`,
 * `require('react-reconciler')`, `require('its-fine')` and `require('@pixi-react-provisional/core')` resolve to the
 * fixture's installs (the workspace symlink would resolve them from the adapter package instead). The fixture
 * installs the package's exact react-reconciler and its-fine itself, as a consumer's package manager would.
 *
 * The shared test sources (this directory) import the package under test as `@pixi-react-provisional/react-19-under-test`,
 * which each fixture aliases to its installed package; the packages they import are deduped to the fixture's own
 * copies.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The adapter package a fixture belongs to: `packages/react-19.<minor>/fixtures/<fixture>` → `packages/react-19.<minor>`. */
function adapterPackage(fixtureDir)
{
    const packageDir = resolve(fixtureDir, '../..');
    const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

    return { packageDir, name };
}

/** Copies the built adapter package into `<fixture>/.installed/node_modules/<name>`. */
export function installBuiltPackage(fixtureDir)
{
    const { packageDir, name } = adapterPackage(fixtureDir);
    const target = join(fixtureDir, '.installed', 'node_modules', ...name.split('/'));

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(join(packageDir, 'package.json'), join(target, 'package.json'));
    cpSync(join(packageDir, 'dist'), join(target, 'dist'), { recursive: true });

    return target;
}

export function fixtureConfig(fixtureDir)
{
    const installed = installBuiltPackage(fixtureDir);
    const { name } = adapterPackage(fixtureDir);

    return {
        esbuild: { jsx: 'automatic' },
        resolve: {
            alias: [
                {
                    find: new RegExp(`^(?:${name.replace('.', '\\.')}|@pixi-react-provisional/react-19-under-test)$`),
                    replacement: `${installed}/dist/index.mjs`,
                },
            ],
            // The shared sources sit outside the fixture: resolve these from the fixture, never from a sibling install.
            dedupe: [
                'react',
                'react-dom',
                'vitest',
                '@pixi-react-provisional/core',
                '@pixi-react-provisional/renderer',
                '@pixi-react-provisional/conformance',
            ],
        },
        test: {
            environment: 'jsdom',
            setupFiles: [fileURLToPath(new URL('./multipleRenderersGuard.ts', import.meta.url))],
            include: ['test/**/*.test.tsx'],
            server: {
                deps: {
                    // Load the built core/renderer like installed copies, so their ESM wrappers import the single CJS
                    // implementation natively (D6) and every module shares one core instance.
                    external: [/[\\/]packages[\\/](core|renderer)[\\/]dist[\\/]/, /[\\/]\.installed[\\/]/],
                },
            },
        },
    };
}
