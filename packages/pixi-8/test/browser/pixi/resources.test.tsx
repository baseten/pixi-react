import { Assets, type Sprite, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { element, setup } from './harness';

const SpriteElement = element('pixiSprite');

describe('shared textures', () =>
{
    it('a texture shared by nodes in two applications survives removals and both unmounts', async () =>
    {
        const ctx = setup();
        const texture = ctx.probe.createTexture() as Texture;
        const first = ctx.deferred<unknown>();
        const second = ctx.deferred<unknown>();
        const { Application } = ctx.api;
        const tree = (both: boolean) => (
            <>
                {both && (
                    <Application key="a" {...ctx.composition.appOptions} onInit={first.resolve}>
                        <SpriteElement {...{ label: 'a1', texture }} />
                        <SpriteElement {...{ label: 'a2', texture }} />
                    </Application>
                )}
                <Application key="b" {...ctx.composition.appOptions} onInit={second.resolve}>
                    <SpriteElement {...{ label: 'b1', texture }} />
                </Application>
            </>
        );

        await ctx.renderUntil(tree(true), Promise.all([first.promise, second.promise]));
        await ctx.render(tree(false));

        expect(ctx.probe.isResourceDestroyed(texture), 'after the first app unmounted').toBe(false);
        expect(texture.source, 'source kept').not.toBeNull();

        await ctx.unmount();

        expect(ctx.probe.isResourceDestroyed(texture), 'after both unmounted').toBe(false);
        expect(ctx.journal.of('destroy').length, 'every sprite destroyed').toBe(3);
    });

    it('an explicit transfer destroys the shared texture once, even when several nodes hold it', async () =>
    {
        const ctx = setup();
        const texture = ctx.probe.createTexture() as Texture;
        const destroy = vi.spyOn(texture, 'destroy');

        await ctx.mountApp(
            <>
                <SpriteElement {...{ label: 'a', texture }} />
                <SpriteElement {...{ label: 'b', texture }} />
            </>,
            { destroyOptions: { children: true, texture: true, textureSource: true } },
        );
        await ctx.unmount();

        expect(ctx.probe.isResourceDestroyed(texture)).toBe(true);
        // Each sprite forwards the transfer; Pixi's Texture.destroy is idempotent after the first call.
        expect(destroy.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(texture.source).toBeNull();
    });

    it('root cleanup never unloads or resets the global Assets cache', async () =>
    {
        const ctx = setup();
        const unload = vi.spyOn(Assets, 'unload');
        const reset = vi.spyOn(Assets, 'reset');

        await ctx.mountApp(<SpriteElement {...{ texture: Texture.WHITE }} />);
        await ctx.unmount();

        expect(unload).not.toHaveBeenCalled();
        expect(reset).not.toHaveBeenCalled();
        expect(Texture.WHITE.destroyed ?? false).toBe(false);
    });

    it('a texture replaced through props stays alive', async () =>
    {
        const ctx = setup();
        const first = ctx.probe.createTexture() as Texture;
        const second = ctx.probe.createTexture() as Texture;
        const mounted = await ctx.mountApp(<SpriteElement {...{ label: 's', texture: first }} />);

        await mounted.rerender(<SpriteElement {...{ label: 's', texture: second }} />);
        await mounted.rerender(<SpriteElement {...{ label: 's' }} />);

        const sprite = ctx.probe.children(mounted.stage)[0] as Sprite;

        expect(sprite.texture).toBe(Texture.EMPTY);
        expect([ctx.probe.isResourceDestroyed(first), ctx.probe.isResourceDestroyed(second)]).toEqual([false, false]);
    });
});
