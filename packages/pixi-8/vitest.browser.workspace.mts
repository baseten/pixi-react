import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Browser cells: the same tests against each pixi.js version the adapter is tested on, in Chromium. A cell aliases
 * the bare `pixi.js` specifier (in the adapter source, the probe and the tests alike) to a version-pinned install.
 *
 * - `conformance-*`: the conformance suite on the floor (8.2.6) and the newest tested version (8.22.0).
 * - `pixi-*`: Pixi-specific tests on 8.2.6, 8.9.2 (particles before the 8.10 removeParticles change) and 8.22.0.
 * - `webgpu-*`: the WebGPU device lifecycle (`test/browser/webgpu`) on software WebGPU, on 8.2.6 (before Pixi destroys
 *   its own device, 8.21) and 8.22.0. The other projects run on WebGL.
 */
const cells = [
    { version: '8.2.6', module: 'pixi.js', conformance: true, webgpu: true },
    { version: '8.9.2', module: 'pixi.js-8.9', conformance: false, webgpu: false },
    { version: '8.22.0', module: 'pixi.js-current', conformance: true, webgpu: true },
];

/** Software WebGPU: Dawn on SwiftShader's Vulkan device, as the examples' WebGPU smoke test and the software GPU profile. */
const WEBGPU_ARGS = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
];

const INCLUDE = {
    conformance: ['test/browser/conformance.test.tsx'],
    pixi: ['test/browser/pixi/**/*.test.ts?(x)'],
    webgpu: ['test/browser/webgpu/**/*.test.ts?(x)'],
};

function project(kind: 'conformance' | 'pixi' | 'webgpu', version: string, module: string)
{
    return {
        plugins: [react()],
        cacheDir: `node_modules/.vite/${kind}-${version}`,
        resolve: {
            alias: [{ find: /^pixi\.js$/, replacement: module }],
            // One React for the scenarios, the fake React adapter and React DOM.
            dedupe: ['react', 'react-dom'],
        },
        optimizeDeps: {
            // core and renderer ship one CJS implementation behind an ESM wrapper (D6): pre-bundle them for the browser.
            include: ['@pixi-react-provisional/core', '@pixi-react-provisional/renderer', module],
        },
        test: {
            name: `${kind}-${version}`,
            browser: {
                enabled: true,
                name: 'chromium',
                provider: 'playwright',
                headless: true,
                ...(kind === 'webgpu' ? { providerOptions: { launch: { args: WEBGPU_ARGS } } } : {}),
            },
            include: INCLUDE[kind],
            testTimeout: 15_000,
        },
    };
}

export default defineWorkspace(cells.flatMap(({ version, module, conformance, webgpu }) => [
    ...(conformance ? [project('conformance', version, module)] : []),
    project('pixi', version, module),
    ...(webgpu ? [project('webgpu', version, module)] : []),
]));
