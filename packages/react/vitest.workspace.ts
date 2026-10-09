import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The modular packages ship one CommonJS implementation behind an ESM wrapper (D6); the browser projects pre-bundle
 * them, with pixi.js, so the facade, its adapters and the tests share one Pixi and one React instance.
 */
const browserDeps = {
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: {
        include: [
            '@pixi-react-provisional/core',
            '@pixi-react-provisional/renderer',
            '@pixi-react-provisional/pixi-8',
            '@pixi-react-provisional/react-19.3',
            'pixi.js',
        ],
    },
};

export default defineWorkspace([
    {
        plugins: [react()],
        test: {
            environment: 'jsdom',
            include: ['test/unit/**/*.test.ts?(x)'],
            pool: 'forks',
        },
    },
    {
        plugins: [react()],
        ...browserDeps,
        test: {
            browser: {
                enabled: true,
                name: 'chromium',
                provider: 'playwright',
            },
            globals: true,
            include: ['test/e2e/**/*.test.ts(x)'],
            setupFiles: ['./vitest.setup.ts'],
        },
    },
    {
        plugins: [react()],
        ...browserDeps,
        test: {
            name: 'conformance',
            browser: {
                enabled: true,
                name: 'chromium',
                provider: 'playwright',
            },
            include: ['test/conformance/**/*.test.tsx'],
        },
    },
]);
