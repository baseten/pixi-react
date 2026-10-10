/**
 * Functional browser tests of every example route (issue 19), against the built app. They assert the scene through
 * the harness (state and stage tree), pixels read back from the canvas, and cleanup of the Pixi objects; the
 * automatic guard (fixtures.ts) fails any test that logs a console error or warning, throws, or leaves localhost.
 * The visual project (visual.spec.ts) adds pixel-exact screenshots on top; neither replaces the other.
 */
import { readFileSync } from 'node:fs';
import { CANVAS_SIZE } from './environment';
import { type ExamplePage, expect, type Rgba, test } from './fixtures';

const { examples } = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8')) as {
    examples: { id: string; title: string; composition: string }[];
};

const rgb = (hex: number): Rgba => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255];
const BACKGROUND = rgb(0x0f172a);

/** The canvas of a route in test mode: one canvas, 480x320, a WebGL context, no lost context. */
async function expectWebGLCanvas(example: ExamplePage)
{
    await expect(example.canvas).toHaveCount(1);
    expect(await example.canvas.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]))
        .toEqual([CANVAS_SIZE.width, CANVAS_SIZE.height]);
    const gl = await example.webgl();

    expect(gl.version, 'the canvas has a WebGL context').not.toBeNull();
    expect(gl.lost).toBe(false);
}

test.describe('every route', () =>
{
    for (const { id, composition } of examples)
    {
        test(`${id}: test mode reaches a rendered first frame on WebGL`, async ({ example }) =>
        {
            const state = await example.open(id);

            expect(state).toMatchObject({
                harnessVersion: 2,
                route: id,
                mode: 'test',
                backend: 'webgl',
                renderer: 'webgl',
                status: 'ready',
                firstFrame: true,
                frame: 0,
                initCount: 1,
                errors: [],
            });
            await expect(example.root).toHaveAttribute('data-example', id);
            await expect(example.root).toHaveAttribute('data-init-count', '1');
            await expectWebGLCanvas(example);
            expect((await example.stage())?.children.length, 'the scene committed nodes to the stage').toBeGreaterThan(0);
            expect((await example.step(5)).frame).toBe(5);
            await expect(example.root).toHaveAttribute('data-frame', '5');
            await expect(example.page.getByText(composition === 'facade' ? 'Facade: @pixi/react' : 'Explicit createRenderer composition')).toBeVisible();
        });

        test(`${id}: interactive mode renders with the running ticker`, async ({ example }) =>
        {
            const state = await example.open(id, { test: false });

            expect(state).toMatchObject({ route: id, mode: 'interactive', backend: null, status: 'ready', firstFrame: true, errors: [] });
            await expect(example.canvas).toHaveCount(1);
            await expect(example.page.evaluate(() => window.__EXAMPLE_CONTROL__!.step(1))).rejects.toThrow(/needs test mode/);
        });
    }

    test('the index lists every example, and an unknown route says so', async ({ page }) =>
    {
        await page.goto('/');
        await expect(page.getByTestId('index').locator('li a')).toHaveCount(examples.length);
        for (const { id, title } of examples)
        {
            await expect(page.getByTestId('index').getByRole('link', { name: title, exact: true })).toHaveAttribute('href', `/${id}`);
        }
        await page.goto('/no-such-example');
        await expect(page.getByTestId('not-found')).toBeVisible();
    });
});

