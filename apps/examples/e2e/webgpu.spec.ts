/**
 * WebGPU smoke test (issue 19): NOT required and NOT deterministic, so it takes no screenshots and is kept out of the
 * WebGL visual baselines. It checks that the routes initialise, render and tick on Pixi's WebGPU renderer when the
 * browser offers a WebGPU adapter (Dawn on SwiftShader under WEBGPU_ARGS). Without an adapter each test is skipped
 * with that reason, and scripts/check-report.mjs prints it in the job summary.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

const { examples } = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url), 'utf8')) as {
    examples: { id: string }[];
};

test.beforeEach(async ({ page, guard }) =>
{
    await page.goto('/');
    const adapter = await page.evaluate(async () =>
    {
        if (!('gpu' in navigator)) return 'navigator.gpu is undefined';
        const gpu = (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu;

        return (await gpu.requestAdapter()) ? null : 'navigator.gpu.requestAdapter() returned null';
    });

    if (adapter === null) return;
    // Chromium logs this warning when it has no adapter to give; it is the probe's, not the app's.
    guard.problems = guard.problems.filter((problem) => !problem.includes('Failed to create WebGPU Context Provider'));
    test.skip(true, `No WebGPU adapter in this browser: ${adapter}`);
});

for (const { id } of examples)
{
    test(`${id} renders on WebGPU`, async ({ example }) =>
    {
        const state = await example.open(id, { backend: 'webgpu' });

        expect(state).toMatchObject({ mode: 'test', backend: 'webgpu', renderer: 'webgpu', status: 'ready', firstFrame: true, errors: [] });
        expect(await example.webgl(), 'the canvas has no WebGL context').toMatchObject({ version: null });
        expect((await example.stage())?.children.length).toBeGreaterThan(0);
        expect((await example.step(5)).frame).toBe(5);
    });
}
