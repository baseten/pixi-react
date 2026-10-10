import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixiNodes, resetWarnings } from '../../src/nodes';
import { cells, withParticles } from './cells';
import { CompatibilityError } from '@pixi-react-provisional/core';

import type { ParticleContainerLike, ParticleLike, PixiModule } from '../../src/pixi';

type Any = Record<string, any>;

const nodesFor = (pixi: PixiModule, enabled: (capability: string) => boolean = () => true) => new PixiNodes(pixi, enabled);

function make(nodes: PixiNodes, ctor: new (...args: any[]) => object, props: Any = {}, name = 'Node'): Any
{
    return nodes.create(nodes.describe(ctor as never, name), props) as Any;
}

afterEach(() =>
{
    vi.restoreAllMocks();
    resetWarnings();
});

describe.each(cells)('node definitions on pixi.js $version', ({ pixi }) =>
{
    const nodes = nodesFor(pixi);

    it('Containers are children that accept children and filters', () =>
    {
        expect(nodes.describe(pixi.Sprite, 'Sprite')).toEqual({
            name: 'Sprite',
            ctor: pixi.Sprite,
            capabilities: { 'pixi.mutation': 1 },
            attach: { role: 'child', accepts: ['child', 'filter'] },
        });
    });

    // Filter instances need a DOM canvas (shader precision probe); their tree behaviour is tested in the browser cells.
    it('Filters attach as filters and need pixi8.filter', () =>
    {
        expect(nodes.describe(pixi.BlurFilter, 'BlurFilter')).toMatchObject({
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
                nodes.describe(pixi[name] as never, name);
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
        const strict = nodesFor(pixi, (capability) => capability !== 'pixi8.filter');

        expect(() => strict.describe(pixi.BlurFilter, 'BlurFilter')).toThrow(/pixi8\.filter/);
    });
});

describe.each(withParticles)('special nodes on pixi.js $version', ({ pixi }) =>
{
    const nodes = nodesFor(pixi);

    it('Particle is its own role and ParticleContainer accepts only particles and filters', () =>
    {
        expect(nodes.describe(pixi.Particle!, 'Particle')).toMatchObject({
            capabilities: { 'pixi8.particle': 1 },
            attach: { role: 'particle', accepts: [] },
        });
        expect(nodes.describe(pixi.ParticleContainer!, 'ParticleContainer')).toMatchObject({
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
            expect(nodes.describe((pixi as Any)[name], name), name).toMatchObject({ attach: { role: 'child', accepts: ['filter'] } });
        }

        // A custom subclass inherits the rule; describe() constructs nothing.
        class Custom extends pixi.MeshPlane
        {}

        expect(nodes.describe(Custom, 'Custom').attach).toEqual({ role: 'child', accepts: ['filter'] });
        expect(nodes.describe(pixi.NineSliceSprite, 'NineSliceSprite').attach.accepts, 'unchanged').toEqual(['child', 'filter']);
    });

    it('RenderLayer and DOMContainer are capability-gated leaves', () =>
    {
        expect(nodes.describe(pixi.RenderLayer!, 'RenderLayer')).toMatchObject({
            capabilities: { 'pixi8.render-layer': 1 },
            attach: { role: 'child', accepts: [] },
        });
        expect(nodes.describe(pixi.DOMContainer!, 'DOMContainer')).toMatchObject({
            capabilities: { 'pixi8.dom-container': 1 },
            attach: { role: 'child', accepts: [] },
        });

        const without = nodesFor(pixi, () => false);

        for (const name of ['Particle', 'ParticleContainer', 'RenderLayer', 'DOMContainer'] as const)
        {
            expect(() => without.describe(pixi[name]!, name), name).toThrow(CompatibilityError);
        }
    });
});

describe.each(cells)('props on pixi.js $version', ({ pixi }) =>
{
    const nodes = nodesFor(pixi);

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
        const node = make(nodes, Custom, { label: 'c', alpha: 0.5, 'position-x': 10, 'scale-y': 2, onPointerTap, children: [], key: 'k', ref: null });

        expect(seen).toEqual([{ label: 'c', alpha: 0.5 }]);
        expect(node).not.toHaveProperty('position-x');
        expect([node.position.x, node.scale.y, node.scale.x]).toEqual([10, 2, 1]);
        expect(node.onpointertap).toBe(onPointerTap);
    });

    it('restores kind defaults for props that came through the constructor', () =>
    {
        const props = { alpha: 0.5, x: 10, scale: { x: 3, y: 4 }, anchor: { x: 0.5, y: 0.5 } };
        const sprite = make(nodes, pixi.Sprite, props);

        expect([sprite.alpha, sprite.x, sprite.scale.y, sprite.anchor.x]).toEqual([0.5, 10, 4, 0.5]);
        nodes.applyChanges(sprite, props, {});
        expect([sprite.alpha, sprite.x, sprite.scale.x, sprite.scale.y, sprite.anchor.x]).toEqual([1, 0, 1, 1, 0]);
    });

    it('restores Text kind defaults from a blank Text, recognized without importing Text', () =>
    {
        class Label extends pixi.Text
        {}
        const props = { text: 'hello', anchor: { x: 0.5, y: 0.5 }, resolution: 2 };
        const label = make(nodes, Label, props);

        expect([label.text, label.anchor.x, label.resolution]).toEqual(['hello', 0.5, 2]);
        nodes.applyChanges(label, props, {});
        expect([label.text, label.anchor.x]).toEqual([new pixi.Text().text, 0]);
    });

    it('never constructs a custom class that redeclares a built-in signature', () =>
    {
        let constructions = 0;

        class Overriding extends pixi.Sprite
        {
            constructor(options?: Any)
            {
                super(options);
                constructions += 1;
            }

            get anchor() { return super.anchor; }
            set anchor(value) { super.anchor = value; }
            get texture() { return super.texture; }
            set texture(value) { super.texture = value; }
            get sourceBounds() { return super.sourceBounds; }
        }
        const props = { anchor: { x: 0.5, y: 0.5 } };
        const sprite = make(nodes, Overriding, props);

        nodes.applyChanges(sprite, props, {});
        expect([sprite.anchor.x, constructions]).toEqual([0, 1]);
    });

    it('falls back to no kind default when a signature-only custom class needs constructor arguments', () =>
    {
        // Declares all of Sprite's signature without extending Sprite, so it is recognized as Sprite (README).
        class LooksLikeSprite extends pixi.Container
        {
            private readonly options: Any;

            constructor(options: Any)
            {
                if (!options)
                {
                    throw new Error('LooksLikeSprite needs options');
                }

                super(options);
                this.options = options;
            }

            get anchor() { return this.options.anchor; }
            set anchor(value) { this.options.anchor = value; }
            get texture() { return undefined; }
            set texture(_value) { /* unused */ }
            get sourceBounds() { return undefined; }
        }
        const props = { alpha: 0.5 };
        const node = make(nodes, LooksLikeSprite, props);

        expect(nodes.builtins.builtinOf(LooksLikeSprite, 'Sprite')).toBe(LooksLikeSprite);
        expect(() => nodes.applyChanges(node, props, {})).not.toThrow();
    });

    it('falls back to no kind default when a signature-only blank instance throws from its accessors', () =>
    {
        const blank = new WeakSet<object>();

        class LooksLikeSprite extends pixi.Container
        {
            constructor(options?: Any)
            {
                super(options);
                if (!options)
                {
                    blank.add(this);
                }
            }

            get anchor() { return { x: 0, y: 0 }; }
            set anchor(_value) { /* unused */ }
            // Its zero-argument constructor succeeds, but a blank instance cannot report a texture.
            get texture(): string
            {
                if (blank.has(this))
                {
                    throw new Error('LooksLikeSprite was built without options');
                }

                return 'set';
            }

            set texture(_value: string) { /* unused */ }
            get sourceBounds() { return undefined; }
        }
        const props = { texture: 'set' };
        const node = make(nodes, LooksLikeSprite, props);

        expect(nodes.builtins.builtinOf(LooksLikeSprite, 'Sprite')).toBe(LooksLikeSprite);
        expect(() => nodes.applyChanges(node, props, {})).not.toThrow();
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
        const custom = make(nodes, Strict, { alpha: 0.75 });

        expect(custom.alpha).toBe(0.75);
        nodes.applyChanges(custom, { alpha: 0.75 }, {});
        expect(custom.alpha).toBe(0.25);

        const strict = make(nodes, Strict, { alpha: 0.5 });

        nodes.applyChanges(strict, { alpha: 0.5 }, {});
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

        const node = make(nodes, Offset, { position: { x: 1, y: 2 }, 'position-x': 10 }, 'Offset');

        expect(node.x).toBe(10);
        nodes.applyChanges(node, { position: { x: 1, y: 2 }, 'position-x': 10 }, {});
        expect([node.x, node.y]).toEqual([7, 8]);
    });

    it('dashed props: removal resets only the nested field; a changed parent re-applies its dashed child', () =>
    {
        const node = make(nodes, pixi.Container, { position: { x: 1, y: 2 }, 'position-x': 10 });

        expect([node.position.x, node.position.y]).toEqual([10, 2]);
        nodes.applyChanges(node, { position: { x: 1, y: 2 }, 'position-x': 10 }, { position: { x: 5, y: 6 }, 'position-x': 10 });
        expect([node.position.x, node.position.y]).toEqual([10, 6]);
        nodes.applyChanges(node, { position: { x: 5, y: 6 }, 'position-x': 10 }, { position: { x: 5, y: 6 } });
        expect([node.position.x, node.position.y], 'the remaining parent prop wins').toEqual([5, 6]);

        const alone = make(nodes, pixi.Container, {});

        nodes.applyChanges(alone, {}, { 'position-x': 10, 'position-y': 4 });
        nodes.applyChanges(alone, { 'position-x': 10, 'position-y': 4 }, { 'position-y': 4 });
        expect([alone.position.x, alone.position.y]).toEqual([0, 4]);
    });

    it('text style removal restores a fresh default style', () =>
    {
        const text = make(nodes, pixi.Text, { text: 'a', style: { fontSize: 20 } });

        expect(text.style.fontSize).toBe(20);
        nodes.applyChanges(text, { text: 'a', style: { fontSize: 20 } }, { text: 'a' });
        expect(text.style.fontSize).toBe(new pixi.Text().style.fontSize);
    });

    it('events: add, replace and remove set the Pixi handler property; Pixi names warn and are ignored', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const first = () => undefined;
        const second = () => undefined;
        const node = make(nodes, pixi.Container, { onPointerTap: first, onWheel: first });

        nodes.applyChanges(node, { onPointerTap: first, onWheel: first }, { onPointerTap: second });
        expect(node.onpointertap).toBe(second);
        expect(node.onwheel).toBeNull();

        const pixiNamed = make(nodes, pixi.Container, { onpointerdown: first });

        expect(pixiNamed.onpointerdown ?? null).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).toMatch(/onPointerDown/);
    });

    it('production builds ignore Pixi-named event props and draw on a non-Graphics node the same way, without warning', () =>
    {
        const env = process.env.NODE_ENV;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const handler = () => undefined;
        const draw = vi.fn();

        // The warnings are development-only (issue 58): the source reads NODE_ENV as written, for bundlers to replace.
        process.env.NODE_ENV = 'production';

        try
        {
            const node = make(nodes, pixi.Container, { onpointerdown: handler, draw });

            expect(node.onpointerdown ?? null).toBeNull();
            expect(draw).not.toHaveBeenCalled();
            nodes.applyChanges(node, { onpointerdown: handler, draw }, { 'missing-field': 1 });
            expect(warn).not.toHaveBeenCalled();
        }
        finally
        {
            process.env.NODE_ENV = env;
        }
    });

    it('draw runs on mount and on identity change, only for Graphics', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const calls: unknown[] = [];
        const draw = (graphics: unknown) => calls.push(graphics);
        const graphics = make(nodes, pixi.Graphics, { draw });

        nodes.applyChanges(graphics, { draw }, { draw, alpha: 0.5 });
        expect(calls).toEqual([graphics]);
        nodes.applyChanges(graphics, { draw }, { draw: (g: unknown) => calls.push(g) });
        expect(calls).toEqual([graphics, graphics]);

        make(nodes, pixi.Container, { draw });
        expect(calls).toHaveLength(2);
        expect(warn).toHaveBeenCalled();
    });

    it('readonly members are never written', () =>
    {
        const node = make(nodes, pixi.Container, {});

        expect(() => nodes.applyChanges(node, {}, { worldTransform: { a: 2 } })).not.toThrow();
        expect(node.worldTransform.a).toBe(1);
    });

    it('React visibility restores the latest committed visible value', () =>
    {
        const node = make(nodes, pixi.Container, { visible: false });

        nodes.setHidden(node, true);
        nodes.setHidden(node, false);
        expect(node.visible).toBe(false);

        nodes.setHidden(node, true);
        nodes.applyChanges(node, { visible: false }, { visible: true });
        expect(node.visible).toBe(false);
        nodes.setHidden(node, false);
        expect(node.visible).toBe(true);

        const late = make(nodes, pixi.Container, {});

        nodes.setHidden(late, true);
        nodes.applyChanges(late, {}, { visible: false });
        nodes.applyChanges(late, { visible: false }, {});
        expect(late.visible, 'still hidden').toBe(false);
        nodes.setHidden(late, false);
        expect(late.visible, 'initial value captured from before the hide').toBe(true);

        const plain = make(nodes, pixi.Container, {});

        nodes.setHidden(plain, true);
        expect(plain.visible).toBe(false);
        nodes.setHidden(plain, false);
        expect(plain.visible).toBe(true);
    });

    it('a removed visible prop stops owning visibility, so imperative changes survive a hide/unhide cycle', () =>
    {
        const node = make(nodes, pixi.Container, { visible: false });

        nodes.applyChanges(node, { visible: false }, {});
        expect(node.visible, 'removal restores the initial value').toBe(true);

        node.visible = false;
        nodes.setHidden(node, true);
        nodes.setHidden(node, false);
        expect(node.visible, 'value held just before hiding').toBe(false);

        const hidden = make(nodes, pixi.Container, { visible: false });

        nodes.setHidden(hidden, true);
        nodes.applyChanges(hidden, { visible: false }, {});
        nodes.setHidden(hidden, false);
        expect(hidden.visible, 'removal while hidden restores the initial value on unhide').toBe(true);
    });

    it('destroys containers with the options and each node at most once', () =>
    {
        const container = make(nodes, pixi.Container, {});
        const destroy = vi.spyOn(container as { destroy(options?: unknown): void }, 'destroy');
        const options = { children: true, texture: true };

        nodes.destroyNode(container, options);
        nodes.destroyNode(container, options);
        expect(destroy.mock.calls).toEqual([[options]]);
        expect(nodes.isDestroyed(container)).toBe(true);
    });

    it('a node moved straight to another parent leaves the old parent\'s JSX order', () =>
    {
        const [from, to] = [make(nodes, pixi.Container), make(nodes, pixi.Container)];
        const [a, b] = ['a', 'b'].map((label) => make(nodes, pixi.Container, { label }));
        const f = Object.create(pixi.Filter.prototype) as object;

        nodes.append(from, f);
        nodes.append(from, a);
        // Core reparents without removing from the old parent first.
        nodes.append(to, a);
        nodes.insertBefore(from, b, f);
        expect(from.children).toEqual([b]);
        expect(to.children).toEqual([a]);
    });

    it('standalone applyProps works on an instance the scene never created', () =>
    {
        const node = new pixi.Container() as unknown as Any;

        nodes.applyChanges(node, {}, { alpha: 0.5, 'position-y': 9 });
        expect([node.alpha, node.position.y]).toEqual([0.5, 9]);
    });
});

