#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Smoke test of the built examples app (issue 18): serves dist/ with `vite preview` and loads every route in headless
 * Chromium, in test mode and interactive mode. Each page must reach `ready` with a rendered first frame, log no
 * console error or uncaught error, and request nothing outside the local server (other origins are blocked and
 * reported). A few route checks exercise the test hooks. Issue 19 replaces this with the Playwright Test suite; add a
 * check to `checks` below to extend it meanwhile.
 *
 * Usage: node scripts/smoke.mjs (after `vite build`), or node scripts/smoke.mjs --dev to run against the dev server
 * (development React, StrictMode effect replays and dev-only warnings). Set PLAYWRIGHT_BROWSERS_PATH if Chromium is
 * installed elsewhere.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const { examples } = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8'));
const TIMEOUT = 20_000;

const ready = (page) => page.waitForSelector('[data-testid="example"][data-status="ready"][data-first-frame="true"]', { timeout: TIMEOUT });
const state = (page) => page.evaluate(() => window.__EXAMPLE_CONTROL__.state());
const stage = (page) => page.evaluate(() => window.__EXAMPLE_CONTROL__.stage());
const step = (page, frames) => page.evaluate((count) => window.__EXAMPLE_CONTROL__.step(count), frames);
const find = (node, label) => (node.label === label ? node : node.children.map((child) => find(child, label)).find(Boolean));

function expect(condition, message)
{
    if (!condition) throw new Error(message);
}

async function waitForState(page, predicate, description)
{
    try
    {
        await page.waitForFunction(predicate, undefined, { timeout: TIMEOUT });
    }
    catch
    {
        throw new Error(`timed out waiting for ${description}; state: ${JSON.stringify(await state(page))}`);
    }
}

/** Route checks in test mode, after the first frame. Keep them small: issue 19 owns the real assertions. */
const checks = {
    'basic-scene': async (page) =>
    {
        expect((await state(page)).scene.textureLoaded === true, 'the local texture loaded');
        expect(find(await stage(page), 'token'), 'the stage has the token sprite');
    },
    'updates-and-events': async (page) =>
    {
        const canvas = page.locator('[data-testid="example"] canvas');

        await canvas.click({ position: { x: 240, y: 140 } });
        await waitForState(page, () => window.__EXAMPLE_STATE__.scene.clicks === 1, 'one click');
        await page.getByRole('button', { name: 'Change color' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.scene.color === 'orange', 'the color change');
        await page.getByRole('button', { name: 'Reset' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.scene.clicks === 0, 'the reset');
    },
    'custom-components': async (page) =>
    {
        await page.getByRole('button', { name: 'Add a point' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.scene.points === 6, 'six points');
        expect(find(await stage(page), 'star-pink'), 'the stage has the custom Star nodes');
    },
    'hooks-and-ticker': async (page) =>
    {
        const before = find(await stage(page), 'spinner').rotation;

        await step(page, 60);
        const after = find(await stage(page), 'spinner').rotation;

        // 60 fixed steps of deltaTime 1 at 0.05 rad each.
        expect(Math.abs(after - before - 3) < 1e-3, `60 steps rotate the spinner by 3 rad (got ${after - before})`);
        await page.getByRole('button', { name: 'Pause' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.scene.running === false, 'the pause');
        await step(page, 10);
        expect(find(await stage(page), 'spinner').rotation === after, 'a disabled useTick callback does not run');
    },
    'init-and-unmount': async (page) =>
    {
        await page.getByRole('button', { name: 'Unmount', exact: true }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.status === 'unmounted', 'the unmount');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="example"] canvas').length === 0, undefined, { timeout: TIMEOUT });
        await page.getByRole('button', { name: 'Mount', exact: true }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.status === 'ready' && window.__EXAMPLE_STATE__.initCount === 2, 'the second init');
        await page.getByRole('button', { name: 'Remount' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.status === 'ready' && window.__EXAMPLE_STATE__.initCount === 3, 'the remount');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="example"] canvas').length === 1, undefined, { timeout: TIMEOUT });
    },
    'modular-renderer': async (page) =>
    {
        expect(find(await stage(page), 'square'), 'the createRenderer scene rendered');
        await page.getByRole('button', { name: 'Fail initialization' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.status === 'error', 'the failed initialization');
        expect(await page.getByRole('alert').isVisible(), 'the error is shown');
        await page.getByRole('button', { name: 'Retry' }).click();
        await waitForState(page, () => window.__EXAMPLE_STATE__.status === 'ready' && window.__EXAMPLE_STATE__.firstFrame, 'the retry');
    },
};

const dev = process.argv.includes('--dev');
const server = dev
    ? await (await createServer({ root: appRoot, server: { port: 0, strictPort: false }, logLevel: 'warn' })).listen()
    : await preview({ root: appRoot, preview: { port: 0, strictPort: false }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const local = new URL(base);
const browser = await chromium.launch();
const failures = [];
let passed = 0;

async function visit(path, run)
{
    const context = await browser.newContext({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const remote = [];

    // Everything must come from the preview server; data: and blob: URLs never reach the network.
    await context.route('**/*', (route) =>
    {
        const url = new URL(route.request().url());

        if (url.origin === local.origin || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
        remote.push(url.href);

        return route.abort('blockedbyclient');
    });
    page.on('console', (message) =>
    {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

    try
    {
        await page.goto(`${base}${path}`);
        await run(page);
        expect(remote.length === 0, `requests outside ${local.origin}: ${remote.join(', ')}`);
        expect(errors.length === 0, errors.join('\n'));
        passed += 1;
        console.log(`ok   ${path}`);
    }
    catch (error)
    {
        failures.push(`${path}: ${error.message}`);
        console.log(`FAIL ${path}\n     ${error.message.split('\n').join('\n     ')}`);
    }
    finally
    {
        await context.close();
    }
}

try
{
    await visit('/', async (page) =>
    {
        await page.waitForSelector('[data-testid="index"]');
        expect(await page.locator('[data-testid="index"] li a').count() === examples.length, 'the index lists every example');
    });
    for (const example of examples)
    {
        await visit(`/${example.id}?test`, async (page) =>
        {
            await ready(page);
            const initial = await state(page);

            expect(initial.mode === 'test' && initial.route === example.id, `test mode for ${example.id}`);
            expect((await step(page, 5)).frame === 5, 'step() advances the frame counter');
            await checks[example.id]?.(page);
            expect((await state(page)).errors.length === 0 || example.id === 'modular-renderer', `harness errors: ${(await state(page)).errors}`);
        });
        await visit(`/${example.id}`, async (page) =>
        {
            await ready(page);
            expect((await state(page)).mode === 'interactive', 'interactive mode');
        });
    }
    await visit('/no-such-example', async (page) =>
    {
        await page.waitForSelector('[data-testid="not-found"]');
    });
}
finally
{
    await browser.close();
    await server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed (${dev ? 'dev server' : 'production build'})`);
if (failures.length) process.exit(1);
