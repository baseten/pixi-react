import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Fast tests: the fake scene backend, the runner, the feature map and the negative controls run in jsdom.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.ts?(x)'],
    },
});
