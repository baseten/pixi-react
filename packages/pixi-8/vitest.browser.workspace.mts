import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Browser cells: the same tests against each pixi.js version the adapter is tested on, in Chromium. A cell aliases
 * the bare `pixi.js` specifier (in the adapter source, the probe and the tests alike) to a version-pinned install.
 *
 * - `conformance-*`: the conformance suite on the floor (8.2.6) and the newest certified version (8.22.0).
 * - `pixi-*`: Pixi-specific tests on 8.2.6, 8.9.2 (particles before the 8.10 removeParticles change) and 8.22.0.
 */
const cells = [
    { version: '8.2.6', module: 'pixi.js', conformance: true },
    { version: '8.9.2', module: 'pixi.js-8.9', conformance: false },
    { version: '8.22.0', module: 'pixi.js-current', conformance: true },
];

function project(kind: 'conformance' | 'pixi', version: string, module: string)
{
    return {
        plugins: [react()],
        cacheDir: `node_modules/.vite/${kind}-${version}`,
        resolve: {
            alias: [{ find: /^pixi\.js$/, replacement: module }],
            // One React for the scenarios, the fake React adapter and React DOM.
            dedupe: ['react', 'react-dom'],
        },
        optimizeDeps: {
            // core and renderer ship one CJS implementation behind an ESM wrapper (D6): pre-bundle them for the browser.
            include: ['@pixi-react-provisional/core', '@pixi-react-provisional/renderer', module],
        },
        test: {
            name: `${kind}-${version}`,
            browser: {
                enabled: true,
                name: 'chromium',
                provider: 'playwright',
                headless: true,
            },
            include: kind === 'conformance' ? ['test/browser/conformance.test.tsx'] : ['test/browser/pixi/**/*.test.ts?(x)'],
            testTimeout: 15_000,
        },
    };
}

export default defineWorkspace(cells.flatMap(({ version, module, conformance }) => [
    ...(conformance ? [project('conformance', version, module)] : []),
    project('pixi', version, module),
]));
