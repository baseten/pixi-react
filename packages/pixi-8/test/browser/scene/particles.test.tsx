import * as pixi from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { element, setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

import type { OptionalPixiExports, ParticleContainerLike, ParticleLike } from '../../../src/index';

const optional = pixi as unknown as OptionalPixiExports;
const hasParticles = typeof optional.Particle === 'function';
const atLeast810 = (() =>
{
    const [major, minor] = pixi.VERSION.split('.').map(Number);

    return major > 8 || (major === 8 && minor >= 10);
})();

/** Errors thrown or reported by React, with act's AggregateErrors flattened. */
const leaves = (errors: unknown[]): unknown[] =>
    errors.flatMap((error) => (error instanceof AggregateError ? leaves(error.errors) : [error]));

const ContainerAround = () => null;
const ParticleContainerElement = element('pixiParticleContainer');
const ParticleElement = element('pixiParticle');

describe.runIf(hasParticles)(`Particle on pixi.js ${pixi.VERSION}`, () =>
{
    const extendParticles = (ctx: ReturnType<typeof setup>) =>
        ctx.renderer.extend({ ParticleContainer: optional.ParticleContainer!, Particle: optional.Particle! });
    const particles = (keys: string[]) => (
        <ParticleContainerElement {...{ label: 'pc' }}>
            {keys.map((key) => <ParticleElement key={key} {...{ texture: pixi.Texture.WHITE, x: key.charCodeAt(0) }} />)}
        </ParticleContainerElement>
    );

    it('mounts, reorders and removes particles through the ParticleContainer API, never addChild', async () =>
    {
        const ctx = setup();

        expect(ctx.adapter.manifest.provides['pixi8.particle']).toBe(1);
        extendParticles(ctx);
        const mounted = await ctx.mountApp(particles(['a', 'b', 'c']));
        const container = ctx.probe.children(mounted.stage)[0] as unknown as ParticleContainerLike & pixi.Container;
        const xs = () => container.particleChildren.map((particle) => (particle as unknown as { x: number }).x);

        expect(container.children).toEqual([]);
        expect(xs()).toEqual([97, 98, 99]);
        await mounted.rerender(particles(['c', 'a', 'b']));
        expect(xs()).toEqual([99, 97, 98]);
        await mounted.rerender(particles(['c', 'b']));
        expect(xs(), 'exactly one particle removed (explicit indices across the 8.10 change)').toEqual([99, 98]);
        await mounted.rerender(null);
        expect(container.destroyed).toBe(true);
        expect(pixi.Texture.WHITE.destroyed ?? false, 'shared texture kept').toBe(false);
        await ctx.unmount();
    });

    it('unmounting the application with particles destroys the container once and keeps borrowed textures', async () =>
    {
        const ctx = setup();

        extendParticles(ctx);
        const texture = ctx.probe.createTexture() as pixi.Texture;
        const mounted = await ctx.mountApp(
            <ParticleContainerElement><ParticleElement {...{ texture }} /><ParticleElement {...{ texture }} /></ParticleContainerElement>,
        );
        const container = ctx.probe.children(mounted.stage)[0] as pixi.Container;

        await ctx.unmount();
        expect(container.destroyed).toBe(true);
        expect(ctx.probe.isResourceDestroyed(texture)).toBe(false);
    });

    it('a particle outside a ParticleContainer is rejected before any mutation', async () =>
    {
        const ctx = setup();

        extendParticles(ctx);
        const errors = ctx.captureConsoleErrors();
        const mounted = await ctx.mountApp(<ContainerAround />);
        let thrown: unknown;

        try
        {
            await mounted.rerender(<ParticleElement {...{ texture: pixi.Texture.WHITE }} />);
        }
        catch (error)
        {
            thrown = error;
        }

        const all = leaves([thrown, ...errors.flat()]);
        const reported = all.find((error) => error instanceof CompatibilityError);

        expect(reported).toMatchObject({ code: 'UNSUPPORTED_NODE' });
        expect(all.filter((error) => error instanceof TypeError), 'rejected by the attach rule, not by a failed call').toEqual([]);
        expect(ctx.probe.children(mounted.stage)).toEqual([]);
    });

    it(`the adapter's removeParticles removes [begin, end) on ${pixi.VERSION}; raw Pixi differs across 8.10`, () =>
    {
        const ctx = setup();
        const fill = () =>
        {
            const container = new optional.ParticleContainer!() as unknown as ParticleContainerLike;

            for (let index = 0; index < 4; index++)
            {
                container.addParticle(new optional.Particle!({ texture: pixi.Texture.WHITE }) as unknown as ParticleLike);
            }

            return container;
        };
        const viaAdapter = fill();
        const [, second, third] = viaAdapter.particleChildren;

        expect(ctx.adapter.removeParticles(viaAdapter, 1, 3)).toEqual([second, third]);
        expect(viaAdapter.particleChildren).toHaveLength(2);

        const rawRange = fill();

        rawRange.removeParticles(1, 3);
        expect(rawRange.particleChildren, 'raw (1, 3)').toHaveLength(atLeast810 ? 2 : 1);

        const rawOpenEnded = fill();

        rawOpenEnded.removeParticles(1);
        expect(rawOpenEnded.particleChildren, 'raw (1)').toHaveLength(atLeast810 ? 1 : 4);
    });
});

describe(`capability-gated special nodes on pixi.js ${pixi.VERSION}`, () =>
{
    it('advertises exactly the special-node capabilities the installed Pixi exports', () =>
    {
        const { manifest } = setup().adapter;

        expect(manifest.provides['pixi8.particle'] ?? null).toBe(hasParticles ? 1 : null);
        expect(manifest.provides['pixi8.render-layer'] ?? null).toBe(typeof optional.RenderLayer === 'function' ? 1 : null);
        expect(manifest.provides['pixi8.dom-container'] ?? null).toBe(typeof optional.DOMContainer === 'function' ? 1 : null);
        expect(manifest.pixi.installed).toBe(pixi.VERSION);
    });

    it.runIf(typeof optional.RenderLayer === 'function')('mounts a RenderLayer leaf and rejects JSX children of it', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ RenderLayer: optional.RenderLayer! });
        const Layer = element('pixiRenderLayer');
        const Sprite = element('pixiSprite');
        const mounted = await ctx.mountApp(<Layer {...{ label: 'layer' }} />);

        expect(ctx.probe.children(mounted.stage)[0]).toBeInstanceOf(optional.RenderLayer!);

        const errors = ctx.captureConsoleErrors();
        let thrown: unknown;

        try
        {
            await mounted.rerender(<Layer {...{ label: 'layer' }}><Sprite /></Layer>);
        }
        catch (error)
        {
            thrown = error;
        }

        expect(leaves([thrown, ...errors.flat()]).some((error) => error instanceof CompatibilityError && error.code === 'UNSUPPORTED_NODE')).toBe(true);
    });

    it.runIf(typeof optional.DOMContainer === 'function')('mounts a DOMContainer with a caller-owned element', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ DOMContainer: optional.DOMContainer! });
        const span = document.createElement('span');
        const Dom = element('pixiDOMContainer');
        const mounted = await ctx.mountApp(<Dom {...{ element: span }} />);
        const node = ctx.probe.children(mounted.stage)[0] as unknown as { element: HTMLElement };

        expect(node.element).toBe(span);
        await ctx.unmount();
    });

    it('a withheld or unavailable capability is a CompatibilityError at registration, never a silent no-op', () =>
    {
        const ctx = setup({ disable: ['pixi8.particle', 'pixi8.render-layer', 'pixi8.dom-container'] });

        for (const name of ['Particle', 'ParticleContainer', 'RenderLayer', 'DOMContainer'] as const)
        {
            const ctor = optional[name];

            if (typeof ctor !== 'function')
            {
                continue;
            }

            let error: unknown;

            try
            {
                ctx.renderer.extend({ [name]: ctor });
            }
            catch (caught)
            {
                error = caught;
            }

            expect(error, name).toBeInstanceOf(CompatibilityError);
            expect(error, name).toMatchObject({ code: 'UNSUPPORTED_NODE' });
            expect(ctx.renderer.runtime.registry.has(name), name).toBe(false);
        }
    });
});
