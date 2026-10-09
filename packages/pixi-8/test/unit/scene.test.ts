import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixiScene, resetWarnings } from '../../src/scene';
import { cells, withParticles } from './cells';
import { CompatibilityError } from '@pixi-react-provisional/core';

import type { ParticleContainerLike, ParticleLike, PixiModule } from '../../src/pixi';

type Any = Record<string, any>;

const sceneFor = (pixi: PixiModule, enabled: (capability: string) => boolean = () => true) => new PixiScene(pixi, enabled);

function make(scene: PixiScene, ctor: new (...args: any[]) => object, props: Any = {}, name = 'Node'): Any
{
    return scene.create(scene.describe(ctor as never, name), props) as Any;
}

afterEach(() =>
{
    vi.restoreAllMocks();
    resetWarnings();
});

describe.each(cells)('node definitions on pixi.js $version', ({ pixi }) =>
{
    const scene = sceneFor(pixi);

    it('Containers are children that accept children and filters', () =>
    {
        expect(scene.describe(pixi.Sprite, 'Sprite')).toEqual({
            name: 'Sprite',
            ctor: pixi.Sprite,
            capabilities: { 'scene.mutation': 1 },
            attach: { role: 'child', accepts: ['child', 'filter'] },
        });
    });

    // Filter instances need a DOM canvas (shader precision probe); their tree behaviour is tested in the browser cells.
    it('Filters attach as filters and need pixi8.filter', () =>
    {
        expect(scene.describe(pixi.BlurFilter, 'BlurFilter')).toMatchObject({
            capabilities: { 'pixi8.filter': 1 },
            attach: { role: 'filter', accepts: [] },
        });
    });

    it.each(['Texture', 'GraphicsContext', 'Point', 'Rectangle'] as const)('%s is rejected with UNSUPPORTED_NODE', (name) =>
    {
        const error = (() =>
        {
            try
            {
                scene.describe(pixi[name] as never, name);
            }
            catch (caught)
            {
                return caught;
            }

            return undefined;
        })();

        expect(error).toBeInstanceOf(CompatibilityError);
        expect(error).toMatchObject({ code: 'UNSUPPORTED_NODE', adapterIds: ['pixi-8'] });
    });

    it('a withheld capability rejects the node at registration, naming the capability', () =>
    {
        const strict = sceneFor(pixi, (capability) => capability !== 'pixi8.filter');

        expect(() => strict.describe(pixi.BlurFilter, 'BlurFilter')).toThrow(/pixi8\.filter/);
    });
});

describe.each(withParticles)('special nodes on pixi.js $version', ({ pixi }) =>
{
    const scene = sceneFor(pixi);

    it('Particle is its own role and ParticleContainer accepts only particles and filters', () =>
    {
        expect(scene.describe(pixi.Particle!, 'Particle')).toMatchObject({
            capabilities: { 'pixi8.particle': 1 },
            attach: { role: 'particle', accepts: [] },
        });
        expect(scene.describe(pixi.ParticleContainer!, 'ParticleContainer')).toMatchObject({
            capabilities: { 'pixi8.particle': 1 },
            attach: { role: 'child', accepts: ['particle', 'filter'] },
        });
    });

    it('the Mesh family and the split texts accept filters but no children', () =>
    {
        const leaves = ['Mesh', 'MeshPlane', 'MeshRope', 'MeshSimple', 'PerspectiveMesh', 'SplitText', 'SplitBitmapText'] as const;
        const present = leaves.filter((name) => typeof (pixi as Any)[name] === 'function');

        expect(present).toContain('Mesh');

        for (const name of present)
        {
            expect(scene.describe((pixi as Any)[name], name), name).toMatchObject({ attach: { role: 'child', accepts: ['filter'] } });
        }

        // A custom subclass inherits the rule; describe() constructs nothing.
        class Custom extends pixi.MeshPlane
        {}

        expect(scene.describe(Custom, 'Custom').attach).toEqual({ role: 'child', accepts: ['filter'] });
        expect(scene.describe(pixi.NineSliceSprite, 'NineSliceSprite').attach.accepts, 'unchanged').toEqual(['child', 'filter']);
    });

    it('RenderLayer and DOMContainer are capability-gated leaves', () =>
    {
        expect(scene.describe(pixi.RenderLayer!, 'RenderLayer')).toMatchObject({
            capabilities: { 'pixi8.render-layer': 1 },
            attach: { role: 'child', accepts: [] },
        });
        expect(scene.describe(pixi.DOMContainer!, 'DOMContainer')).toMatchObject({
            capabilities: { 'pixi8.dom-container': 1 },
            attach: { role: 'child', accepts: [] },
        });

        const without = sceneFor(pixi, () => false);

        for (const name of ['Particle', 'ParticleContainer', 'RenderLayer', 'DOMContainer'] as const)
        {
            expect(() => without.describe(pixi[name]!, name), name).toThrow(CompatibilityError);
        }
    });
});

