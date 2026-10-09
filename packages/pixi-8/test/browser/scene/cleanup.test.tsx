import { TextStyle } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { element, setup } from './harness';

const ContainerElement = element('pixiContainer');

describe('repeated cleanup', () =>
{
    it('unmounting a createRoot root twice returns the same settled teardown and destroys the app once', async () =>
    {
        const ctx = setup();
        const ready = ctx.deferred<unknown>();
        const root = ctx.api.createRoot(ctx.createSizedElement(64, 64), { onInit: ready.resolve });

        await ctx.act(async () =>
        {
            void root.render(<ContainerElement {...{ label: 'x' }} />, { ...ctx.composition.appOptions });
            await ready.promise;
        });

        const app = await ready.promise;
        const first = root.unmount!() as Promise<void>;
        const second = root.unmount!();

        void first.catch(() => undefined);

        expect(second).toBe(first);
        await ctx.act(() => first);
        await ctx.act(() => root.unmount!());

        expect(ctx.journal.appDestroyCount(app as object)).toBe(1);
        expect(ctx.journal.of('destroy').length).toBe(1);
    });

    it('a session destroyed twice destroys the application once and releases its leases once', async () =>
    {
        const ctx = setup();
        const extension = ctx.probe.globals!.createExtension('twice');
        const { app } = await ctx.mountApp(null, { extensions: [extension], defaultTextStyle: { fontSize: 77 } });
        const [record] = ctx.renderer.runtime.roots();

        expect(TextStyle.defaultTextStyle.fontSize).toBe(77);
        await ctx.unmount();
        await ctx.act(() => record.dispose());
        await record.session.destroy(undefined);

        expect(ctx.journal.appDestroyCount(app as object)).toBe(1);
        expect(ctx.probe.globals!.isExtensionActive(extension)).toBe(false);
        expect(TextStyle.defaultTextStyle.fontSize).not.toBe(77);
    });

    it('mount/unmount cycles leave no listeners, leases, roots or style writers behind', async () =>
    {
        const ctx = setup();
        const extension = ctx.probe.globals!.createExtension('cycles');
        const baseline = { ...TextStyle.defaultTextStyle };

        for (let cycle = 0; cycle < 3; cycle++)
        {
            const { app } = await ctx.mountApp(<ContainerElement {...{ label: `c${cycle}` }} />, {
                extensions: [extension],
                defaultTextStyle: { fontSize: 50 + cycle },
            });

            expect(ctx.probe.globals!.isExtensionActive(extension)).toBe(true);
            await ctx.unmount();
            expect(ctx.probe.isAppDestroyed(app)).toBe(true);
        }

        expect(ctx.probe.globals!.isExtensionActive(extension)).toBe(false);
        expect({ ...TextStyle.defaultTextStyle }).toEqual(baseline);
        expect(ctx.renderer.runtime.roots()).toEqual([]);
    });

    it('a runtime disposed twice tears every root down once', async () =>
    {
        const ctx = setup();
        const { app } = await ctx.mountApp(<ContainerElement />);
        const first = ctx.renderer.runtime.dispose();

        expect(ctx.renderer.runtime.dispose()).toBe(first);
        await ctx.act(() => first);
        expect(ctx.journal.appDestroyCount(app as object)).toBe(1);
    });
});
