// Browser configuration of one isolated compatibility cell. Nothing is aliased: every specifier resolves through the
// cell's own node_modules, so a peer or declaration problem cannot be hidden by a workspace copy.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const cell = JSON.parse(readFileSync(new URL('./cell.json', import.meta.url), 'utf8'));

export default defineConfig({
    esbuild: { jsx: 'automatic' },
    cacheDir: './node_modules/.vite',
    optimizeDeps: {
        // The packed conformance package ships TSX source: pre-bundle it with the automatic JSX runtime too.
        esbuildOptions: { jsx: 'automatic' },
        // The packed adapters ship one CJS implementation behind an ESM wrapper (D6): pre-bundle them, with React and
        // Pixi, so the browser loads one instance of each.
        include: [...cell.optimizeDeps, 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
    },
    test: {
        include: ['test/**/*.test.tsx'],
        testTimeout: 15_000,
        browser: { enabled: true, name: 'chromium', provider: 'playwright', headless: true },
    },
});
