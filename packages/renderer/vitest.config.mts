import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts'],
        server: {
            deps: {
                // Load the built workspace packages with Node's own loader, as an installed copy would be: the
                // ESM wrapper then imports the single CJS implementation natively (D6).
                external: [/[\\/]packages[\\/](core|renderer)[\\/]dist[\\/]/],
            },
        },
    },
});
