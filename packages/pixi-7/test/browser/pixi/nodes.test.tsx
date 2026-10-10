/**
 * Pixi 7 nodes in real applications: positional constructors, Text and Graphics APIs, filters, attach rules of
 * ParticleContainer and BitmapText, meshes with children, and shared resources (textures, GraphicsGeometry).
 */
import {
    AlphaFilter,
    AnimatedSprite,
    BitmapFont,
    BitmapText,
    BlurFilter,
    ColorMatrixFilter,
    type Container,
    DisplacementFilter,
    Filter,
    FXAAFilter,
    Graphics,
    HTMLText,
    Mesh,
    MeshMaterial,
    NineSlicePlane,
    NoiseFilter,
    ParticleContainer,
    PlaneGeometry,
    Point,
    SimpleMesh,
    SimplePlane,
    SimpleRope,
    Sprite,
    Text,
    Texture,
    TilingSprite,
    VERSION,
} from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { POSITIONAL_CONSTRUCTORS } from '../../../src/construct';
import { element, setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

/** Errors thrown or reported by React, with act's AggregateErrors flattened. */
const leaves = (errors: unknown[]): unknown[] =>
    errors.flatMap((error) => (error instanceof AggregateError ? leaves(error.errors) : [error]));

const ContainerElement = element('pixiContainer');
const SpriteElement = element('pixiSprite');
const TextElement = element('pixiText');
const GraphicsElement = element('pixiGraphics');

async function rejected(ctx: ReturnType<typeof setup>, rerender: () => Promise<unknown>)
{
    const errors = ctx.captureConsoleErrors();
    let thrown: unknown;

    try
    {
        await rerender();
    }
    catch (error)
    {
        thrown = error;
    }

    const all = leaves([thrown, ...errors.flat()]);

    return { compatibility: all.find((error) => error instanceof CompatibilityError), typeErrors: all.filter((error) => error instanceof TypeError) };
}

describe(`positional construction on pixi.js ${VERSION}`, () =>
{
    it('Text is constructed with its text and style, and updates them in place', async () =>
    {
        const ctx = setup();
        const mounted = await ctx.mountApp(<TextElement {...{ text: 'first', style: { fontSize: 20 }, x: 3 }} />);
        const [text] = ctx.probe.children(mounted.stage) as Text[];

        expect(ctx.journal.argsOf(text)).toEqual(['first', { fontSize: 20 }]);
        expect([text.text, text.style.fontSize, text.x]).toEqual(['first', 20, 3]);

        await mounted.rerender(<TextElement {...{ text: 'second', style: { fontSize: 30 }, x: 3 }} />);

        expect(ctx.probe.children(mounted.stage)).toEqual([text]);
        expect([text.text, text.style.fontSize]).toEqual(['second', 30]);
    });

    it('removing a Text prop restores the blank Text default', async () =>
    {
        const ctx = setup();
        const mounted = await ctx.mountApp(<TextElement {...{ text: 'a', alpha: 0.5 }} />);
        const [text] = ctx.probe.children(mounted.stage) as Text[];

        await mounted.rerender(<TextElement {...{}} />);

        expect([text.text, text.alpha]).toEqual(['', 1]);
    });

    it('every positional argument the table updates is a writable instance property of the built-in', () =>
    {
        const texture = Texture.WHITE;

        BitmapFont.from('pixi-7-table-font', { fontFamily: 'Arial', fontSize: 12 }, { chars: [['a', 'z']] });
        const instances: Record<keyof typeof POSITIONAL_CONSTRUCTORS, object> = {
            Sprite: new Sprite(texture),
            AnimatedSprite: new AnimatedSprite([texture]),
            TilingSprite: new TilingSprite(texture),
            Text: new Text('t'),
            HTMLText: new HTMLText('t'),
            BitmapText: new BitmapText('a', { fontName: 'pixi-7-table-font' }),
            Graphics: new Graphics(),
            Mesh: new Mesh(new PlaneGeometry(), new MeshMaterial(texture)),
            SimpleMesh: new SimpleMesh(texture),
            SimplePlane: new SimplePlane(texture, 2, 2),
            SimpleRope: new SimpleRope(texture, [new Point(0, 0), new Point(1, 1)]),
            NineSlicePlane: new NineSlicePlane(texture),
            ParticleContainer: new ParticleContainer(),
            Filter: new Filter(),
            AlphaFilter: new AlphaFilter(),
            BlurFilter: new BlurFilter(),
            ColorMatrixFilter: new ColorMatrixFilter(),
            DisplacementFilter: new DisplacementFilter(new Sprite(texture)),
            FXAAFilter: new FXAAFilter(),
            NoiseFilter: new NoiseFilter(),
        };

        for (const [name, instance] of Object.entries(instances))
        {
            for (const arg of POSITIONAL_CONSTRUCTORS[name as keyof typeof POSITIONAL_CONSTRUCTORS].args)
            {
                if ((arg as { update?: string }).update !== 'constructor')
                {
                    expect(arg.prop in instance, `${name}.${arg.prop}`).toBe(true);
                }
            }
        }
        BitmapFont.uninstall('pixi-7-table-font');
    });

    it('`draw` receives the Graphics node with Pixi 7\'s imperative API', async () =>
    {
        const ctx = setup();
        const draw = (graphics: Graphics) => graphics.beginFill(0xff0000).drawRect(0, 0, 8, 8).endFill();
        const mounted = await ctx.mountApp(<GraphicsElement {...{ draw }} />);
        const [graphics] = ctx.probe.children(mounted.stage) as Graphics[];

        expect(graphics.geometry.graphicsData).toHaveLength(1);
        expect(graphics.width).toBe(8);
    });
});

describe(`resources on pixi.js ${VERSION}`, () =>
{
    it('a GraphicsGeometry shared through `geometry` survives a node\'s removal (Pixi 7 reference-counts it)', async () =>
    {
        const ctx = setup();
        const template = new Graphics().beginFill(0x00ff00).drawRect(0, 0, 4, 4).endFill();
        const { geometry } = template;
        const mounted = await ctx.mountApp(<><GraphicsElement key="a" {...{ geometry }} /><GraphicsElement key="b" {...{ geometry }} /></>);
        const [first, second] = ctx.probe.children(mounted.stage) as Graphics[];

        expect(first.geometry).toBe(geometry);
        expect(second.geometry).toBe(geometry);
        expect(ctx.journal.argsOf(first)).toEqual([geometry]);

        await mounted.rerender(<GraphicsElement key="b" {...{ geometry }} />);
        await ctx.unmount();

        expect(first.destroyed && second.destroyed).toBe(true);
        expect(geometry.graphicsData, 'the template still holds the geometry').toHaveLength(1);
        template.destroy();
    });

    it('a borrowed texture survives node removal and unmount; Assets are never unloaded', async () =>
    {
        const ctx = setup();
        const texture = ctx.probe.createTexture() as Texture;
        const mounted = await ctx.mountApp(<SpriteElement {...{ texture }} />);

        await mounted.rerender(null);
        await ctx.unmount();

        expect(ctx.probe.isResourceDestroyed(texture)).toBe(false);
        expect(texture.baseTexture.destroyed ?? false).toBe(false);
    });

    it('destroyOptions transfer the texture to the teardown (Pixi 7: texture, baseTexture)', async () =>
    {
        const ctx = setup();
        const texture = ctx.probe.createTexture() as Texture;

        await ctx.mountApp(<SpriteElement {...{ texture }} />, { destroyOptions: { children: true, texture: true, baseTexture: true } });
        await ctx.unmount();

        expect(ctx.probe.isResourceDestroyed(texture)).toBe(true);
    });
});

describe(`filters on pixi.js ${VERSION}`, () =>
{
    it('filters attach to their parent\'s `filters` in JSX order and detach on removal', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ BlurFilter, NoiseFilter });
        const Blur = element('pixiBlurFilter');
        const Noise = element('pixiNoiseFilter');
        const tree = (keys: string[]) => (
            <ContainerElement {...{ label: 'c' }}>
                {keys.map((key) => (key === 'blur' ? <Blur key={key} {...{ strength: 2, quality: 3 }} /> : <Noise key={key} {...{ noise: 0.25 }} />))}
            </ContainerElement>
        );
        const mounted = await ctx.mountApp(tree(['blur', 'noise']));
        const [container] = ctx.probe.children(mounted.stage) as Container[];
        const [blur, noise] = container.filters as [BlurFilter, NoiseFilter];

        expect(blur).toBeInstanceOf(BlurFilter);
        expect([blur.blur, blur.quality]).toEqual([2, 3]);
        expect(noise.noise).toBe(0.25);

        await mounted.rerender(tree(['noise', 'blur']));
        expect(container.filters).toEqual([noise, blur]);

        await mounted.rerender(tree(['noise']));
        expect(container.filters).toEqual([noise]);
    });
});

