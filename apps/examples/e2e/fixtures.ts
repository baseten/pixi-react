/**
 * Shared fixtures of the example browser tests. Every test gets `example`, a driver for one route through the harness
 * hooks (`window.__EXAMPLE_CONTROL__`, `window.__EXAMPLE_STATE__`, `[data-testid="example"]`), and an automatic guard
 * that fails the test on:
 * - a console error or warning, or an uncaught exception, in the page;
 * - a request outside the local server (it is also blocked), or a local request that fails or returns 4xx/5xx.
 */
import { expect, type Locator, type Page, test as base } from '@playwright/test';

import type { ExampleBackend, ExampleState, StageNode } from '../src/harness/harness';

export { expect };

export type Rgba = [number, number, number, number];

export interface OpenOptions
{
    /** Test mode (stopped ticker, fixed steps, WebGL) unless false. */
    test?: boolean;
    backend?: ExampleBackend;
}

/** Finds a node of the stage tree by label, depth first. */
export function findNode(node: StageNode | null, label: string): StageNode | undefined
{
    if (!node) return undefined;
    if (node.label === label) return node;

    for (const child of node.children)
    {
        const found = findNode(child, label);

        if (found) return found;
    }

    return undefined;
}

export class ExamplePage
{
    readonly page: Page;
    readonly root: Locator;
    readonly canvas: Locator;

    constructor(page: Page)
    {
        this.page = page;
        this.root = page.getByTestId('example');
        this.canvas = this.root.locator('canvas');
    }

    /** Opens a route and waits until it is ready and its first frame is rendered. */
    async open(route: string, { test = true, backend }: OpenOptions = {}): Promise<ExampleState>
    {
        const query = test ? `?test${backend ? `&backend=${backend}` : ''}` : '';

        await this.page.goto(`/${route}${query}`);
        await this.ready();

        return this.state();
    }

    /** The rendered-frame readiness signal of the harness. */
    async ready(): Promise<void>
    {
        await expect(this.root).toHaveAttribute('data-status', 'ready');
        await expect(this.root).toHaveAttribute('data-first-frame', 'true');
    }

    state(): Promise<ExampleState>
    {
        return this.page.evaluate(() => window.__EXAMPLE_CONTROL__!.state());
    }

    stage(): Promise<StageNode | null>
    {
        return this.page.evaluate(() => window.__EXAMPLE_CONTROL__!.stage());
    }

    async node(label: string): Promise<StageNode>
    {
        const node = findNode(await this.stage(), label);

        expect(node, `the stage has a node labelled "${label}"`).toBeDefined();

        return node!;
    }

    /** Advances the stopped ticker by fixed 1/60 s steps (test mode). */
    step(frames = 1): Promise<ExampleState>
    {
        return this.page.evaluate((count) => window.__EXAMPLE_CONTROL__!.step(count), frames);
    }

    /** Renders the committed scene once, without ticking. */
    render(): Promise<ExampleState>
    {
        return this.page.evaluate(() => window.__EXAMPLE_CONTROL__!.render());
    }

    /** Waits until the live state matches; the failure message carries the last state. */
    async waitFor(description: string, predicate: (state: ExampleState) => boolean): Promise<ExampleState>
    {
        await expect.poll(async () => predicate(await this.state()), { message: description }).toBe(true);

        return this.state();
    }

    /** Waits until the example's reported `scene` has these values. */
    async waitForScene(expected: Record<string, unknown>): Promise<ExampleState>
    {
        await expect.poll(async () => (await this.state()).scene, { message: `scene ${JSON.stringify(expected)}` })
            .toMatchObject(expected);

        return this.state();
    }

    /** One canvas pixel, in canvas pixels from the top left (resolution 1 in test mode). Read back from the drawing buffer. */
    pixel(x: number, y: number): Promise<Rgba>
    {
        return this.canvas.evaluate((canvas: HTMLCanvasElement, [px, py]) =>
        {
            const copy = document.createElement('canvas');

            copy.width = canvas.width;
            copy.height = canvas.height;
            const context = copy.getContext('2d')!;

            context.drawImage(canvas, 0, 0);

            return [...context.getImageData(px, py, 1, 1).data] as Rgba;
        }, [x, y] as const);
    }

    /** A hash of every canvas pixel: equal hashes mean identical frames. */
    canvasHash(): Promise<string>
    {
        return this.canvas.evaluate((canvas: HTMLCanvasElement) =>
        {
            const copy = document.createElement('canvas');

            copy.width = canvas.width;
            copy.height = canvas.height;
            const context = copy.getContext('2d')!;

            context.drawImage(canvas, 0, 0);
            const data = context.getImageData(0, 0, copy.width, copy.height).data;
            // FNV-1a, 32 bit.
            let hash = 0x811c9dc5;

            for (let index = 0; index < data.length; index++)
            {
                hash ^= data[index];
                hash = Math.imul(hash, 0x01000193);
            }

            return `${copy.width}x${copy.height}:${(hash >>> 0).toString(16)}`;
        });
    }

    /** The WebGL context type and unmasked renderer string of the route's canvas, without creating a context. */
    webgl(): Promise<{ version: 'webgl2' | 'webgl' | null; renderer: string | null; lost: boolean | null }>
    {
        return this.canvas.evaluate((canvas: HTMLCanvasElement) =>
        {
            // getContext returns the canvas's existing context of that type, or null for another type.
            const gl2 = canvas.getContext('webgl2');
            const gl = gl2 ?? canvas.getContext('webgl');

            if (!gl) return { version: null, renderer: null, lost: null };
            const info = gl.getExtension('WEBGL_debug_renderer_info');

            return {
                version: gl2 ? 'webgl2' : 'webgl',
                renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
                lost: gl.isContextLost(),
            };
        });
    }
}

/** What the guard collected; tests that expect a specific problem can inspect and clear it. */
export interface PageGuard
{
    problems: string[];
    requests: string[];
}

export const test = base.extend<{ example: ExamplePage; guard: PageGuard }>({
    // The fixture callback is named `provide`, not Playwright's usual `use`, which lint reads as React's use().
    guard: [async ({ page, context, baseURL }, provide) =>
    {
        const local = new URL(baseURL!).origin;
        const guard: PageGuard = { problems: [], requests: [] };

        // Everything must come from the local server; data: and blob: URLs never reach the network.
        await context.route('**/*', (route) =>
        {
            const url = new URL(route.request().url());

            if (url.origin === local) return route.continue();
            guard.problems.push(`request outside ${local}: ${url.href}`);

            return route.abort('blockedbyclient');
        });
        page.on('request', (request) => guard.requests.push(request.url()));
        page.on('requestfailed', (request) =>
        {
            if (new URL(request.url()).origin === local) guard.problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
        });
        page.on('response', (response) =>
        {
            if (response.status() >= 400) guard.problems.push(`HTTP ${response.status()}: ${response.url()}`);
        });
        page.on('console', (message) =>
        {
            if (message.type() === 'error' || message.type() === 'warning')
            {
                guard.problems.push(`console.${message.type()}: ${message.text()}`);
            }
        });
        page.on('pageerror', (error) => guard.problems.push(`uncaught: ${error.message}`));

        await provide(guard);

        expect(guard.problems, 'console errors and warnings, uncaught errors, and non-local or failed requests').toEqual([]);
    }, { auto: true }],
    example: async ({ page }, provide) =>
    {
        await provide(new ExamplePage(page));
    },
});