describe.each(cells)('props on pixi.js $version', ({ pixi }) =>
{
    const scene = sceneFor(pixi);

    it('passes plain props to the constructor; dashed, event and draw props are applied afterwards', () =>
    {
        const seen: Any[] = [];
        const Custom = class extends pixi.Container
        {
            constructor(options: Any)
            {
                super(options);
                seen.push(options);
            }
        };
        const onPointerTap = () => undefined;
        const node = make(scene, Custom, { label: 'c', alpha: 0.5, 'position-x': 10, 'scale-y': 2, onPointerTap, children: [], key: 'k', ref: null });

        expect(seen).toEqual([{ label: 'c', alpha: 0.5 }]);
        expect(node).not.toHaveProperty('position-x');
        expect([node.position.x, node.scale.y, node.scale.x]).toEqual([10, 2, 1]);
        expect(node.onpointertap).toBe(onPointerTap);
    });

    it('restores kind defaults for props that came through the constructor', () =>
    {
        const props = { alpha: 0.5, x: 10, scale: { x: 3, y: 4 }, anchor: { x: 0.5, y: 0.5 } };
        const sprite = make(scene, pixi.Sprite, props);

        expect([sprite.alpha, sprite.x, sprite.scale.y, sprite.anchor.x]).toEqual([0.5, 10, 4, 0.5]);
        scene.applyChanges(sprite, props, {});
        expect([sprite.alpha, sprite.x, sprite.scale.x, sprite.scale.y, sprite.anchor.x]).toEqual([1, 0, 1, 1, 0]);
    });

    it('restores a custom class initial value, and never constructs a class that needs arguments', () =>
    {
        let constructions = 0;
        const Strict = class extends pixi.Container
        {
            constructor(options: Any)
            {
                if (!options)
                {
                    throw new Error('Strict needs options');
                }

                super(options);
                constructions += 1;
                this.alpha = options.alpha === 0.75 ? 0.25 : this.alpha;
            }
        };
        const custom = make(scene, Strict, { alpha: 0.75 });

        expect(custom.alpha).toBe(0.75);
        scene.applyChanges(custom, { alpha: 0.75 }, {});
        expect(custom.alpha).toBe(0.25);

        const strict = make(scene, Strict, { alpha: 0.5 });

        scene.applyChanges(strict, { alpha: 0.5 }, {});
        expect(strict.alpha).toBe(1);
        expect(constructions).toBe(2);
    });

    it('removing a parent and its dashed child together restores the parent\'s captured value', () =>
    {
        class Offset extends pixi.Container
        {
            constructor()
            {
                super();
                this.position.set(7, 8);
            }
        }

        const node = make(scene, Offset, { position: { x: 1, y: 2 }, 'position-x': 10 }, 'Offset');

        expect(node.x).toBe(10);
        scene.applyChanges(node, { position: { x: 1, y: 2 }, 'position-x': 10 }, {});
        expect([node.x, node.y]).toEqual([7, 8]);
    });

    it('dashed props: removal resets only the nested field; a changed parent re-applies its dashed child', () =>
    {
        const node = make(scene, pixi.Container, { position: { x: 1, y: 2 }, 'position-x': 10 });

        expect([node.position.x, node.position.y]).toEqual([10, 2]);
        scene.applyChanges(node, { position: { x: 1, y: 2 }, 'position-x': 10 }, { position: { x: 5, y: 6 }, 'position-x': 10 });
        expect([node.position.x, node.position.y]).toEqual([10, 6]);
        scene.applyChanges(node, { position: { x: 5, y: 6 }, 'position-x': 10 }, { position: { x: 5, y: 6 } });
        expect([node.position.x, node.position.y], 'the remaining parent prop wins').toEqual([5, 6]);

        const alone = make(scene, pixi.Container, {});

        scene.applyChanges(alone, {}, { 'position-x': 10, 'position-y': 4 });
        scene.applyChanges(alone, { 'position-x': 10, 'position-y': 4 }, { 'position-y': 4 });
        expect([alone.position.x, alone.position.y]).toEqual([0, 4]);
    });

    it('text style removal restores a fresh default style', () =>
    {
        const text = make(scene, pixi.Text, { text: 'a', style: { fontSize: 20 } });

        expect(text.style.fontSize).toBe(20);
        scene.applyChanges(text, { text: 'a', style: { fontSize: 20 } }, { text: 'a' });
        expect(text.style.fontSize).toBe(new pixi.Text().style.fontSize);
    });

    it('events: add, replace and remove set the Pixi handler property; Pixi names warn and are ignored', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const first = () => undefined;
        const second = () => undefined;
        const node = make(scene, pixi.Container, { onPointerTap: first, onWheel: first });

        scene.applyChanges(node, { onPointerTap: first, onWheel: first }, { onPointerTap: second });
        expect(node.onpointertap).toBe(second);
        expect(node.onwheel).toBeNull();

        const pixiNamed = make(scene, pixi.Container, { onpointerdown: first });

        expect(pixiNamed.onpointerdown ?? null).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).toMatch(/onPointerDown/);
    });

    it('draw runs on mount and on identity change, only for Graphics', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const calls: unknown[] = [];
        const draw = (graphics: unknown) => calls.push(graphics);
        const graphics = make(scene, pixi.Graphics, { draw });

        scene.applyChanges(graphics, { draw }, { draw, alpha: 0.5 });
        expect(calls).toEqual([graphics]);
        scene.applyChanges(graphics, { draw }, { draw: (g: unknown) => calls.push(g) });
        expect(calls).toEqual([graphics, graphics]);

        make(scene, pixi.Container, { draw });
        expect(calls).toHaveLength(2);
        expect(warn).toHaveBeenCalled();
    });

    it('readonly members are never written', () =>
    {
        const node = make(scene, pixi.Container, {});

        expect(() => scene.applyChanges(node, {}, { worldTransform: { a: 2 } })).not.toThrow();
        expect(node.worldTransform.a).toBe(1);
    });

    it('framework visibility restores the latest committed visible value', () =>
    {
        const node = make(scene, pixi.Container, { visible: false });

        scene.setHidden(node, true);
        scene.setHidden(node, false);
        expect(node.visible).toBe(false);

        scene.setHidden(node, true);
        scene.applyChanges(node, { visible: false }, { visible: true });
        expect(node.visible).toBe(false);
        scene.setHidden(node, false);
        expect(node.visible).toBe(true);

        const late = make(scene, pixi.Container, {});

        scene.setHidden(late, true);
        scene.applyChanges(late, {}, { visible: false });
        scene.applyChanges(late, { visible: false }, {});
        expect(late.visible, 'still hidden').toBe(false);
        scene.setHidden(late, false);
        expect(late.visible, 'initial value captured from before the hide').toBe(true);

        const plain = make(scene, pixi.Container, {});

        scene.setHidden(plain, true);
        expect(plain.visible).toBe(false);
        scene.setHidden(plain, false);
        expect(plain.visible).toBe(true);
    });

    it('a removed visible prop stops owning visibility, so imperative changes survive a hide/unhide cycle', () =>
    {
        const node = make(scene, pixi.Container, { visible: false });

        scene.applyChanges(node, { visible: false }, {});
        expect(node.visible, 'removal restores the initial value').toBe(true);

        node.visible = false;
        scene.setHidden(node, true);
        scene.setHidden(node, false);
        expect(node.visible, 'value held just before hiding').toBe(false);

        const hidden = make(scene, pixi.Container, { visible: false });

        scene.setHidden(hidden, true);
        scene.applyChanges(hidden, { visible: false }, {});
        scene.setHidden(hidden, false);
        expect(hidden.visible, 'removal while hidden restores the initial value on unhide').toBe(true);
    });

    it('destroys containers with the options and each node at most once', () =>
    {
        const container = make(scene, pixi.Container, {});
        const destroy = vi.spyOn(container as { destroy(options?: unknown): void }, 'destroy');
        const options = { children: true, texture: true };

        scene.destroyNode(container, options);
        scene.destroyNode(container, options);
        expect(destroy.mock.calls).toEqual([[options]]);
        expect(scene.isDestroyed(container)).toBe(true);
    });

    it('standalone applyProps works on an instance the scene never created', () =>
    {
        const node = new pixi.Container() as unknown as Any;

        scene.applyChanges(node, {}, { alpha: 0.5, 'position-y': 9 });
        expect([node.alpha, node.position.y]).toEqual([0.5, 9]);
    });
});

