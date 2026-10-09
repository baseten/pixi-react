import { defineConfig } from 'vitest/config';

// Unit tests: pure algorithms and node behaviour that needs no renderer, against pixi.js 8.2.6, 8.9.2 and 8.22.0 at
// once (each bound with `bindPixi`). Browser cells (real applications) are in `vitest.browser.workspace.mts`.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/unit/**/*.test.ts'],
        server: {
            deps: {
                // Load the built core package with Node's loader, as an installed copy would be (D6).
                external: [/[\\/]packages[\\/]core[\\/]dist[\\/]/],
            },
        },
    },
});
