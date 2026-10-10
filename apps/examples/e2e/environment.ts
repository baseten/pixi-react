/**
 * The pinned environment of the example browser tests (issue 19). The visual baselines in e2e/snapshots were rendered
 * in exactly this environment; the `environment` test of the visual project fails (never skips) when the browser it
 * gets differs, so a Playwright bump or a lost software renderer shows up as one clear failure rather than as pixel
 * noise. Change these values only together with regenerated, reviewed baselines (README, "Visual baselines").
 */

/** `@playwright/test`, exact in package.json. Each Playwright release bundles one Chromium build. */
export const PLAYWRIGHT_VERSION = '1.50.1';

/** The Chromium that Playwright 1.50.1 bundles (headless shell, build 1155). */
export const CHROMIUM_VERSION = '133.0.6943.16';

/** The only platform with committed baselines: Linux x64, as on the `ubuntu-24.04` CI runner. */
export const BASELINE_PLATFORM = 'linux';

/**
 * WebGL through ANGLE on SwiftShader, Chromium's CPU renderer: the same rasterizer on every machine, with no GPU or
 * driver in the loop. `--enable-unsafe-swiftshader` keeps SwiftShader available for WebGL now that Chromium no longer
 * falls back to it automatically.
 */
export const WEBGL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** What `WEBGL_debug_renderer_info` must report under WEBGL_ARGS. */
export const WEBGL_RENDERER_PATTERN = /SwiftShader/;

/**
 * WebGPU for the separate, non-required smoke test: Dawn on SwiftShader's Vulkan device. Never used for baselines.
 */
export const WEBGPU_ARGS = [
    ...WEBGL_ARGS,
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
];

/** Room for the 480x320 canvas and the controls under it, at one device pixel per CSS pixel. */
export const VIEWPORT = { width: 800, height: 700 };
export const DEVICE_SCALE_FACTOR = 1;

/** Every example renders a 480x320 canvas. */
export const CANVAS_SIZE = { width: 480, height: 320 };
