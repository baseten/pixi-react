// Browser configuration of one isolated compatibility cell. Nothing is aliased: every specifier resolves through the
// cell's own node_modules, so a peer or declaration problem cannot be hidden by a workspace copy.
//
// COMPAT_RENDERER selects the render backend of this run (a key of `renderers` in cell.json, `webgl` by default): the
// Chromium flags that provide it, and (through test/renderer.ts) the application options that request it.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const cell = JSON.parse(readFileSync(new URL('./cell.json', import.meta.url), 'utf8'));
const renderer = process.env.COMPAT_RENDERER || 'webgl';
const backend = cell.renderers?.[renderer];

if (!backend) throw new Error(`COMPAT_RENDERER=${renderer}: this cell runs ${Object.keys(cell.renderers ?? {}).join(', ') || 'no renderer'}`);

export default defineConfig({
    esbuild: { jsx: 'automatic' },
    cacheDir: './node_modules/.vite',
    define: { __COMPAT_RENDERER__: JSON.stringify(renderer) },
    optimizeDeps: {
        // The packed conformance package ships TSX source: pre-bundle it with the automatic JSX runtime too.
        esbuildOptions: { jsx: 'automatic' },
        // The packed adapters ship one CJS implementation behind an ESM wrapper (D6): pre-bundle them, with React and
        // Pixi, so the browser loads one instance of each.
        include: [...cell.optimizeDeps, 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', ...(cell.dataOnly ? ['react-dom/test-utils'] : [])],
    },
    test: {
        include: ['test/**/*.test.tsx'],
        // Data-only probes (never verification cells) also lend React < 18.3 the `act` the suite calls.
        setupFiles: [...(cell.dataOnly ? ['test/data-only.ts'] : []), 'test/renderer.ts'],
        testTimeout: 15_000,
        browser: { enabled: true, name: 'chromium', provider: 'playwright', headless: true, providerOptions: { launch: { args: backend.chromiumArgs } } },
    },
});
