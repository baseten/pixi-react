import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = realpathSync(resolve(appRoot, '../..'));

/**
 * The workspace packages the examples consume. They resolve through pnpm's `workspace:` links to their built output
 * in packages/<name> (run `pnpm build` first): never to a copy from npm. Each ships a CommonJS implementation behind
 * an ESM entry (D6), so the dev server pre-bundles them and the production build converts them.
 */
const workspacePackages = [
    '@pixi/react',
    // A transitive dependency: Vite resolves it through the package that depends on it.
    '@pixi-react-provisional/renderer > @pixi-react-provisional/core',
    '@pixi-react-provisional/renderer',
    '@pixi-react-provisional/react-19.3',
    '@pixi-react-provisional/pixi-8',
];

/**
 * Writes dist/module-graph.json: every module in the production bundle, relative to the repository root. The bundle
 * check (scripts/check-bundle.mjs) reads it to prove the examples use the local workspace packages and one copy each
 * of React and pixi.js.
 */
function moduleGraph(): Plugin
{
    return {
        name: 'examples-module-graph',
        apply: 'build',
        generateBundle()
        {
            const modules = [...this.getModuleIds()]
                .filter((id) => !id.startsWith('\0'))
                .map((id) => relative(repoRoot, id.split('?')[0]).split('\\').join('/'))
                .sort();

            this.emitFile({ type: 'asset', fileName: 'module-graph.json', source: `${JSON.stringify({ modules }, null, 2)}\n` });
        },
    };
}

export default defineConfig({
    plugins: [react(), moduleGraph()],
    resolve: {
        // The workspace packages keep their own dev copies of pixi.js (packages/react tests against 8.2.6, for
        // example). Resolve every import of these from this app, as a consumer's single install would.
        dedupe: ['pixi.js', 'react', 'react-dom'],
    },
    optimizeDeps: {
        include: [...workspacePackages, 'pixi.js'],
    },
    build: {
        // Serve every asset as a file from the app's own origin rather than inlining it.
        assetsInlineLimit: 0,
        commonjsOptions: {
            include: [/node_modules/, /packages\/[^/]+\/(?:dist|lib)\//],
        },
        sourcemap: true,
    },
    server: {
        port: 5180,
        strictPort: true,
    },
    preview: {
        port: 5180,
        strictPort: true,
    },
});
