import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Fast tests: the fake Pixi backend, the runner, the feature map and the negative controls run in jsdom.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts?(x)'],
        server: {
            deps: {
                // Load the built core/renderer packages with Node's loader, as an installed copy would be, so the
                // ESM wrapper imports their single CJS implementation natively (D6).
                external: [/[\\/]packages[\\/](core|renderer)[\\/]dist[\\/]/],
            },
        },
    },
});
