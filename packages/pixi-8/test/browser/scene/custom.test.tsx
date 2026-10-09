import { AlphaFilter, BlurFilter, Container, Graphics } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { element, setup } from './harness';

const ContainerElement = element('pixiContainer');

describe('custom instances', () =>
{
    it('a custom class needing constructor options gets them, keeps its own defaults and is destroyed once', async () =>
    {
        const ctx = setup();
        const seen: unknown[] = [];

        class Badge extends Container
        {
            readonly kind: string;

            constructor(options: { kind: string; label?: string; alpha?: number })
            {
                if (!options?.kind)
                {
                    throw new Error('Badge needs a kind');
                }

                super(options);
                seen.push(options);
                this.kind = options.kind;
                this.alpha = 0.3;
            }
        }

        ctx.renderer.extend({ Badge });
        const BadgeElement = element('pixiBadge');
        const mounted = await ctx.mountApp(<BadgeElement {...{ kind: 'gold', label: 'b', alpha: 0.9 }} />);
        const badge = ctx.probe.children(mounted.stage)[0] as Badge;

        expect(badge).toBeInstanceOf(Badge);
        expect(seen).toEqual([{ kind: 'gold', label: 'b', alpha: 0.9 }]);
        expect(badge.alpha).toBe(0.9);

        await mounted.rerender(<BadgeElement {...{ kind: 'gold', label: 'b' }} />);
        expect(badge.alpha, 'custom initial value restored').toBe(0.3);
        await mounted.rerender(null);
        expect(badge.destroyed).toBe(true);
        expect(seen).toHaveLength(1);
    });

    it('component(Ctor) registers a custom Graphics subclass whose draw runs on mount', async () =>
    {
        const ctx = setup();

        class Ring extends Graphics
        {}

        const name = ctx.renderer.component(Ring);
        const draw = vi.fn();
        const RingElement = element(name);
        const mounted = await ctx.mountApp(<RingElement {...{ draw }} />);

        expect(name).toMatch(/^component:\d+$/);
        expect(draw).toHaveBeenCalledWith(ctx.probe.children(mounted.stage)[0]);
    });

    it('filters attach in JSX order, reorder against the parent list and are destroyed without options', async () =>
    {
        const ctx = setup();
        const destroyed: unknown[][] = [];
        const tracked = <T extends new (...args: any[]) => { destroy(...args: unknown[]): void }>(Base: T) => class extends Base
        {
            destroy(...args: unknown[])
            {
                destroyed.push(args);
                super.destroy(...args);
            }
        };

        ctx.renderer.extend({ AlphaFilter: tracked(AlphaFilter), BlurFilter: tracked(BlurFilter) });
        const Alpha = element('pixiAlphaFilter');
        const Blur = element('pixiBlurFilter');
        const list = (order: string[]) => (
            <ContainerElement {...{ label: 'p' }}>
                {order.map((key) => (key.startsWith('a') ? <Alpha key={key} {...{ alpha: 0.5 }} /> : <Blur key={key} />))}
            </ContainerElement>
        );
        const mounted = await ctx.mountApp(list(['a1', 'b1']));
        const parent = ctx.probe.children(mounted.stage)[0] as Container;
        const [alpha, blur] = parent.filters as unknown as object[];

        expect(alpha).toBeInstanceOf(AlphaFilter);
        expect(blur).toBeInstanceOf(BlurFilter);
        await mounted.rerender(list(['b1', 'a1']));
        expect(parent.filters).toEqual([blur, alpha]);
        await mounted.rerender(list(['b1']));
        expect(parent.filters).toEqual([blur]);
        expect(destroyed).toEqual([[]]);
        await ctx.unmount();
        expect(destroyed).toEqual([[], []]);
    });

    it('Suspense-style hiding of a filter disables it and restores the committed enabled value', async () =>
    {
        const ctx = setup();
        const { AlphaFilter: Filter } = await import('pixi.js');

        ctx.renderer.extend({ AlphaFilter: Filter });
        const Alpha = element('pixiAlphaFilter');
        const mounted = await ctx.mountApp(<ContainerElement><Alpha {...{ enabled: false }} /></ContainerElement>);
        const [filter] = (ctx.probe.children(mounted.stage)[0] as Container).filters as unknown as AlphaFilter[];
        const record = ctx.renderer.runtime.roots()[0];

        await ctx.act(() => record.scene.setHidden(filter, true));
        await ctx.act(() => record.scene.setHidden(filter, false));
        expect(filter.enabled).toBe(false);
    });
});
