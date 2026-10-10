import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Browser cells: the same tests against each pixi.js 7 version in the peer range, in Chromium. A cell aliases the bare
 * `pixi.js` specifier (in the adapter source, the probe and the tests alike) to a version-pinned install.
 *
 * - `conformance-*`: the conformance suite on the floor (7.2.0), 7.4.2 and the newest 7.x release (7.4.3). The
 *   compatibility cells (design/compatibility/cells) also run 7.2.4, 7.3.0 and 7.3.3.
 * - `pixi-*`: Pixi 7-specific tests on each.
 */
const cells = [
    { version: '7.2.0', module: 'pixi.js-floor' },
    { version: '7.4.2', module: 'pixi.js' },
    { version: '7.4.3', module: 'pixi.js-current' },
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

export default defineWorkspace(cells.flatMap(({ version, module }) => [
    project('conformance', version, module),
    project('pixi', version, module),
]));