test.describe('basic-scene: scene creation', () =>
{
    test('builds the panel and sprite from JSX and loads the local texture', async ({ example, guard, baseURL }) =>
    {
        const state = await example.open('basic-scene');

        expect(state.scene).toEqual({ textureLoaded: true });
        const panel = await example.node('panel');

        expect(panel).toMatchObject({ x: 80, y: 60 });
        expect(panel.children.map((child) => child.label)).toEqual(['background', 'token']);
        expect(await example.node('token')).toMatchObject({ x: 160, y: 100, scaleX: 2, scaleY: 2, visible: true });
        // The texture is the app's own file, from the local server (hashed in the build, as-is on the dev server,
        // which also serves the import as a module).
        const tokenOrigins = guard.requests
            .filter((url) => (/\/assets\/token(?:-[\w-]+)?\.png$/).test(new URL(url).pathname))
            .map((url) => new URL(url).origin);

        expect(new Set(tokenOrigins)).toEqual(new Set([new URL(baseURL!).origin]));
        // Background, the panel fill (between the border and the sprite) and the clear colour around it.
        expect(await example.pixel(5, 5)).toEqual(BACKGROUND);
        expect(await example.pixel(100, 80)).toEqual(rgb(0x1e293b));
        // The sprite covers the panel's centre: neither the background nor the panel fill.
        const centre = await example.pixel(240, 160);

        expect(centre).not.toEqual(rgb(0x1e293b));
        expect(centre).not.toEqual(BACKGROUND);
    });
});

test.describe('updates-and-events: interaction-driven updates', () =>
{
    const BUTTON = { x: 240, y: 140 };

    test('a Pixi pointer tap updates React state and adds children', async ({ example }) =>
    {
        await example.open('updates-and-events');
        expect((await example.state()).scene).toEqual({ clicks: 0, color: 'blue', hovered: false, markers: 0 });
        expect((await example.node('markers')).children).toEqual([]);
        await example.render();
        expect(await example.pixel(BUTTON.x, BUTTON.y)).toEqual(rgb(0x3b82f6));

        for (let click = 1; click <= 3; click++)
        {
            await example.canvas.click({ position: BUTTON });
            await example.waitForScene({ clicks: click, markers: click });
        }
        await expect(example.page.getByLabel('Clicks', { exact: true })).toHaveText('3');
        const markers = await example.node('markers');

        // Centred: 240 - (3 markers * 32) / 2.
        expect(markers.x).toBe(192);
        expect(markers.children.map((child) => [child.label, child.x])).toEqual([['marker-0', 4], ['marker-1', 36], ['marker-2', 68]]);
        await example.render();
        expect(await example.pixel(192 + 4 + 12, 240 + 12)).toEqual(rgb(0xe2e8f0));
    });

    test('pointer over and out change props; a tap outside the button does nothing', async ({ example }) =>
    {
        await example.open('updates-and-events');
        await example.canvas.hover({ position: BUTTON });
        await example.waitForScene({ hovered: true });
        expect(await example.node('button')).toMatchObject({ scaleX: 1.1, scaleY: 1.1 });
        await example.canvas.hover({ position: { x: 10, y: 10 } });
        await example.waitForScene({ hovered: false });
        expect(await example.node('button')).toMatchObject({ scaleX: 1, scaleY: 1 });

        await example.canvas.click({ position: { x: 10, y: 10 } });
        // React handles the DOM click after the canvas tap, so once the colour changes the tap was processed.
        await example.page.getByRole('button', { name: 'Change color' }).click();
        await example.waitForScene({ color: 'orange' });
        expect((await example.state()).scene).toMatchObject({ clicks: 0, markers: 0 });
    });

    test('DOM buttons update props and remove children', async ({ example }) =>
    {
        await example.open('updates-and-events');
        await example.canvas.click({ position: BUTTON });
        await example.canvas.click({ position: BUTTON });
        await example.waitForScene({ clicks: 2, markers: 2 });

        await example.page.getByRole('button', { name: 'Change color' }).click();
        await example.waitForScene({ color: 'orange' });
        await example.render();
        expect(await example.pixel(BUTTON.x, BUTTON.y)).toEqual(rgb(0xf97316));

        await example.page.getByRole('button', { name: 'Reset' }).click();
        await example.waitForScene({ clicks: 0, markers: 0 });
        expect((await example.node('markers')).children).toEqual([]);
        await example.render();
        expect(await example.pixel(240 - 16 + 4 + 12, 240 + 12), 'the removed marker is no longer drawn').toEqual(BACKGROUND);
    });
});

