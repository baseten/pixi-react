/**
 * WebGPU cells (`webgpu-*` in vitest.browser.workspace.mts): Chromium with software WebGPU (Dawn on SwiftShader), the
 * adapter asking Pixi for a WebGPU renderer. They cover the device lifecycle: pixi.js before 8.21 never destroys the
 * `GPUDevice` its renderer created (pixijs/pixijs#12173), so the adapter does, and a device the application supplied
 * stays the application's. The whole conformance catalogue on WebGPU runs in the nightly compatibility cells.
 */
import { VERSION } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createPixi8Binding, createPixi8Composition } from '../binding';
import { createScenarioContext, describeConformance, scenarios } from '@pixi-react-provisional/conformance';

const WEBGPU = Object.freeze({ preference: 'webgpu' });

interface GpuSpies
{
    readonly requested: object[];
    readonly destroyed: Set<object>;
}

type RequestDevice = (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>;

const cleanups: Array<() => unknown> = [];

afterEach(async () =>
{
    for (const cleanup of cleanups.splice(0).reverse())
    {
        await cleanup();
    }
});

/** Records every device requested and destroyed until the end of the test. */
function spyOnDevices(): GpuSpies
{
    const spies: GpuSpies = { requested: [], destroyed: new Set() };
    const { requestDevice } = GPUAdapter.prototype;
    const { destroy } = GPUDevice.prototype;

    GPUAdapter.prototype.requestDevice = async function spiedRequestDevice(this: GPUAdapter, descriptor?: GPUDeviceDescriptor)
    {
        const device = await requestDevice.call(this, descriptor);

        spies.requested.push(device);

        return device;
    };
    GPUDevice.prototype.destroy = function spiedDestroy(this: GPUDevice)
    {
        spies.destroyed.add(this);
        destroy.call(this);
    };
    cleanups.push(() =>
    {
        GPUAdapter.prototype.requestDevice = requestDevice;
        GPUDevice.prototype.destroy = destroy;
    });

    return spies;
}

function setup()
{
    const composition = createPixi8Composition({}, WEBGPU);
    const handle = createScenarioContext(composition);

    cleanups.push(async () =>
    {
        try
        {
            await handle.cleanup();
        }
        finally
        {
            await composition.dispose();
        }
    });

    return handle.context;
}

describe(`WebGPU on pixi.js ${VERSION}`, () =>
{
    it('renders on WebGPU (the lifecycle scenario below is not vacuous)', async () =>
    {
        const ctx = setup();
        const { app } = await ctx.mountApp(null);

        expect((app as { renderer: { name: string } }).renderer.name).toBe('webgpu');
        expect(ctx.probe.gpuDevice?.(app)).toBeInstanceOf(GPUDevice);
    });

    it('destroys the device Pixi created on unmount, once', async () =>
    {
        const ctx = setup();
        const spies = spyOnDevices();
        const { app } = await ctx.mountApp(null);
        const device = ctx.probe.gpuDevice!(app)!;

        expect(spies.requested).toContain(device);
        await ctx.unmount();
        expect(spies.destroyed.has(device)).toBe(true);
    });

    it('never destroys a device the application supplied as gpu', async () =>
    {
        const ctx = setup();
        const adapter = (await navigator.gpu.requestAdapter())!;
        const supplied = { adapter, device: await adapter.requestDevice() };
        const spies = spyOnDevices();
        const { app } = await ctx.mountApp(null, { gpu: supplied });
        // pixi.js before 8.12 ignores `gpu` and creates its own device, which the adapter destroys.
        const own = ctx.probe.gpuDevice!(app)!;

        await ctx.unmount();

        expect(spies.destroyed.has(supplied.device), 'supplied device').toBe(false);
        expect(spies.destroyed.has(own), 'renderer device').toBe(own !== supplied.device);
        supplied.device.destroy();
    });

    it('rejects the mount promptly when requestDevice fails, and the next application initializes', async () =>
    {
        const ctx = setup();

        // Pixi's one-time isWebGPUSupported() check must already have passed, or Pixi falls back to WebGL.
        await ctx.mountApp(null);
        await ctx.unmount();

        const { requestDevice } = GPUAdapter.prototype;
        const failure = new DOMException(
            'Failed to execute \'requestDevice\' on \'GPUAdapter\': D3D12 create command queue failed with E_OUTOFMEMORY (0x8007000E)',
            'OperationError',
        );

        GPUAdapter.prototype.requestDevice = (() => Promise.reject(failure)) as RequestDevice;
        cleanups.push(() =>
        {
            GPUAdapter.prototype.requestDevice = requestDevice;
        });
        ctx.captureConsoleErrors();
        const errors: unknown[] = [];
        const started = performance.now();

        await expect(ctx.mountApp(null, { onInitError: (error: unknown) => errors.push(error) })).rejects.toBe(failure);
        expect(performance.now() - started, 'ms until the mount rejected').toBeLessThan(5_000);
        expect(errors).toEqual([failure]);

        GPUAdapter.prototype.requestDevice = requestDevice;
        await ctx.unmount();
        const { app } = await ctx.mountApp(null);

        expect(ctx.probe.gpuDevice?.(app)).toBeInstanceOf(GPUDevice);
    });
});

// The lifecycle scenarios on WebGPU, including the 40 sequential applications of `Application.lifecycle.webgpu-devices`.
describeConformance(createPixi8Binding(VERSION, WEBGPU), {
    scenarios: scenarios.filter((scenario) => scenario.feature === 'Application.lifecycle'),
    timeout: 60_000,
});
