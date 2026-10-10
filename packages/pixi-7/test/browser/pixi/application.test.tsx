/**
 * Pixi 7's synchronous application construction, run by the session in `init`, and Pixi 7's destroy and ticker
 * semantics, against real applications in Chromium.
 */
import { Application, Container, extensions, TextStyle, Ticker, VERSION } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { appOptions } from '../binding';
import { setup } from './harness';

import type { Pixi7Types } from '../../../src/index';
import type { RootRecord } from '@pixi-react-provisional/core';

/** A plugin that throws while Pixi 7 constructs an application, after the ticker and resize plugins initialized. */
function failingPlugin(message: string)
{
    return {
        extension: { type: 'application', name: `failing-${message}`, priority: -2000 },
        init()
        {
            throw new Error(message);
        },
        destroy: vi.fn(),
    };
}

const ownKeys = (value: object) => Object.keys(value).sort();

describe(`application construction on pixi.js ${VERSION}`, () =>
{
    it('the session\'s application is the one Pixi 7\'s constructor builds: same fields, renderer, ticker and stage', async () =>
    {
        const ctx = setup();
        const { app } = await ctx.mountApp(null);
        const reference = new Application({ ...appOptions, view: document.createElement('canvas') });

        try
        {
            const built = app as Application;

            expect(built).toBeInstanceOf(Application);
            expect(ownKeys(built)).toEqual(ownKeys(reference));
            expect(built.renderer.constructor).toBe(reference.renderer.constructor);
            expect(built.stage).toBeInstanceOf(Container);
            expect(built.ticker).toBeInstanceOf(Ticker);
            expect(built.ticker).not.toBe(Ticker.shared);
            expect(built.ticker.started, 'autoStart: false').toBe(false);
            expect(built.view, 'renders into the root canvas').toBe(ctx.host.querySelector('canvas'));
            expect([built.screen.width, built.screen.height]).toEqual([64, 64]);
        }
        finally
        {
            reference.destroy(true);
        }
    });

    it('the application has one identity from root creation through initialization', async () =>
    {
        const ctx = setup();
        const record = ctx.renderer.runtime.createRoot(ctx.createSizedElement(32, 32)) as RootRecord<Pixi7Types>;
        const before = record.app;

        expect(before).toBeInstanceOf(Application);
        expect(before.stage, 'the stage exists before init, as on Pixi 8').toBeInstanceOf(Container);
        expect((before as { renderer?: unknown }).renderer, 'no renderer before init, as on Pixi 8').toBeUndefined();
        expect(record.applicationState).toMatchObject({ app: before, isInitialised: false });

        await ctx.act(() => record.initialise({ ...appOptions }));

        expect(record.app).toBe(before);
        expect(record.applicationState).toMatchObject({ app: before, isInitialised: true });
        expect(before.renderer).toBeTruthy();
        await ctx.act(() => record.dispose());
    });

    it('a plugin that throws during construction fails init, and the renderer and initialized plugins are destroyed', async () =>
    {
        const ctx = setup();
        const plugin = failingPlugin('construction failure');
        const extension = ctx.probe.globals!.createExtension('construction-failure');
        const fontSize = TextStyle.defaultStyle.fontSize;
        const onInitError = vi.fn();

        extensions.add(plugin as never);
        try
        {
            ctx.captureUnhandledRejections();
            await ctx.render(
                <ctx.api.Application {...appOptions} extensions={[extension]} defaultTextStyle={{ fontSize: 93 }} onInitError={onInitError} />,
            );
            await ctx.waitFor(() => onInitError.mock.calls.length > 0);
        }
        finally
        {
            extensions.remove(plugin as never);
        }

        const [record] = ctx.renderer.runtime.roots();
        const app = record.app as Application & { _ticker?: unknown };

        expect(onInitError.mock.calls[0][0]).toMatchObject({ message: 'construction failure' });
        expect(app.renderer, 'renderer destroyed').toBeNull();
        expect(app._ticker, 'the ticker plugin was destroyed').toBeNull();
        expect(plugin.destroy, 'the throwing plugin is destroyed too').toHaveBeenCalledTimes(1);
        expect(ctx.probe.globals!.isExtensionActive(extension), 'extension lease released').toBe(false);
        expect(TextStyle.defaultStyle.fontSize, 'default style writer released').toBe(fontSize);
        expect(ctx.journal.of('app.destroy'), 'Application.destroy is never called on an app that did not initialize').toEqual([]);
        await ctx.unmount();
        expect(ctx.renderer.runtime.roots()).toEqual([]);
    });
});

describe(`application destroy on pixi.js ${VERSION}`, () =>
{
    it.each([
        [undefined, undefined],
        [true, true],
        [false, false],
        [{ removeView: true }, true],
        [{ removeView: false }, false],
    ])('rendererDestroyOptions %j becomes Pixi 7\'s removeView %j; destroyOptions are forwarded unchanged', async (rendererDestroyOptions, removeView) =>
    {
        const ctx = setup();
        const destroyOptions = { children: true };
        const { app } = await ctx.mountApp(null, { destroyOptions, rendererDestroyOptions });

        await ctx.unmount();

        expect(ctx.journal.of('app.destroy').filter((entry) => entry.app === app).map((entry) => entry.args))
            .toEqual([[removeView, destroyOptions]]);
    });

    it('Pixi 8-only renderer destroy options are reported, not silently dropped', async () =>
    {
        const ctx = setup();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { app } = await ctx.mountApp(null, { rendererDestroyOptions: { removeView: false, releaseGlobalResources: true } });

        await ctx.unmount();

        expect(ctx.journal.of('app.destroy').filter((entry) => entry.app === app).map((entry) => entry.args[0])).toEqual([false]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('`releaseGlobalResources` is a Pixi 8 option'));
        warn.mockRestore();
    });
});

describe(`ticker on pixi.js ${VERSION}`, () =>
{
    it('useTick receives Pixi 7\'s numeric frame delta, with `this` as the context', async () =>
    {
        const ctx = setup();
        const calls: Array<{ delta: unknown; self: unknown; ticker: number }> = [];
        const context = { name: 'context' };
        const ticker: { current?: Ticker } = {};
        const Ticking = () =>
        {
            ctx.api.useTick({
                callback(this: unknown, delta: unknown)
                {
                    calls.push({ delta, self: this, ticker: ticker.current!.deltaTime });
                },
                context,
            });

            return null;
        };
        const { app } = await ctx.mountApp(<Ticking />);

        ticker.current = (app as Application).ticker;
        await ctx.tick(app);

        expect(calls).toHaveLength(1);
        expect(typeof calls[0].delta).toBe('number');
        expect(calls[0].delta).toBe(calls[0].ticker);
        expect(calls[0].self).toBe(context);
    });
});