test.describe('custom-components: custom registration', () =>
{
    test('extend registers the Star class, and its setters receive prop updates', async ({ example }) =>
    {
        const state = await example.open('custom-components');

        expect(state.scene).toEqual({ points: 5 });
        const stars = await example.node('stars');

        expect(stars.y).toBe(160);
        // Constructed with the label from props; each Star owns a Graphics child built in its constructor.
        expect(stars.children.map((star) => [star.label, star.x, star.children.map((child) => child.label)])).toEqual([
            ['star-yellow', 100, ['star-shape']],
            ['star-pink', 240, ['star-shape']],
            ['star-green', 380, ['star-shape']],
        ]);
        // The default fillColor, and the fillColor props, reached the shapes.
        expect(await example.pixel(100, 160)).toEqual(rgb(0xfacc15));
        expect(await example.pixel(240, 160)).toEqual(rgb(0xf472b6));
        expect(await example.pixel(380, 160)).toEqual(rgb(0x4ade80));
        const initial = await example.canvasHash();

        await example.page.getByRole('button', { name: 'Add a point' }).click();
        await example.waitForScene({ points: 6 });
        await example.render();
        expect(await example.canvasHash(), 'the points setter redrew the stars').not.toBe(initial);
        // Same three nodes: a prop update goes through the setter, not a new instance.
        expect((await example.node('stars')).children.map((star) => star.label)).toEqual(['star-yellow', 'star-pink', 'star-green']);

        await example.page.getByRole('button', { name: 'Reset' }).click();
        await example.waitForScene({ points: 5 });
        await example.render();
        expect(await example.canvasHash(), 'back to the first frame').toBe(initial);
    });
});

test.describe('hooks-and-ticker: context, hooks and the ticker', () =>
{
    test('useApplication reads the app; useTick runs per fixed step and stops while disabled', async ({ example }) =>
    {
        const state = await example.open('hooks-and-ticker');

        expect(state.scene).toEqual({ screen: [480, 320], running: true });
        expect(await example.node('spinner')).toMatchObject({ x: 240, y: 160, rotation: 0 });
        const still = await example.canvasHash();

        // 60 fixed steps of deltaTime 1 at 0.05 rad each.
        expect((await example.step(60)).frame).toBe(60);
        expect((await example.node('spinner')).rotation).toBeCloseTo(3, 4);
        expect(await example.canvasHash(), 'each step renders').not.toBe(still);

        await example.page.getByRole('button', { name: 'Pause' }).click();
        await example.waitForScene({ running: false });
        const paused = await example.render().then(() => example.canvasHash());

        await example.step(10);
        expect((await example.node('spinner')).rotation, 'a disabled useTick callback does not run').toBeCloseTo(3, 4);
        expect(await example.canvasHash()).toBe(paused);

        await example.page.getByRole('button', { name: 'Resume' }).click();
        await example.waitForScene({ running: true });
        await example.step(10);
        expect((await example.node('spinner')).rotation).toBeCloseTo(3.5, 4);
    });

    test('in interactive mode the real ticker drives useTick', async ({ example }) =>
    {
        await example.open('hooks-and-ticker', { test: false });
        await expect.poll(async () => (await example.node('spinner')).rotation).toBeGreaterThan(0.5);
    });
});

/** A handle on the current canvas, to check after it is replaced that it was detached and its context released. */
async function captureCanvas(example: ExamplePage)
{
    const handle = await example.canvas.elementHandle();

    return async () =>
    {
        const result = await handle!.evaluate((canvas: HTMLCanvasElement) => ({
            connected: canvas.isConnected,
            lost: (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))?.isContextLost() ?? null,
        }));

        await handle!.dispose();

        return result;
    };
}

