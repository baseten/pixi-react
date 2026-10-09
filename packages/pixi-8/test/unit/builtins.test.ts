import { describe, expect, it } from 'vitest';
import { bindPixi, PIXI8_BINDING_EXPORTS } from '../../src/bind';
import { BUILTIN_SIGNATURES, BuiltinMatcher, type BuiltinName } from '../../src/builtins';
import { detectFeatures } from '../../src/nodes';
import { PIXI8_BOUNDARIES } from '../../src/version';
import { cells } from './cells';

type Any = Record<string, any>;

const isSubclass = (ctor: unknown, base: unknown) =>
    typeof ctor === 'function' && typeof base === 'function' && (ctor === base || ctor.prototype instanceof base);

/**
 * The adapter recognizes built-ins it does not import by their signatures (`src/builtins.ts`), so tree shaking can
 * drop every class an application does not register. On each tested Pixi version, recognition must agree with class
 * identity for every function pixi.js exports: no Pixi class is mistaken for a built-in, and none is missed.
 */
describe.each(cells)('built-in recognition on pixi.js $version', ({ pixi }) =>
{
    const matcher = new BuiltinMatcher(pixi);
    const exported = Object.entries(pixi as Any).filter(([, value]) => typeof value === 'function');

    it.each(Object.keys(BUILTIN_SIGNATURES) as BuiltinName[])('%s matches exactly the exports that extend it', (name) =>
    {
        const builtin = (pixi as Any)[name] as unknown;
        const mismatches = exported
            .filter(([, ctor]) => matcher.builtinOf(ctor, name) !== (isSubclass(ctor, builtin) ? builtin : undefined))
            .map(([key]) => key);

        expect(mismatches).toEqual([]);
    });

    it('finds the built-in itself below a subclass that redeclares its whole signature', () =>
    {
        class Overriding extends pixi.Sprite
        {
            get anchor() { return super.anchor; }
            set anchor(value) { super.anchor = value; }
            get texture() { return super.texture; }
            set texture(value) { super.texture = value; }
            get sourceBounds() { return super.sourceBounds; }
        }
        class Deeper extends Overriding
        {}

        expect(matcher.builtinOf(Deeper, 'Sprite')).toBe(pixi.Sprite);
        expect(matcher.builtinOf(pixi.AnimatedSprite, 'Sprite')).toBe(pixi.Sprite);
        expect(matcher.childOf(Deeper, 'Sprite')).toBe(Overriding);
        expect(matcher.childOf(pixi.Text, 'AbstractText')).toBe(pixi.Text);
        expect(matcher.builtinOf(pixi.Container, 'Sprite')).toBeUndefined();
        expect(matcher.builtinOf(undefined, 'Sprite')).toBeUndefined();
    });

    it('detects the optional features from VERSION, in agreement with the exports', () =>
    {
        const features = detectFeatures(pixi);

        expect(features.particles).toBe(typeof (pixi as Any).Particle === 'function' && typeof (pixi as Any).ParticleContainer === 'function');
        expect(features.renderLayer).toBe(typeof (pixi as Any).RenderLayer === 'function');
        expect(features.domContainer).toBe(typeof (pixi as Any).DOMContainer === 'function');
    });

    it('binds the named exports alone, and the namespace, to the same exports; it keeps only the binding exports', () =>
    {
        const named = Object.fromEntries(PIXI8_BINDING_EXPORTS.map((key) => [key, (pixi as Any)[key]]));
        const bound = bindPixi(named as never);

        expect(bindPixi(pixi)).toBe(bound);
        expect(Object.keys(new bound.Pixi8Adapter().pixi).sort()).toEqual([...PIXI8_BINDING_EXPORTS].sort());
    });
});

describe('the binding', () =>
{
    it('lists only exports of the 8.2.6 floor, so a strict ESM named import never fails in the peer range', () =>
    {
        const [floor] = cells;

        expect(PIXI8_BINDING_EXPORTS.filter((name) => !(name in floor.pixi))).toEqual([]);
    });

    it('rejects a binding that lacks an export, naming it', () =>
    {
        const [{ pixi }] = cells;
        // A distinct Container identity makes this another Pixi module, so nothing cached answers it.
        const binding = { ...pixi, Container: class extends pixi.Container {}, TextStyle: undefined };

        expect(() => bindPixi(binding as never)).toThrow(/missing TextStyle/);
        expect(() => bindPixi({} as never)).toThrow(TypeError);
    });

    it('feature boundaries are the first versions that export the optional classes', () =>
    {
        expect(detectFeatures({ VERSION: '8.4.1' })).toMatchObject({ particles: false, renderLayer: false, domContainer: false });
        expect(detectFeatures({ VERSION: PIXI8_BOUNDARIES.particles })).toMatchObject({ particles: true, renderLayer: false });
        expect(detectFeatures({ VERSION: '8.6.6' })).toMatchObject({ particles: true, renderLayer: false, domContainer: false });
        expect(detectFeatures({ VERSION: '8.8.1' })).toMatchObject({ renderLayer: true, domContainer: false });
        expect(detectFeatures({ VERSION: '8.9.0' })).toMatchObject({ particles: true, renderLayer: true, domContainer: true });
        expect(detectFeatures({ VERSION: 'not a version' })).toMatchObject({ particles: false, renderLayer: false, domContainer: false });
    });
});
