import { defineConfig } from 'vitest/config';

// Unit tests run against the TypeScript sources with fake adapters. DOM targets come from jsdom; the
// D6 single-instance test spawns plain Node against the built package instead.
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts'],
    },
});