test.describe('init-and-unmount: initialization and cleanup', () =>
{
    test('onInit runs once per Application', async ({ example }) =>
    {
        await example.open('init-and-unmount');
        await expect(example.page.getByRole('list', { name: 'Initializations' }).getByRole('listitem'))
            .toHaveText(['1. Application 1: webgl 480x320']);
        expect(await example.node('badge')).toMatchObject({ x: 240, y: 160 });
        expect(await example.pixel(240, 160)).toEqual(rgb(0x14532d));
        expect(await example.pixel(240 + 56, 160)).toEqual(rgb(0x22c55e));
    });

    test('unmount destroys the application and removes the canvas; mount and key remount start fresh ones', async ({ example }) =>
    {
        await example.open('init-and-unmount');
        const log = example.page.getByRole('list', { name: 'Initializations' }).getByRole('listitem');

        for (let cycle = 0; cycle < 3; cycle++)
        {
            const before = (await example.state()).initCount;
            const released = await captureCanvas(example);

            await example.page.getByRole('button', { name: 'Unmount', exact: true }).click();
            await example.waitFor('unmounted', (state) => state.status === 'unmounted');
            await expect(example.canvas).toHaveCount(0);
            await expect(example.page.getByText('Unmounted: the canvas is removed')).toBeVisible();
            expect(await example.stage()).toBeNull();
            expect(await released(), 'the old canvas is detached and its WebGL context released').toEqual({ connected: false, lost: true });

            await example.page.getByRole('button', { name: 'Mount', exact: true }).click();
            await example.waitFor('mounted again', (state) => state.status === 'ready' && state.initCount === before + 1);
            await example.ready();
            await expectWebGLCanvas(example);
        }
        await expect(log).toHaveCount(4);

        const released = await captureCanvas(example);

        await example.page.getByRole('button', { name: 'Remount' }).click();
        await example.waitFor('remounted', (state) => state.status === 'ready' && state.initCount === 5);
        await example.ready();
        await expectWebGLCanvas(example);
        expect(await released(), 'a key change destroys the previous application').toEqual({ connected: false, lost: true });
        await expect(log).toHaveCount(5);
        await expect(log.last()).toHaveText('5. Application 2: webgl 480x320');
        expect(await example.node('badge')).toMatchObject({ x: 240, y: 160 });
        expect((await example.step(3)).frame).toBe(3);
    });
});

test.describe('modular-renderer: createRenderer and initialization errors', () =>
{
    test('the explicit composition renders and ticks', async ({ example }) =>
    {
        const state = await example.open('modular-renderer');

        expect(state.scene).toEqual({ composition: 'createRenderer' });
        expect(await example.node('scene')).toMatchObject({ x: 240, y: 160 });
        expect((await example.node('scene')).children.map((child) => child.label)).toEqual(['square']);
        await example.step(10);
        expect((await example.node('square')).rotation).toBeCloseTo(-0.4, 4);
        expect(await example.pixel(240 + 40, 160)).toEqual(rgb(0xf43f5e));
    });

    test('a failed init reports through onInitError, and a new Application recovers', async ({ example }) =>
    {
        await example.open('modular-renderer');
        const released = await captureCanvas(example);

        await example.page.getByRole('button', { name: 'Fail initialization' }).click();
        const failed = await example.waitFor('the failed init', (state) => state.status === 'error');

        expect(failed).toMatchObject({ initCount: 1, renderer: null, firstFrame: false, errors: ['Deliberate initialization failure'] });
        await expect(example.root).toHaveAttribute('data-status', 'error');
        await expect(example.page.getByRole('alert')).toHaveText('Initialization failed: Deliberate initialization failure');
        expect(await example.stage()).toBeNull();
        expect(await released(), 'the working application was destroyed before the failing one').toEqual({ connected: false, lost: true });

        // Failing again is reported again, not thrown.
        await example.page.getByRole('button', { name: 'Fail initialization' }).click();
        await example.waitFor('the second failure', (state) => state.errors.length === 2);

        await example.page.getByRole('button', { name: 'Retry' }).click();
        const recovered = await example.waitFor('the retry', (state) => state.status === 'ready' && state.firstFrame);

        expect(recovered).toMatchObject({ initCount: 2, renderer: 'webgl', frame: 0 });
        await expect(example.page.getByRole('alert')).toHaveCount(0);
        await expectWebGLCanvas(example);
        await example.step(10);
        expect((await example.node('square')).rotation).toBeCloseTo(-0.4, 4);
    });
});
