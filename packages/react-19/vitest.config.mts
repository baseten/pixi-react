import { defineConfig } from 'vitest/config';

// Unit tests: the epoch sources (host-key audit, root factories, environment checks) in jsdom, and the built
// package (D6 single instance, subpath isolation) through plain Node. The per-tuple conformance runs live in
// fixtures/, one workspace package per audited React version.
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
