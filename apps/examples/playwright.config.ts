/**
 * Browser tests of the examples app (issue 19). See README.md, "Browser tests".
 *
 * Projects:
 * - `functional`: every route, in test and interactive mode: scene state, events, cleanup, console and network.
 * - `visual`: canvas screenshots (`toHaveScreenshot`) in the pinned WebGL/SwiftShader environment, plus a guard
 *   test that fails when the environment differs from the one the baselines were rendered in.
 * - `webgpu-smoke`: not required, not deterministic and never part of a baseline. Run it on its own.
 *
 * The server is the production build (`vite preview` of dist/), or the dev server with EXAMPLES_SERVER=dev.
 */
import { DEVICE_SCALE_FACTOR, VIEWPORT, WEBGL_ARGS, WEBGPU_ARGS } from './e2e/environment';
import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;
const dev = process.env.EXAMPLES_SERVER === 'dev';
// Ports of their own, so a running `pnpm dev` (5180) is never mistaken for the server under test.
const port = dev ? 5182 : 5181;

export default defineConfig({
    testDir: './e2e',
    outputDir: './.playwright/test-results',
    // e2e/snapshots/<project>-<platform>/<name>.png. Only `visual-linux` is committed (see e2e/environment.ts).
    snapshotPathTemplate: '{testDir}/snapshots/{projectName}-{platform}/{arg}{ext}',
    fullyParallel: true,
    forbidOnly: ci,
    // No retries: a retry would hide a flaky snapshot or a race, and both are bugs here.
    retries: 0,
    workers: ci ? 2 : undefined,
    timeout: 30_000,
    globalTimeout: ci ? 15 * 60_000 : undefined,
    // CI never writes a baseline: a missing or different snapshot fails. Locally a missing one is written (and the
    // test still fails), for a person to review and commit.
    updateSnapshots: ci ? 'none' : 'missing',
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            // Antialiasing is off, so a shape edge either covers a pixel or not: any moved, missing or recoloured
            // geometry changes whole pixels, and maxDiffPixels 0 fails on the first one. threshold 0.01 (pixelmatch's
            // YIQ distance) only absorbs a 1-2 level rounding difference in a channel, as texture filtering or
            // blending could produce; every intended colour in the examples is far further apart than that.
            maxDiffPixels: 0,
            threshold: 0.01,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            // Pins the canvas to the top left corner while capturing: whole-pixel clip, independent of page fonts.
            stylePath: './e2e/screenshot.css',
        },
    },
    reporter: [
        [ci ? 'github' : 'list'],
        ...(ci ? [['list'] as const] : []),
        ['html', { open: 'never', outputFolder: './.playwright/report' }],
        // Read by scripts/check-report.mjs: required projects must run every test, none skipped.
        ['json', { outputFile: './.playwright/results.json' }],
    ],
    use: {
        baseURL: `http://localhost:${port}`,
        browserName: 'chromium',
        headless: true,
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        colorScheme: 'dark',
        locale: 'en-US',
        timezoneId: 'UTC',
        launchOptions: { args: WEBGL_ARGS },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [
        { name: 'functional', testMatch: 'routes.spec.ts' },
        { name: 'visual', testMatch: ['environment.spec.ts', 'visual.spec.ts'] },
        { name: 'webgpu-smoke', testMatch: 'webgpu.spec.ts', use: { launchOptions: { args: WEBGPU_ARGS } } },
    ],
    webServer: {
        command: dev ? `pnpm exec vite --port ${port} --strictPort` : `pnpm exec vite preview --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        // Always start a fresh server, so a stale build or another app is never under test.
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
