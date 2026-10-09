import * as pixi from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { element, setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

const px = pixi as unknown as Record<string, any>;
const Sprite = element('pixiSprite');
const Blur = element('pixiBlurFilter');

/** Errors thrown or reported by React, with act's AggregateErrors flattened. */
const leaves = (errors: unknown[]): unknown[] =>
    errors.flatMap((error) => (error instanceof AggregateError ? leaves(error.errors) : [error]));

type Harness = ReturnType<typeof setup>;

interface MeshCase
{
    name: string;
    ctor: (new (options: any) => pixi.Mesh) | undefined;
    /** The options the class cannot be constructed without. */
    required: (ctx: Harness) => Record<string, unknown>;
    /** A second value for a prop that matters, and a check that it reached the node. */
    update: (ctx: Harness) => { props: Record<string, unknown>; check: (node: any) => void };
}

const points = (length: number) => Array.from({ length }, (_, index) => new pixi.Point(index * 10, 0));
const texture = (ctx: Harness) => ctx.probe.createTexture() as pixi.Texture;
const meshGeometry = () => new pixi.MeshGeometry({
    positions: new Float32Array([0, 0, 10, 0, 10, 10]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
});

const cases: MeshCase[] = [
    {
        name: 'Mesh',
        ctor: px.Mesh,
        required: (ctx) => ({ geometry: meshGeometry(), texture: texture(ctx) }),
        update: (ctx) =>
        {
            const next = texture(ctx);

            return { props: { texture: next }, check: (node) => expect(node.texture).toBe(next) };
        },
    },
    {
        name: 'MeshPlane',
        ctor: px.MeshPlane,
        required: (ctx) => ({ texture: texture(ctx), verticesX: 3, verticesY: 3 }),
        update: (ctx) =>
        {
            const next = texture(ctx);

            return { props: { texture: next }, check: (node) => expect(node.texture).toBe(next) };
        },
    },
    {
        name: 'MeshRope',
        ctor: px.MeshRope,
        required: (ctx) => ({ texture: texture(ctx), points: points(4) }),
        update: () =>
        {
            const next = points(6);

            // `points` lives on the rope's geometry, so a dashed prop reaches it.
            return { props: { 'geometry-points': next }, check: (node) => expect(node.geometry.points).toBe(next) };
        },
    },
    {
        name: 'MeshSimple',
        ctor: px.MeshSimple,
        required: (ctx) => ({ texture: texture(ctx), vertices: new Float32Array([0, 0, 10, 0, 10, 10]) }),
        update: (ctx) =>
        {
            const next = texture(ctx);

            return { props: { texture: next }, check: (node) => expect(node.texture).toBe(next) };
        },
    },
    {
        name: 'PerspectiveMesh',
        ctor: px.PerspectiveMesh,
        required: (ctx) => ({ texture: texture(ctx), verticesX: 3, verticesY: 3 }),
        update: (ctx) =>
        {
            const next = texture(ctx);

            return { props: { texture: next }, check: (node) => expect(node.texture).toBe(next) };
        },
    },
];

describe.each(cases)('$name', ({ name, ctor, required, update }) =>
{
    describe.runIf(typeof ctor === 'function')(`${name} on pixi.js ${pixi.VERSION}`, () =>
    {
        const El = element(`pixi${name}`);
        const register = (ctx: Harness, Class: unknown = ctor) => ctx.renderer.extend({ [name]: Class as any });

        it('is a leaf for children and accepts filters', () =>
        {
            const ctx = setup();

            expect(ctx.adapter.describe(ctor!, name).attach).toEqual({ role: 'child', accepts: ['filter'] });
        });

        it('mounts with its required options, updates a prop that matters and unmounts', async () =>
        {
            const ctx = setup();

            register(ctx);
            const options = required(ctx);
            const mounted = await ctx.mountApp(<El {...options} {...{ alpha: 0.5, x: 3 }} />);
            const node = ctx.probe.children(mounted.stage)[0] as any;

            expect(node).toBeInstanceOf(ctor!);
            expect(node.alpha).toBe(0.5);
            expect(node.x).toBe(3);

            const { props, check } = update(ctx);

            await mounted.rerender(<El {...options} {...props} {...{ alpha: 0.25, x: 4 }} />);
            expect(ctx.probe.children(mounted.stage)[0], 'updated in place').toBe(node);
            expect(node.alpha).toBe(0.25);
            expect(node.x).toBe(4);
            check(node);

            await mounted.rerender(null);
            expect(node.destroyed).toBe(true);
            await ctx.unmount();
        });

        it('prop removal restores Container defaults and never constructs a second instance', async () =>
        {
            const ctx = setup();
            let constructed = 0;
            const Base = ctor as new (options: any) => pixi.Mesh;
            const Counted = class extends Base
            {
                constructor(options: any)
                {
                    constructed++;
                    super(options);
                }
            };

            register(ctx, Counted);
            const options = required(ctx);
            const mounted = await ctx.mountApp(<El {...options} {...{ alpha: 0.5, 'position-x': 9 }} />);
            const node = ctx.probe.children(mounted.stage)[0] as any;
            const kept = node.texture;

            expect(constructed).toBe(1);
            await mounted.rerender(<El {...options} />);
            expect(constructed, 'removal reads defaults without constructing').toBe(1);
            expect(ctx.probe.children(mounted.stage)[0]).toBe(node);
            expect(node.alpha).toBe(1);
            expect(node.position.x).toBe(0);

            // A required constructor option has no kind default: removing it keeps the value, never rebuilds.
            const { texture: removed, ...rest } = options;

            expect(removed).toBeDefined();
            await mounted.rerender(<El {...rest} />);
            expect(constructed).toBe(1);
            expect(node.texture).toBe(kept);
            expect(node.destroyed).toBe(false);
        });

        it('rejects React children with UNSUPPORTED_NODE before any mutation', async () =>
        {
            const ctx = setup();

            register(ctx);
            const options = required(ctx);
            const mounted = await ctx.mountApp(<El {...options} />);
            const node = ctx.probe.children(mounted.stage)[0] as any;
            const added: unknown[] = [];
            const original = node.addChild.bind(node);

            node.addChild = (...args: unknown[]) =>
            {
                added.push(...args);

                return original(...args);
            };
            const errors = ctx.captureConsoleErrors();
            let thrown: unknown;

            try
            {
                await mounted.rerender(<El {...options}><Sprite /></El>);
            }
            catch (error)
            {
                thrown = error;
            }

            const all = leaves([thrown, ...errors.flat()]);

            expect(all.some((error) => error instanceof CompatibilityError && error.code === 'UNSUPPORTED_NODE')).toBe(true);
            expect(added, 'no child was attached').toEqual([]);
        });

        it('attaches a filter to the filters list', async () =>
        {
            const ctx = setup();

            ctx.renderer.extend({ BlurFilter: pixi.BlurFilter });
            register(ctx);
            const mounted = await ctx.mountApp(<El {...required(ctx)}><Blur /></El>);
            const node = ctx.probe.children(mounted.stage)[0] as any;

            expect(node.filters).toHaveLength(1);
            expect(node.filters[0]).toBeInstanceOf(pixi.BlurFilter);
        });
    });
});

describe.runIf(typeof px.MeshRope === 'function')(`MeshRope points on pixi.js ${pixi.VERSION}`, () =>
{
    it('a plain points prop is read by the constructor only; geometry-points updates the rope', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ MeshRope: px.MeshRope });
        const Rope = element('pixiMeshRope');
        const first = points(4);
        const second = points(4).map((point) => new pixi.Point(point.x, 25));
        const tex = texture(ctx);
        const mounted = await ctx.mountApp(<Rope {...{ texture: tex, points: first }} />);
        const node = ctx.probe.children(mounted.stage)[0] as any;

        expect(node.geometry.points).toBe(first);
        await mounted.rerender(<Rope {...{ texture: tex, points: second }} />);
        expect(node.geometry.points, 'the plain prop does not reach the geometry').toBe(first);
        await mounted.rerender(<Rope {...{ texture: tex, points: second, 'geometry-points': second }} />);
        expect(node.geometry.points).toBe(second);
        const positions = () => Array.from(node.geometry.getBuffer('aPosition').data as Float32Array);
        const before = positions();

        node.geometry.update();
        // Pixi's per-frame update follows the new points when the count is unchanged (a new count needs a rebuild).
        expect(positions()).not.toEqual(before);
    });
});
