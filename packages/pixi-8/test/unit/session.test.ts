import { describe, expect, it, vi } from 'vitest';
import { DefaultStyleRegistry, ExtensionLeaseTable } from '../../src/globals';
import { detectFeatures } from '../../src/nodes';
import { Pixi8Session, type SessionGlobals } from '../../src/session';
import { PIXI8_BOUNDARIES } from '../../src/version';
import { cells } from './cells';

/**
 * The WebGPU device workaround of `Pixi8Session` (pixi.js before 8.21 never destroys the `GPUDevice` its renderer
 * created, pixijs/pixijs#12173), against a fake `Application` whose renderer is WebGPU or WebGL. Real WebGPU teardown is
 * covered by the conformance scenario `application.webgpu-device-lifecycle` on the WebGPU compatibility cells.
 */

interface FakeDevice
{
    destroy: ReturnType<typeof vi.fn>;
}

const device = (): FakeDevice => ({ destroy: vi.fn() });

interface FakeRenderer
{
    name: string;
    gpu?: { adapter: object; device: FakeDevice };
    destroy: ReturnType<typeof vi.fn>;
}

interface Setup
{
    /** The renderer the next application creates. */
    backend?: 'webgpu' | 'webgl';
    /** pixi.js >= 8.21: Pixi destroys its own device. */
    destroysOwnGpuDevice?: boolean;
    /** Application.init creates the renderer, then throws (a failing plugin). */
    failAfterRenderer?: boolean;
    /** Pixi uses the device the application supplied as `gpu` (pixi.js 8.12+), instead of creating one. */
    honoursSuppliedGpu?: boolean;
}

function setup({ backend = 'webgpu', destroysOwnGpuDevice = false, failAfterRenderer = false, honoursSuppliedGpu = true }: Setup = {})
{
    const order: string[] = [];
    const renderers: FakeRenderer[] = [];

    class FakeApplication
    {
        renderer: FakeRenderer | null = null;

        async init(options: { gpu?: { adapter: object; device: FakeDevice }; webgpu?: { gpu?: { adapter: object; device: FakeDevice } } })
        {
            const supplied = options.webgpu?.gpu ?? options.gpu;
            const gpu = backend === 'webgpu' ? (honoursSuppliedGpu && supplied) || { adapter: {}, device: device() } : undefined;
            const renderer: FakeRenderer = {
                name: backend,
                ...(gpu ? { gpu } : {}),
                destroy: vi.fn(() =>
                {
                    order.push('renderer.destroy');
                    // Pixi's GpuDeviceSystem clears `gpu` when the renderer is destroyed.
                    delete renderer.gpu;
                }),
            };

            gpu?.device.destroy.mockImplementation(() => order.push('device.destroy'));
            renderers.push(renderer);
            this.renderer = renderer;

            if (failAfterRenderer)
            {
                throw new Error('plugin failure');
            }
        }

        destroy()
        {
            this.renderer?.destroy();
            this.renderer = null;
            order.push('app.destroy');
        }
    }

    const reportError = vi.fn();
    const globals = {
        pixi: { Application: FakeApplication, TextStyle: class {} },
        nodes: { features: { destroysOwnGpuDevice } },
        extensions: new ExtensionLeaseTable({ add: vi.fn(), remove: vi.fn() } as never),
        defaultStyle: new DefaultStyleRegistry({}),
        reportError,
    } as unknown as SessionGlobals;

    const session = () => new Pixi8Session(globals, {} as HTMLCanvasElement);

    return { session, renderers, order, reportError };
}

const signal = () => new AbortController().signal;