describe.each(withParticles)('particles on pixi.js $version', ({ pixi, version }) =>
{
    const scene = sceneFor(pixi);
    const texture = () => pixi.Texture.WHITE;
    const setup = () =>
    {
        const container = make(scene, pixi.ParticleContainer!, {}) as unknown as ParticleContainerLike;
        const particles = ['a', 'b', 'c'].map((label) => make(scene, pixi.Particle!, { texture: texture(), x: label.charCodeAt(0) }));

        for (const particle of particles)
        {
            scene.append(container, particle);
        }

        return { container, particles: particles as unknown as ParticleLike[] };
    };

    it('attaches through addParticle, reorders with addParticleAt and detaches exactly one particle', () =>
    {
        const { container, particles: [a, b, c] } = setup();

        expect(container.particleChildren).toEqual([a, b, c]);
        scene.insertBefore(container, c, a);
        expect(container.particleChildren).toEqual([c, a, b]);
        scene.remove(container, a);
        expect(container.particleChildren).toEqual([c, b]);
        scene.append(container, c);
        expect(container.particleChildren).toEqual([b, c]);
    });

    it('hides a particle through alpha and restores its committed alpha', () =>
    {
        const particle = make(scene, pixi.Particle!, { texture: texture(), alpha: 0.5 }) as Any;

        scene.setHidden(particle, true);
        expect(particle.alpha).toBe(0);
        scene.setHidden(particle, false);
        expect(particle.alpha).toBe(0.5);
        scene.applyChanges(particle, { texture: texture(), alpha: 0.5 }, { texture: texture() });
        expect(particle.alpha).toBe(1);
    });

    it('destroying a particle detaches it and keeps its texture unless the options transfer it', () =>
    {
        const { container, particles: [a, b] } = setup();
        const owned = new pixi.Texture({ source: pixi.Texture.WHITE.source });
        const destroy = vi.spyOn(owned, 'destroy');

        (b as Any).texture = owned;
        scene.destroyNode(a, undefined);
        expect(container.particleChildren).not.toContain(a);
        scene.remove(container, b);
        scene.destroyNode(b, { texture: true });
        expect(destroy).toHaveBeenCalledWith(false);
    });

    it(`removeParticleRange removes [begin, end) on ${version} (8.10 changed removeParticles)`, () =>
    {
        const { container, particles: [a, b, c] } = setup();

        expect(scene.removeParticleRange(container, 1, 2)).toEqual([b]);
        expect(container.particleChildren).toEqual([a, c]);
        expect(scene.removeParticleRange(container, 0, 0)).toEqual([]);
        expect(scene.removeParticleRange(container, 0, 99)).toEqual([a, c]);
    });

    it(`raw removeParticles characterization on ${version}`, () =>
    {
        const atLeast810 = scene.features.removeParticlesEndIndex;
        const omitted = setup();

        // No end index: nothing before 8.10, everything from 8.10.
        omitted.container.removeParticles(0);
        expect(omitted.container.particleChildren.length).toBe(atLeast810 ? 0 : 3);

        // (1, 2): before 8.10 the second argument was a delete count, so two particles went.
        const explicit = setup();

        explicit.container.removeParticles(1, 2);
        expect(explicit.container.particleChildren.length).toBe(atLeast810 ? 2 : 1);
        expect(atLeast810).toBe(version === '8.22.0');
    });
});
