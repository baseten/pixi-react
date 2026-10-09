import { TextStyle } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { element, setup } from './harness';

import type { ReactNode } from 'react';

const TextElement = element('pixiText');

describe('multiple applications', () =>
{
    it('share one extension lease: it stays registered until the last application using it unmounts', async () =>
    {
        const ctx = setup();
        const extension = ctx.probe.globals!.createExtension('shared');
        const { Application } = ctx.api;
        const a = ctx.deferred<unknown>();
        const b = ctx.deferred<unknown>();
        const tree = (showA: boolean, showB: boolean) => (
            <>
                {showA && <Application key="a" {...ctx.composition.appOptions} extensions={[extension]} onInit={a.resolve} />}
                {showB && <Application key="b" {...ctx.composition.appOptions} extensions={[extension]} onInit={b.resolve} />}
            </>
        );

        await ctx.renderUntil(tree(true, true), Promise.all([a.promise, b.promise]));
        await ctx.render(tree(false, true));
        await ctx.waitFor(() => ctx.renderer.runtime.roots().length === 1);
        expect(ctx.probe.globals!.isExtensionActive(extension), 'after A left').toBe(true);
        await ctx.render(tree(false, false));
        expect(ctx.probe.globals!.isExtensionActive(extension), 'after B left').toBe(false);
    });

    it('default text style: the last explicit writer wins, and a departing writer restores the survivor', async () =>
    {
        const ctx = setup();
        const baseline = TextStyle.defaultTextStyle.fontSize;
        const { Application } = ctx.api;
        const a = ctx.deferred<unknown>();
        const b = ctx.deferred<unknown>();
        const app = (key: string, fontSize: number, onInit: (app: unknown) => void, children?: ReactNode) => (
            <Application key={key} {...ctx.composition.appOptions} defaultTextStyle={{ fontSize }} onInit={onInit}>{children}</Application>
        );

        await ctx.renderUntil(app('a', 30, a.resolve), a.promise);
        await ctx.renderUntil(<>{app('a', 30, a.resolve)}{app('b', 40, b.resolve)}</>, b.promise);
        expect(TextStyle.defaultTextStyle.fontSize).toBe(40);

        // B leaves: A's value returns. Text created afterwards in A uses it.
        await ctx.render(<>{app('a', 30, a.resolve)}</>);
        // Unmounting an Application defers its teardown by one scheduled turn (StrictMode remount window).
        await ctx.waitFor(() => ctx.renderer.runtime.roots().length === 1);
        await ctx.render(<>{app('a', 30, a.resolve, <TextElement {...{ label: 't', text: 't' }} />)}</>);
        expect(TextStyle.defaultTextStyle.fontSize).toBe(30);
        expect((ctx.probe.children(ctx.probe.stage(await a.promise))[0] as { style: TextStyle }).style.fontSize).toBe(30);

        await ctx.unmount();
        expect(TextStyle.defaultTextStyle.fontSize).toBe(baseline);
    });

    it('keep separate tickers, scenes and teardown', async () =>
    {
        const ctx = setup();
        const { Application } = ctx.api;
        const a = ctx.deferred<unknown>();
        const b = ctx.deferred<unknown>();
        const ticks: string[] = [];
        const Ticking = ({ name }: { name: string }) =>
        {
            ctx.api.useTick(() => ticks.push(name));

            return null;
        };
        const tree = (showA: boolean) => (
            <>
                {showA && <Application key="a" {...ctx.composition.appOptions} onInit={a.resolve}><Ticking name="a" /></Application>}
                <Application key="b" {...ctx.composition.appOptions} onInit={b.resolve}><Ticking name="b" /></Application>
            </>
        );

        await ctx.renderUntil(tree(true), Promise.all([a.promise, b.promise]));
        const [appA, appB] = [await a.promise, await b.promise];

        expect(appA).not.toBe(appB);
        await ctx.tick(appA, 16);
        expect(ticks).toEqual(['a']);
        await ctx.render(tree(false));
        expect(ctx.probe.isAppDestroyed(appA)).toBe(true);
        expect(ctx.probe.isAppDestroyed(appB)).toBe(false);
        await ctx.tick(appB, 16);
        expect(ticks).toEqual(['a', 'b']);
    });
});
