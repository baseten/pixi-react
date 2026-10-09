import { defineConfig } from 'vitest/config';

// Unit tests: the adapter source (host-key audit, root factory, environment checks) in jsdom, and the built package
// (D6 single instance) through plain Node. The browser runs with React 18 and the real Pixi 8 adapter live in
// fixtures/, one workspace package per tested React version.
export default defineConfig({
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts'],
        server: {
            deps: {
                // Load the built core like an installed copy, so its ESM wrapper imports the CJS implementation (D6).
                external: [/[\\/]packages[\\/]core[\\/]dist[\\/]/],
            },
        },
    },
});
