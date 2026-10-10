import { defineConfig } from 'vitest/config';

// Unit tests: the package sources (host-key audit, root factory, shared reconciler, environment checks) in jsdom, and
// the built package (D6 single instance, its dependencies) through plain Node. The browser runs with React 18 and the
// real Pixi 8 adapter live in fixtures/, one workspace package per tested React version.
export default defineConfig({
    esbuild: { jsx: 'automatic' },
    resolve: {
        // The shared sources (react-shared) resolve React and its-fine from this package, so the tests load this
        // package's React 18 and its-fine 1, never react-shared's React 19 devDependencies.
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
