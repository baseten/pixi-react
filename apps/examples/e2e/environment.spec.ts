/**
 * The environment guard of the visual project. The baselines are only meaningful in the environment they were
 * rendered in (e2e/environment.ts); when the browser, the WebGL backend or the device scale differ, this fails with
 * the difference instead of letting every snapshot fail with pixel noise, or worse, pass on a different backend.
 */
import { createRequire } from 'node:module';
import { requireBaselinePlatform } from './baseline';
import {
    CHROMIUM_VERSION,
    DEVICE_SCALE_FACTOR,
    PLAYWRIGHT_VERSION,
    VIEWPORT,
    WEBGL_RENDERER_PATTERN,
} from './environment';
import { expect, test } from './fixtures';

const require = createRequire(import.meta.url);

test.beforeEach(() => requireBaselinePlatform());

test('the pinned browser, WebGL backend and device scale', async ({ example, browser, browserName }) =>
{
    expect((require('@playwright/test/package.json') as { version: string }).version, 'Playwright Test').toBe(PLAYWRIGHT_VERSION);
    expect(browserName).toBe('chromium');
    expect(browser.version(), 'the bundled Chromium of the pinned Playwright').toBe(CHROMIUM_VERSION);

    await example.open('basic-scene');
    const gl = await example.webgl();

    expect(gl.version).toBe('webgl2');
    expect(gl.renderer ?? '', 'WebGL runs on SwiftShader (software), not a GPU').toMatch(WEBGL_RENDERER_PATTERN);
    expect(await example.page.evaluate(() => ({
        devicePixelRatio: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
    }))).toEqual({ devicePixelRatio: DEVICE_SCALE_FACTOR, ...VIEWPORT });
});
