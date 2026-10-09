import * as pixi from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { element, setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

import type { OptionalPixiExports } from '../../../src/index';

const optional = pixi as unknown as OptionalPixiExports;
const Sprite = element('pixiSprite');
const Blur = element('pixiBlurFilter');

/** Errors thrown or reported by React, with act's AggregateErrors flattened. */
const leaves = (errors: unknown[]): unknown[] =>
    errors.flatMap((error) => (error instanceof AggregateError ? leaves(error.errors) : [error]));

interface SplitLike extends pixi.Container
{
    text: string;
    lines: pixi.Container[];
    chars: pixi.Container[];
}

const classes = [
    { name: 'SplitText', ctor: optional.SplitText, props: { text: 'hi there', style: { fontSize: 12 } } },
    { name: 'SplitBitmapText', ctor: optional.SplitBitmapText, props: { text: 'hi there', style: { fontSize: 12, fontFamily: 'Arial' } } },
];

describe.each(classes)('$name', ({ name, ctor, props }) =>
{
    // `describe.each` titles cannot see the version; the per-version cell name carries it.
    describe.runIf(typeof ctor === 'function')(`${name} on pixi.js ${pixi.VERSION}`, () =>
    {
        const Split = element(`pixi${name}`);
        const register = (ctx: ReturnType<typeof setup>) => ctx.renderer.extend({ [name]: ctor! });

        it('is a leaf for children and accepts filters', () =>
        {
            const ctx = setup();

            register(ctx);
            expect(ctx.adapter.describe(ctor!, name).attach).toEqual({ role: 'child', accepts: ['filter'] });
        });

        it('mounts, updates text and unmounts, keeping the generated children', async () =>
        {
            const ctx = setup();

            register(ctx);
            const mounted = await ctx.mountApp(<Split {...props} />);
            const node = ctx.probe.children(mounted.stage)[0] as unknown as SplitLike;

            expect(node).toBeInstanceOf(ctor!);
            expect(node.text).toBe('hi there');
            expect(node.lines).toHaveLength(1);
            expect(node.children).toEqual(node.lines);

            await mounted.rerender(<Split {...{ ...props, text: 'one\ntwo\nthree' }} />);
            expect(node.text).toBe('one\ntwo\nthree');
            expect(node.lines).toHaveLength(3);
            expect(node.children).toEqual(node.lines);
            expect(node.destroyed).toBe(false);

            await mounted.rerender(null);
            expect(node.destroyed).toBe(true);
            await ctx.unmount();
        });

        it('removing the text prop never constructs a new instance and keeps the current text', async () =>
        {
            const ctx = setup();

            register(ctx);
            const mounted = await ctx.mountApp(<Split {...{ ...props, alpha: 0.5 }} />);
            const node = ctx.probe.children(mounted.stage)[0] as unknown as SplitLike;
            const warn = ctx.captureConsoleErrors();

            await mounted.rerender(<Split {...{ style: props.style }} />);
            expect(ctx.probe.children(mounted.stage)[0], 'same node').toBe(node);
            expect(node.alpha, 'a Container prop is restored').toBe(1);
            expect(node.text, 'no default text exists, so the value is kept').toBe('hi there');
            expect(warn.flat()).toEqual([]);
        });

        it('rejects React children with UNSUPPORTED_NODE before any mutation', async () =>
        {
            const ctx = setup();

            register(ctx);
            const mounted = await ctx.mountApp(<Split {...props} />);
            const node = ctx.probe.children(mounted.stage)[0] as unknown as SplitLike;
            const added: unknown[] = [];

            for (const method of ['addChild', 'addChildAt'] as const)
            {
                const original = node[method].bind(node) as (...args: unknown[]) => unknown;

                (node as any)[method] = (...args: unknown[]) =>
                {
                    added.push(...args);

                    return original(...args);
                };
            }

            const errors = ctx.captureConsoleErrors();
            let thrown: unknown;

            try
            {
                await mounted.rerender(<Split {...props}><Sprite {...{ label: 'child' }} /></Split>);
            }
            catch (error)
            {
                thrown = error;
            }

            const all = leaves([thrown, ...errors.flat()]);

            expect(all.some((error) => error instanceof CompatibilityError && error.code === 'UNSUPPORTED_NODE')).toBe(true);
            expect(all.filter((error) => error instanceof TypeError)).toEqual([]);
            expect(added, 'no child was ever attached').toEqual([]);
        });

        it('a filter attaches to the filters list and survives text updates', async () =>
        {
            const ctx = setup();

            ctx.renderer.extend({ BlurFilter: pixi.BlurFilter });
            register(ctx);
            const mounted = await ctx.mountApp(<Split {...props}><Blur /></Split>);
            const node = ctx.probe.children(mounted.stage)[0] as unknown as SplitLike;

            expect(node.filters).toHaveLength(1);
            expect((node.filters as pixi.Filter[])[0]).toBeInstanceOf(pixi.BlurFilter);
            await mounted.rerender(<Split {...{ ...props, text: 'a b c' }}><Blur /></Split>);
            expect(node.filters).toHaveLength(1);
            expect(node.children).toEqual(node.lines);
            await mounted.rerender(<Split {...{ ...props, text: 'a b c' }} />);
            expect(node.filters ?? []).toHaveLength(0);
        });
    });
});