describe('Pixi8Session: the WebGPU device of a renderer it created', () =>
{
    it('destroys the device once per teardown, after Pixi destroyed the application', async () =>
    {
        const { session, renderers, order } = setup();

        for (let i = 0; i < 3; i++)
        {
            const s = session();

            await s.init({}, signal());
            s.destroy(undefined);
            s.destroy(undefined);
        }

        expect(renderers).toHaveLength(3);
        expect(order).toEqual(Array.from({ length: 3 }, () => ['renderer.destroy', 'app.destroy', 'device.destroy']).flat());
    });

    it('destroys each renderer\'s own device', async () =>
    {
        const { session, renderers } = setup();
        const devices: FakeDevice[] = [];

        for (let i = 0; i < 2; i++)
        {
            const s = session();

            await s.init({}, signal());
            devices.push(renderers[i].gpu!.device);
            s.destroy(undefined);
        }

        expect(devices[0]).not.toBe(devices[1]);
        devices.forEach((d) => expect(d.destroy).toHaveBeenCalledTimes(1));
    });

    it('never destroys a device the application supplied as gpu or webgpu.gpu', async () =>
    {
        for (const key of ['gpu', 'webgpu'] as const)
        {
            const { session } = setup();
            const supplied = { adapter: {}, device: device() };
            const s = session();

            await s.init((key === 'gpu' ? { gpu: supplied } : { webgpu: { gpu: supplied } }) as never, signal());
            s.destroy(undefined);

            expect(supplied.device.destroy).not.toHaveBeenCalled();
        }
    });

    it('destroys Pixi\'s own device when Pixi ignored a supplied gpu (pixi.js before 8.12)', async () =>
    {
        const { session, renderers } = setup({ honoursSuppliedGpu: false });
        const supplied = { adapter: {}, device: device() };
        const s = session();

        await s.init({ gpu: supplied } as never, signal());
        s.destroy(undefined);

        expect(supplied.device.destroy).not.toHaveBeenCalled();
        expect(renderers[0].gpu).toBeUndefined();
        expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a WebGL renderer', async () =>
    {
        const { session, order } = setup({ backend: 'webgl' });
        const s = session();

        await s.init({}, signal());
        s.destroy(undefined);

        expect(order).toEqual(['renderer.destroy', 'app.destroy']);
    });

    it('leaves the device to Pixi from pixi.js 8.21 (destroysOwnGpuDevice)', async () =>
    {
        const { session, order } = setup({ destroysOwnGpuDevice: true });
        const s = session();

        await s.init({}, signal());
        s.destroy(undefined);

        expect(order).toEqual(['renderer.destroy', 'app.destroy']);
    });

    it('destroys the device of a renderer whose application failed to initialize after creating it', async () =>
    {
        const { session, order, reportError } = setup({ failAfterRenderer: true });
        const s = session();

        await expect(s.init({}, signal())).rejects.toThrow('plugin failure');
        s.destroy(undefined);

        expect(order).toEqual(['renderer.destroy', 'device.destroy']);
        expect(reportError).not.toHaveBeenCalled();
    });

    it('still destroys the device when Pixi\'s destroy throws, and reports both failures together', async () =>
    {
        const { session, renderers, order } = setup();
        const s = session();

        await s.init({}, signal());
        renderers[0].destroy.mockImplementation(() =>
        {
            throw new Error('renderer destroy failure');
        });

        expect(() => s.destroy(undefined)).toThrow('renderer destroy failure');
        expect(order).toEqual(['device.destroy']);
    });
});

describe('destroysOwnGpuDevice boundary', () =>
{
    it('is pixi.js 8.21.0, the first release whose GpuDeviceSystem destroys its device', () =>
    {
        expect(PIXI8_BOUNDARIES.destroysOwnGpuDevice).toBe('8.21.0');
        expect(detectFeatures({ VERSION: '8.20.1' }).destroysOwnGpuDevice).toBe(false);
        expect(detectFeatures({ VERSION: '8.21.0' }).destroysOwnGpuDevice).toBe(true);
        // An unparseable version: the adapter destroys the device, harmless if Pixi does too (destroy is idempotent).
        expect(detectFeatures({ VERSION: 'x' }).destroysOwnGpuDevice).toBe(false);
    });

    it('matches each tested pixi.js: GpuDeviceSystem.destroy destroys the device exactly from the boundary', () =>
    {
        for (const { pixi, version } of cells)
        {
            const { GpuDeviceSystem } = pixi as unknown as { GpuDeviceSystem: { prototype: { destroy(this: object): void } } };
            const destroy = vi.fn();
            const system = { gpu: { device: { destroy } }, _options: {}, _renderer: {} };

            GpuDeviceSystem.prototype.destroy.call(system);

            expect(destroy.mock.calls.length > 0, version).toBe(detectFeatures(pixi).destroysOwnGpuDevice);
        }
    });
});