describe(`attach rules on pixi.js ${VERSION}`, () =>
{
    it('a Pixi 7 ParticleContainer takes Sprites', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ ParticleContainer });
        const Particles = element('pixiParticleContainer');
        const mounted = await ctx.mountApp(
            <Particles {...{ maxSize: 10 }}><SpriteElement {...{ texture: Texture.WHITE }} /><SpriteElement {...{ texture: Texture.WHITE }} /></Particles>,
        );
        const [container] = ctx.probe.children(mounted.stage) as ParticleContainer[];

        expect(container).toBeInstanceOf(ParticleContainer);
        expect(container.children).toHaveLength(2);
        expect(ctx.adapter.manifest.provides['pixi7.particle-container']).toBe(1);
        expect(ctx.adapter.manifest.provides['pixi8.particle']).toBeUndefined();
    });

    it.each([
        ['a Container', () => <ContainerElement />],
        ['a filter', () =>
        {
            const Blur = element('pixiBlurFilter');

            return <Blur />;
        }],
    ])('a ParticleContainer rejects %s before any mutation', async (_label, child) =>
    {
        const ctx = setup();

        ctx.renderer.extend({ ParticleContainer, BlurFilter });
        const Particles = element('pixiParticleContainer');
        const mounted = await ctx.mountApp(<Particles />);
        const [container] = ctx.probe.children(mounted.stage) as ParticleContainer[];
        const { compatibility, typeErrors } = await rejected(ctx, () => mounted.rerender(<Particles>{child()}</Particles>));

        expect(compatibility).toMatchObject({ code: 'UNSUPPORTED_NODE' });
        expect(typeErrors).toEqual([]);
        expect(container.children).toEqual([]);
        expect(container.filters ?? null).toBeNull();
    });

    it('BitmapText rejects JSX children: it manages its own glyph children', async () =>
    {
        const ctx = setup();

        BitmapFont.from('pixi-7-test-font', { fontFamily: 'Arial', fontSize: 12 }, { chars: [['a', 'z']] });
        ctx.renderer.extend({ BitmapText });
        const Bitmap = element('pixiBitmapText');
        const mounted = await ctx.mountApp(<Bitmap {...{ text: 'abc', style: { fontName: 'pixi-7-test-font' } }} />);
        const [bitmap] = ctx.probe.children(mounted.stage) as BitmapText[];

        expect(bitmap.text).toBe('abc');
        const glyphs = bitmap.children.length;
        const { compatibility } = await rejected(ctx, () => mounted.rerender(
            <Bitmap {...{ text: 'abc', style: { fontName: 'pixi-7-test-font' } }}><ContainerElement /></Bitmap>,
        ));

        expect(compatibility).toMatchObject({ code: 'UNSUPPORTED_NODE' });
        expect(bitmap.children).toHaveLength(glyphs);
        BitmapFont.uninstall('pixi-7-test-font');
    });

    it('Pixi 7 meshes take children', async () =>
    {
        const ctx = setup();

        ctx.renderer.extend({ SimplePlane });
        const Plane = element('pixiSimplePlane');
        const mounted = await ctx.mountApp(<Plane {...{ texture: Texture.WHITE, verticesX: 2, verticesY: 2 }}><ContainerElement {...{ label: 'inner' }} /></Plane>);
        const [plane] = ctx.probe.children(mounted.stage) as SimplePlane[];

        expect(plane).toBeInstanceOf(SimplePlane);
        expect(ctx.probe.children(plane).map((child) => ctx.probe.label(child))).toEqual(['inner']);
    });
});
