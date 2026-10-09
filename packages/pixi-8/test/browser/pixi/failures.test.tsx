import { extensions, TextStyle } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { element, setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

describe('failures', () =>
{
    it('an initialization failure releases the extension leases and the default style writer it acquired', async () =>
    {
        const ctx = setup();
        const extension = ctx.probe.globals!.createExtension('init-failure');
        const fontSize = TextStyle.defaultTextStyle.fontSize;
        const attempt = ctx.probe.failNextInit(new Error('init failure'));
        const onInitError = vi.fn();

        ctx.captureUnhandledRejections();
        await ctx.render(
            <ctx.api.Application {...ctx.composition.appOptions} extensions={[extension]}
                defaultTextStyle={{ fontSize: 91 }} onInitError={onInitError} />,
        );
        await ctx.actUntil(attempt.settled);

        expect(onInitError).toHaveBeenCalledTimes(1);
        expect(onInitError.mock.calls[0][0]).toMatchObject({ message: 'init failure' });
        expect(ctx.probe.globals!.isExtensionActive(extension), 'extension after failure').toBe(false);
        expect(TextStyle.defaultTextStyle.fontSize, 'default font size after failure').toBe(fontSize);
        // Nothing was initialized, so nothing is destroyed: Application.destroy would throw on a bare app.
        expect(ctx.journal.of('app.destroy')).toEqual([]);

        await ctx.unmount();
        expect(ctx.renderer.runtime.roots()).toEqual([]);
    });

    it('an extension that Pixi rejects fails initialization and rolls back only that attempt\'s leases', async () =>
    {
        const ctx = setup();
        const kept = ctx.probe.globals!.createExtension('kept');
        const broken = { extension: { type: 'no-such-type-handler' } };
        const add = extensions.add.bind(extensions);
        const spy = vi.spyOn(extensions, 'add').mockImplementation((...items) =>
        {
            if (items.includes(broken))
            {
                throw new Error('extension rejected');
            }

            return add(...items);
        });
        const onInitError = vi.fn();

        ctx.captureUnhandledRejections();
        await ctx.render(
            <ctx.api.Application {...ctx.composition.appOptions} extensions={[kept, broken]} onInitError={onInitError} />,
        );
        await ctx.actUntil(Promise.resolve());
        await ctx.waitFor(() => onInitError.mock.calls.length > 0);
        spy.mockRestore();

        expect(onInitError.mock.calls[0][0]).toMatchObject({ message: 'extension rejected' });
        expect(ctx.probe.globals!.isExtensionActive(kept)).toBe(false);
        expect(ctx.journal.appInits(), 'Application.init never ran').toEqual([]);
    });

    it('a teardown step that throws does not stop the others; the error reaches the caller', async () =>
    {
        const ctx = setup();
        const extension = ctx.probe.globals!.createExtension('teardown');
        const target = ctx.createSizedElement(64, 64);
        const ready = ctx.deferred<unknown>();
        const root = ctx.api.createRoot(target, { onInit: ready.resolve });

        await ctx.act(async () =>
        {
            void root.render(null, { ...ctx.composition.appOptions, extensions: [extension] });
            await ready.promise;
        });

        const app = (await ready.promise) as { destroy(...args: unknown[]): void };
        const destroy = vi.spyOn(app, 'destroy').mockImplementation(() =>
        {
            throw new Error('app.destroy failed');
        });
        let failure: unknown;

        await ctx.act(async () =>
        {
            await (root.unmount!() as Promise<void>).catch((error: unknown) =>
            {
                failure = error;
            });
        });
        destroy.mockRestore();

        expect(String((failure as AggregateError).errors?.map((error) => (error as Error).message))).toMatch(/app\.destroy failed/);
        expect(ctx.probe.globals!.isExtensionActive(extension), 'lease released despite the failure').toBe(false);
        expect(ctx.renderer.runtime.roots()).toEqual([]);
    });

    it('registry checks throw CompatibilityError for resources and unknown elements', async () =>
    {
        const ctx = setup();
        const { Texture, GraphicsContext } = await import('pixi.js');

        for (const ctor of [Texture, GraphicsContext])
        {
            let error: unknown;

            try
            {
                ctx.renderer.extend({ Resource: ctor });
            }
            catch (caught)
            {
                error = caught;
            }

            expect(error).toBeInstanceOf(CompatibilityError);
            expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE', adapterIds: ['pixi-8'] });
        }

        expect(() => ctx.renderer.runtime.registry.resolve('pixiNeverExtended')).toThrow(CompatibilityError);
    });

    it('a node whose props throw after construction is destroyed before the error propagates', async () =>
    {
        const ctx = setup();
        const { Container } = await import('pixi.js');
        const created: Array<{ destroyed: boolean }> = [];
        const Throwing = class extends Container
        {
            constructor(options: object)
            {
                super(options);
                created.push(this);
                Object.defineProperty(this, 'explode', { get: () => undefined, set() { throw new Error('prop failed'); } });
            }
        };

        ctx.renderer.extend({ Throwing });
        const errors = ctx.captureConsoleErrors();
        const mounted = await ctx.mountApp(null);
        const Element = element('pixiThrowing');

        let thrown: unknown;

        try
        {
            await mounted.rerender(<Element {...{ explode: 1 }} />);
        }
        catch (error)
        {
            thrown = error;
        }

        // React retries a failed render once; every attempt's node is destroyed.
        expect(created.length).toBeGreaterThan(0);
        expect(created.map((node) => node.destroyed)).toEqual(created.map(() => true));
        expect([String(thrown), ...errors.flat().map(String)].join(' ')).toMatch(/prop failed/);
    });
});
