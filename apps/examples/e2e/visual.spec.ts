/**
 * Canvas screenshots of the examples in the pinned WebGL environment (issue 19), compared with Playwright's
 * `toHaveScreenshot` against the reviewed baselines in e2e/snapshots/visual-linux. Each case drives the route to a
 * fixed state with the stopped ticker and fixed steps, checks that state through the harness first (so a renderer
 * that draws the same pixels from a broken scene still fails), then compares the canvas alone: no page text or fonts.
 *
 * Tolerances are in playwright.config.ts. CI never writes a baseline; see README.md, "Visual baselines".
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireBaselinePlatform } from './baseline';
import { BASELINE_PLATFORM } from './environment';
import { type ExamplePage, expect, test } from './fixtures';

interface VisualCase
{
    /** The snapshot file: e2e/snapshots/visual-linux/<name>.png. */
    name: string;
    route: string;
    /** Drives the route from its first frame to the state under test, and checks that state. */
    arrange?: (example: ExamplePage) => Promise<void>;
    /** The harness errors expected at the end: none, except a deliberate failure. */
    errors?: string[];
}

const cases: VisualCase[] = [
    {
        name: 'basic-scene',
        route: 'basic-scene',
        arrange: async (example) =>
        {
            expect((await example.state()).scene).toEqual({ textureLoaded: true });
        },
    },
    {
        name: 'updates-and-events-initial',
        route: 'updates-and-events',
    },
    {
        name: 'updates-and-events-clicked-orange',
        route: 'updates-and-events',
        arrange: async (example) =>
        {
            for (let click = 1; click <= 3; click++)
            {
                await example.canvas.click({ position: { x: 240, y: 140 } });
                await example.waitForScene({ clicks: click });
            }
            await example.page.getByRole('button', { name: 'Change color' }).click();
            // Move the pointer off the button so it is drawn at scale 1.
            await example.canvas.hover({ position: { x: 10, y: 10 } });
            await example.waitForScene({ clicks: 3, markers: 3, color: 'orange', hovered: false });
        },
    },
    {
        name: 'custom-components-initial',
        route: 'custom-components',
    },
    {
        name: 'custom-components-six-points',
        route: 'custom-components',
        arrange: async (example) =>
        {
            await example.page.getByRole('button', { name: 'Add a point' }).click();
            await example.waitForScene({ points: 6 });
        },
    },
    {
        name: 'hooks-and-ticker-15-steps',
        route: 'hooks-and-ticker',
        arrange: async (example) =>
        {
            await example.step(15);
            expect((await example.node('spinner')).rotation).toBeCloseTo(0.75, 4);
        },
    },
    {
        name: 'init-and-unmount-remounted',
        route: 'init-and-unmount',
        arrange: async (example) =>
        {
            await example.page.getByRole('button', { name: 'Remount' }).click();
            await example.waitFor('the remount', (state) => state.status === 'ready' && state.firstFrame && state.initCount === 2);
            await expect(example.canvas).toHaveCount(1);
        },
    },
    {
        name: 'modular-renderer-recovered-10-steps',
        route: 'modular-renderer',
        arrange: async (example) =>
        {
            await example.page.getByRole('button', { name: 'Fail initialization' }).click();
            await example.waitFor('the failed init', (state) => state.status === 'error');
            await example.page.getByRole('button', { name: 'Retry' }).click();
            await example.waitFor('the retry', (state) => state.status === 'ready' && state.firstFrame && state.initCount === 2);
            await example.step(10);
            expect((await example.node('square')).rotation).toBeCloseTo(-0.4, 4);
        },
        errors: ['Deliberate initialization failure'],
    },
];

test.beforeEach(() => requireBaselinePlatform());

for (const { name, route, arrange, errors = [] } of cases)
{
    test(name, async ({ example }) =>
    {
        const initial = await example.open(route);

        expect(initial).toMatchObject({ mode: 'test', renderer: 'webgl', status: 'ready', firstFrame: true });
        await arrange?.(example);
        // Draw the committed scene: React updates commit after the last step or render.
        const state = await example.render();

        expect(state).toMatchObject({ status: 'ready', firstFrame: true, errors });
        await expect(example.canvas).toHaveScreenshot(`${name}.png`);
        expect(await example.canvas.boundingBox(), 'the capture style is gone after the screenshot').not.toMatchObject({ x: 0, y: 0 });
    });
}

test('every committed baseline belongs to a case, and every case has one', () =>
{
    const directory = fileURLToPath(new URL(`./snapshots/visual-${BASELINE_PLATFORM}`, import.meta.url));
    const baselines = readdirSync(directory).filter((file) => file.endsWith('.png')).sort();

    expect(baselines).toEqual(cases.map(({ name }) => `${name}.png`).sort());
});
