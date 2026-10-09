/**
 * Vitest configuration shared by the per-tuple fixtures. Each fixture is a workspace package that pins one exact
 * React/react-dom/@types tuple from the audit. It runs the BUILT `@pixi-react-provisional/react-19` package the way
 * a consumer installs it: `dist` and `package.json` are copied into the fixture's `.installed/node_modules`, so the
 * bundle's own `require('react')` and `require('@pixi-react-provisional/core')` resolve to the fixture's installs
 * (the workspace symlink would resolve them from the react-19 package instead).
 *
 * Shared test sources live outside the fixture, so the packages they import are deduped to the fixture's own copies.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Copies the built package into `<fixture>/.installed/node_modules/@pixi-react-provisional/react-19`. */
export function installBuiltPackage(fixtureDir)
{
    const target = join(fixtureDir, '.installed', 'node_modules', '@pixi-react-provisional', 'react-19');

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(join(packageDir, 'package.json'), join(target, 'package.json'));
    cpSync(join(packageDir, 'dist'), join(target, 'dist'), { recursive: true });

    return target;
}

export function fixtureConfig(fixtureDir)
{
    const installed = installBuiltPackage(fixtureDir);

    return {
        esbuild: { jsx: 'automatic' },
        resolve: {
            alias: [
                {
                    find: /^@pixi-react-provisional\/react-19\/(19\.\d)$/,
                    replacement: `${installed}/dist/$1/index.mjs`,
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