describe.each(withParticles)('particles on pixi.js $version', ({ pixi, version }) =>
{
    const nodes = nodesFor(pixi);
    const texture = () => pixi.Texture.WHITE;
    const setup = () =>
    {
        const container = make(nodes, pixi.ParticleContainer!, {}) as unknown as ParticleContainerLike;
        const particles = ['a', 'b', 'c'].map((label) => make(nodes, pixi.Particle!, { texture: texture(), x: label.charCodeAt(0) }));

        for (const particle of particles)
        {
            nodes.append(container, particle);
        }

        return { container, particles: particles as unknown as ParticleLike[] };
    };

    it('attaches through addParticle, reorders with addParticleAt and detaches exactly one particle', () =>
    {
        const { container, particles: [a, b, c] } = setup();

        expect(container.particleChildren).toEqual([a, b, c]);
        nodes.insertBefore(container, c, a);
        expect(container.particleChildren).toEqual([c, a, b]);
        nodes.remove(container, a);
        expect(container.particleChildren).toEqual([c, b]);
        nodes.append(container, c);
        expect(container.particleChildren).toEqual([b, c]);
    });

    it('insertions next to a filter sibling keep the JSX order of particles and of filters', () =>
    {
        const container = make(nodes, pixi.ParticleContainer!, {}) as unknown as ParticleContainerLike & { filters: unknown };
        const [a, b, c] = ['a', 'b', 'c'].map((label) => make(nodes, pixi.Particle!, { texture: texture(), x: label.charCodeAt(0) }));
        // Real filters need a DOM; the adapter tells filters apart by prototype, so bare instances stand in for them.
        const [f0, f1, f2] = [0, 1, 2].map(() => Object.create(pixi.Filter.prototype) as object);

        for (const child of [a, f1, c, f2]) nodes.append(container, child);

        // A particle before a filter goes before the next particle in JSX order (c), not last.
        nodes.insertBefore(container, b, f1);
        expect(container.particleChildren).toEqual([a, b, c]);
        // A filter before a particle goes before the next filter in JSX order (f2), not last.
        nodes.insertBefore(container, f0, c);
        expect(container.filters).toEqual([f1, f0, f2]);
        // With no particle after the filter, the particle goes last.
        nodes.remove(container, a);
        nodes.insertBefore(container, a, f2);
        expect(container.particleChildren).toEqual([b, c, a]);
    });

    it('hides a particle through alpha and restores its committed alpha', () =>
    {
        const particle = make(nodes, pixi.Particle!, { texture: texture(), alpha: 0.5 }) as Any;

        nodes.setHidden(particle, true);
        expect(particle.alpha).toBe(0);
        nodes.setHidden(particle, false);
        expect(particle.alpha).toBe(0.5);
        nodes.applyChanges(particle, { texture: texture(), alpha: 0.5 }, { texture: texture() });
        expect(particle.alpha).toBe(1);
    });

    it('destroying a particle detaches it and keeps its texture unless the options transfer it', () =>
    {
        const { container, particles: [a, b] } = setup();
        const owned = new pixi.Texture({ source: pixi.Texture.WHITE.source });
        const destroy = vi.spyOn(owned, 'destroy');

        (b as Any).texture = owned;
        nodes.destroyNode(a, undefined);
        expect(container.particleChildren).not.toContain(a);
        nodes.remove(container, b);
        nodes.destroyNode(b, { texture: true });
        expect(destroy).toHaveBeenCalledWith(false);
    });

    it(`removeParticleRange removes [begin, end) on ${version} (8.10 changed removeParticles)`, () =>
    {
        const { container, particles: [a, b, c] } = setup();

        expect(nodes.removeParticleRange(container, 1, 2)).toEqual([b]);
        expect(container.particleChildren).toEqual([a, c]);
        expect(nodes.removeParticleRange(container, 0, 0)).toEqual([]);
        expect(nodes.removeParticleRange(container, 0, 99)).toEqual([a, c]);
    });

    it(`raw removeParticles characterization on ${version}`, () =>
    {
        const atLeast810 = nodes.features.removeParticlesEndIndex;
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
