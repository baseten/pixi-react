import { defineConfig } from 'vitest/config';

// Unit tests: the package sources (host-key audit, root factory, shared reconciler, environment checks) in jsdom, and
// the built package (D6 single instance, its dependencies) through plain Node. The per-tuple conformance runs live in
// fixtures/, one workspace package per audited React version.
export default defineConfig({
    esbuild: { jsx: 'automatic' },
    resolve: {
        // The shared sources (react-shared) resolve React from this package, so the tests load one React.
        dedupe: ['react', 'its-fine'],
    },
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
