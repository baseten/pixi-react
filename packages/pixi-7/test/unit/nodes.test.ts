/**
 * Node behaviour that needs no renderer, on pixi.js 7.2.0, 7.4.2 and 7.4.3 side by side. Pixi 7 builds its default
 * textures and Graphics fill styles from a DOM canvas, so classes that need one (Graphics, Text, meshes) are covered by
 * the browser cells (`test/browser/pixi`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signatureOf } from '../../src/construct';
import { CAPABILITIES, PixiNodes, resetWarnings } from '../../src/nodes';
import { adapterFor, cells } from './cells';
import { CompatibilityError, negotiate } from '@pixi-react-provisional/core';

import type { PixiModule } from '../../src/pixi';

type Any = Record<string, any>;

const nodesFor = (pixi: PixiModule, enabled: (capability: string) => boolean = () => true) => new PixiNodes(pixi, enabled);

function make(nodes: PixiNodes, ctor: new (...args: any[]) => object, props: Any = {}, name = 'Node'): Any
{
    return nodes.create(nodes.describe(ctor as never, name), props) as Any;
}

function thrown(action: () => unknown): any
{
    try
    {
        action();
    }
    catch (error)
    {
        return error;
    }

    return undefined;
}

afterEach(() =>
{
    vi.restoreAllMocks();
    resetWarnings();
});

describe.each(cells)('node definitions on pixi.js $version', ({ pixi }) =>
{
    const nodes = nodesFor(pixi);

    it('Containers are children that accept children, Sprites and filters', () =>
    {
        expect(nodes.describe(pixi.Container, 'Container')).toEqual({
            name: 'Container',
            ctor: pixi.Container,
            capabilities: { 'pixi.mutation': 1 },
            attach: { role: 'child', accepts: ['child', 'sprite', 'filter'] },
        });
    });

    it.each(['Sprite', 'AnimatedSprite', 'TilingSprite', 'Text', 'HTMLText'] as const)('%s (a Pixi 7 Sprite) plays the sprite role', (name) =>
    {
        expect(nodes.describe(pixi[name] as never, name).attach).toEqual({ role: 'sprite', accepts: ['child', 'sprite', 'filter'] });
    });

    it.each(['Graphics', 'Mesh', 'SimpleMesh', 'SimplePlane', 'SimpleRope', 'NineSlicePlane'] as const)('%s takes children (Pixi 7 meshes are containers)', (name) =>
    {
        expect(nodes.describe(pixi[name] as never, name).attach).toEqual({ role: 'child', accepts: ['child', 'sprite', 'filter'] });
    });

    it('ParticleContainer accepts only Sprites and needs pixi7.particle-container', () =>
    {
        expect(nodes.describe(pixi.ParticleContainer, 'ParticleContainer')).toMatchObject({
            capabilities: { 'pixi.mutation': 1, 'pixi7.particle-container': 1 },
            attach: { role: 'child', accepts: ['sprite'] },
        });
    });

    it('BitmapText manages its own children: it accepts only filters', () =>
    {
        expect(nodes.describe(pixi.BitmapText, 'BitmapText').attach).toEqual({ role: 'child', accepts: ['filter'] });
    });

    it.each(['Filter', 'AlphaFilter', 'BlurFilter', 'ColorMatrixFilter', 'DisplacementFilter', 'FXAAFilter', 'NoiseFilter'] as const)(
        '%s attaches as a filter and needs pixi7.filter',
        (name) =>
        {
            expect(nodes.describe(pixi[name] as never, name)).toMatchObject({
                capabilities: { 'pixi7.filter': 1 },
                attach: { role: 'filter', accepts: [] },
            });
        },
    );

    it.each(['Texture', 'GraphicsGeometry', 'Point', 'Rectangle', 'DisplayObject'] as const)('%s is rejected with UNSUPPORTED_NODE', (name) =>
    {
        const error = thrown(() => nodes.describe(pixi[name] as never, name));

        expect(error).toBeInstanceOf(CompatibilityError);
        expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE', adapterIds: ['pixi-7'] });
        expect(error.message).toContain('not a renderable Pixi 7 scene node');
    });

    it('a class of another pixi.js copy (a Pixi 8 class, for example) is rejected, naming the Pixi 8-only classes', () =>
    {
        class Foreign
        {
            label = 'foreign';
        }

        const error = thrown(() => nodes.describe(Foreign as never, 'RenderLayer'));

        expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE' });
        expect(error.message).toMatch(/Pixi 8-only classes \(Particle, RenderLayer, DOMContainer, SplitText, GraphicsContext\)/);
        expect(error.message).toContain('constructor Foreign');
    });

    it('a withheld capability rejects its nodes with UNSUPPORTED_NODE naming it', () =>
    {
        const withheld = nodesFor(pixi, (capability) => capability !== CAPABILITIES.filter);
        const error = thrown(() => withheld.describe(pixi.BlurFilter, 'BlurFilter'));

        expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE', capability: 'pixi7.filter', actual: { 'pixi7.filter': null } });
    });
});

describe.each(cells)('positional construction on pixi.js $version', ({ pixi }) =>
{
    const nodes = nodesFor(pixi);

    it('a Sprite is constructed with its texture, and the other props are applied afterwards', () =>
    {
        const texture = pixi.Texture.EMPTY;
        const spy = vi.fn();
        const Spied = class extends pixi.Sprite
        {
            constructor(...args: any[])
            {
                super(...args);
                spy(...args);
            }
        };
        const sprite = make(nodes, Spied, { texture, alpha: 0.5, 'position-x': 3, onPointerTap: () => undefined });

        expect(spy).toHaveBeenCalledWith(texture);
        expect(sprite.texture).toBe(texture);
        expect(sprite.alpha).toBe(0.5);
        expect(sprite.position.x).toBe(3);
        expect(typeof sprite.onpointertap).toBe('function');
    });

    it('drops trailing missing arguments, so Pixi\'s own defaults apply', () =>
    {
        const spy = vi.fn();
        const Spied = class extends pixi.TilingSprite
        {
            constructor(...args: any[])
            {
                super(...(args as [any]));
                spy(args);
            }
        };
        const tiling = make(nodes, Spied, { texture: pixi.Texture.EMPTY, width: 50 });

        expect(spy).toHaveBeenCalledWith([pixi.Texture.EMPTY, 50]);
        expect([tiling.width, tiling.height]).toEqual([50, 100]);
    });

    it('a Container subclass receives one options object, as on Pixi 8', () =>
    {
        const spy = vi.fn();
        const Custom = class extends pixi.Container
        {
            constructor(options: unknown)
            {
                super();
                spy(options);
            }
        };

        make(nodes, Custom, { alpha: 0.5, onPointerTap: () => undefined, draw: () => undefined, 'scale-x': 2, required: 1 });

        expect(spy).toHaveBeenCalledWith({ alpha: 0.5, required: 1 });
    });

    it('built-in filters are positional; their subclasses receive the options object', () =>
    {
        expect(nodes.signatureOf(pixi.AlphaFilter)?.args.map((arg) => arg.prop)).toEqual(['alpha']);
        expect(nodes.signatureOf(class extends pixi.AlphaFilter {})).toBeUndefined();
        expect(nodes.signatureOf(class extends pixi.Filter {})).toBeUndefined();
        expect(nodes.signatureOf(class extends pixi.Sprite {})?.args.map((arg) => arg.prop)).toEqual(['texture']);
        expect(nodes.signatureOf(class extends pixi.NineSlicePlane {})?.args.map((arg) => arg.prop))
            .toEqual(['texture', 'leftWidth', 'topHeight', 'rightWidth', 'bottomHeight']);
        expect(signatureOf(pixi.Container, pixi as never)).toBeUndefined();
    });

    it('a constructor-only argument warns on update instead of assigning a meaningless property', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const container = make(nodes, pixi.ParticleContainer, { maxSize: 10, autoResize: true });

        expect(container.autoResize).toBe(true);
        nodes.applyChanges(container, { maxSize: 10, autoResize: true }, { maxSize: 20, autoResize: false });

        expect(container.autoResize).toBe(false);
        expect('maxSize' in container).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('`maxSize` is a Pixi 7 constructor argument'));
    });

    it('removing a prop restores the kind default of a blank built-in', () =>
    {
        const sprite = make(nodes, pixi.Sprite, { texture: pixi.Texture.EMPTY, alpha: 0.5, x: 4 });

        nodes.applyChanges(sprite, { texture: pixi.Texture.EMPTY, alpha: 0.5, x: 4 }, { texture: pixi.Texture.EMPTY });

        expect([sprite.alpha, sprite.x]).toEqual([1, 0]);
    });

    it('the Pixi 8 `label` prop is assigned but warns with the Pixi 7 name', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const node = make(nodes, pixi.Container, { label: 'x', name: 'y' });

        expect([node.label, node.name]).toEqual(['x', 'y']);
        expect(warn).toHaveBeenCalledWith('[pixi-7] `label` is a Pixi 8 property; Pixi 7 calls it `name`.');
    });

    it('Pixi-cased event props warn and are ignored', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const handler = () => undefined;
        const node = make(nodes, pixi.Container, { onpointertap: handler });

        expect(node.onpointertap).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('use `onPointerTap`'));
    });

    it('production builds behave the same without the development-only warnings and messages', () =>
    {
        const env = process.env.NODE_ENV;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const handler = () => undefined;
        const draw = vi.fn();

        // The warnings are development-only (issue 58): the source reads NODE_ENV as written, for bundlers to replace.
        process.env.NODE_ENV = 'production';

        try
        {
            const node = make(nodes, pixi.Container, { onpointertap: handler, draw, label: 'x' });
            const container = make(nodes, pixi.ParticleContainer, { maxSize: 10 });

            expect(node.onpointertap).toBeNull();
            expect(node.label).toBe('x');
            expect(draw).not.toHaveBeenCalled();
            nodes.applyChanges(container, { maxSize: 10 }, { maxSize: 20 });
            expect('maxSize' in container).toBe(false);
            expect(warn).not.toHaveBeenCalled();

            const withheld = nodesFor(pixi, (capability) => capability !== CAPABILITIES.filter);
            const error = thrown(() => withheld.describe(pixi.BlurFilter, 'BlurFilter'));

            expect(error).toBeInstanceOf(CompatibilityError);
            expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE', capability: 'pixi7.filter' });
            expect(error.message).not.toMatch(/adapter's options withhold it/);
        }
        finally
        {
            process.env.NODE_ENV = env;
        }
    });

    it('insertions next to a filter sibling keep the JSX order of children and of filters', () =>
    {
        const container = make(nodes, pixi.Container);
        const [a, b, c] = ['a', 'b', 'c'].map((name) => make(nodes, pixi.Container, { name }));
        // Real filters need a DOM; the adapter tells filters apart by prototype, so bare instances stand in for them.
        const [f0, f1, f2] = [0, 1, 2].map(() => Object.create(pixi.Filter.prototype) as object);

        for (const child of [a, f1, c, f2]) nodes.append(container, child);

        // A display node before a filter goes before the next display sibling in JSX order (c), not last.
        nodes.insertBefore(container, b, f1);
        expect(container.children).toEqual([a, b, c]);
        // A filter before a display node goes before the next filter in JSX order (f2), not last.
        nodes.insertBefore(container, f0, c);
        expect(container.filters).toEqual([f1, f0, f2]);
        // With no display sibling after the filter, the node goes last.
        nodes.remove(container, a);
        nodes.insertBefore(container, a, f2);
        expect(container.children).toEqual([b, c, a]);
    });

    it('a node moved straight to another parent leaves the old parent\'s JSX order', () =>
    {
        const [from, to] = [make(nodes, pixi.Container), make(nodes, pixi.Container)];
        const [a, b] = ['a', 'b'].map((name) => make(nodes, pixi.Container, { name }));
        const f = Object.create(pixi.Filter.prototype) as object;

        nodes.append(from, f);
        nodes.append(from, a);
        // Core reparents without removing from the old parent first.
        nodes.append(to, a);
        nodes.insertBefore(from, b, f);
        expect(from.children).toEqual([b]);
        expect(to.children).toEqual([a]);
    });

    it('React visibility layers over the committed `visible`', () =>
    {
        const node = make(nodes, pixi.Container, { visible: false });

        nodes.setHidden(node, true);
        nodes.applyChanges(node, { visible: false }, { visible: true });
        expect(node.visible).toBe(false);
        nodes.setHidden(node, false);
        expect(node.visible).toBe(true);
    });

    it('destroys a display object once, with the options unchanged', () =>
    {
        const node = make(nodes, pixi.Container);
        const destroy = vi.spyOn(node as never as { destroy(options?: unknown): void }, 'destroy');

        nodes.destroyNode(node, { children: true });
        nodes.destroyNode(node, { children: true });

        expect(destroy.mock.calls).toEqual([[{ children: true }]]);
        expect(nodes.isDestroyed(node)).toBe(true);
    });
});

describe.each(cells)('capabilities on pixi.js $version', ({ pixi }) =>
{
    const react = { abi: { major: 1 as const, minor: 0 }, id: 'react-test', packageVersion: '0.0.0', verification: '', provides: {}, requires: {} };

    it('provides the shared protocol and its own node capabilities, never a Pixi 8 one', () =>
    {
        const { manifest } = new (adapterFor(pixi))();

        expect(manifest.provides).toEqual({
            'pixi.mutation': 1,
            'pixi.visibility': 1,
            'pixi.application': 1,
            'pixi.ticker': 1,
            'pixi.globals': 1,
            'pixi7.filter': 1,
            'pixi7.particle-container': 1,
        });
        expect(manifest.abi).toEqual({ major: 1, minor: 0 });
        expect(manifest.id).toBe('pixi-7');
    });

    it.each(['pixi8.particle', 'pixi8.render-layer', 'pixi8.dom-container', 'pixi8.filter'])(
        'a composition that requires %s fails with CAPABILITY_MISSING before anything is allocated',
        (capability) =>
        {
            const { manifest } = new (adapterFor(pixi))();
            const error = thrown(() => negotiate(react, manifest, { [capability]: 1 }));

            expect(error).toBeInstanceOf(CompatibilityError);
            expect(error).toMatchObject({ code: 'CAPABILITY_MISSING', capability, actual: { [capability]: null } });
        },
    );

    it('`disable` withholds an optional capability', () =>
    {
        const { manifest } = new (adapterFor(pixi))({ disable: ['pixi7.particle-container'] });

        expect(manifest.provides['pixi7.particle-container']).toBeUndefined();
        expect(manifest.provides['pixi7.filter']).toBe(1);
    });
});
