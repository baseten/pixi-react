import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
        // One React instance for the facade, the scenarios and React DOM.
        resolve: { dedupe: ['react', 'react-dom'] },
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
