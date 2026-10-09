/**
 * Recognizes Pixi built-in classes in a registered constructor's prototype chain without importing them.
 *
 * The adapter treats some built-ins specially: Particle and ParticleContainer, RenderLayer, DOMContainer, the split
 * texts and Mesh change a node's attach rules, and Sprite, Text, TilingSprite and four filters supply kind defaults.
 * Comparing against the classes themselves would make the adapter reference every one of them, and a bundler would
 * then keep all of them in every application, used or not. Upstream's `extend` model is that an application
 * registers the classes it uses, so the adapter recognizes those classes from what is registered instead: a built-in
 * is the least-derived class in the chain whose own prototype declares the built-in's distinctive members (its
 * signature). Every class Pixi exports is checked against these signatures on each tested Pixi version
 * (`test/unit/builtins.test.ts`).
 *
 * The least-derived match is the built-in itself even when a subclass overrides the same members, so a custom class
 * is never mistaken for the built-in it extends. A custom class that declares a whole signature without extending the
 * built-in is treated like the built-in.
 */

/** Any class, for prototype-chain walks. */
type ClassLike = abstract new (...args: any[]) => unknown;

/** Any function: a class, or anything else a catalog might hold. */
type AnyFunction = ClassLike | ((...args: never[]) => unknown);

/**
 * What a built-in declares itself: the Pixi base class it extends, its distinctive own prototype members and,
 * optionally, keys of its own static default options.
 */
export interface BuiltinSignature
{
    /** `Container` or `Filter` when the built-in extends that class; `null` when it extends neither (Particle). */
    readonly base: 'Container' | 'Filter' | null;
    /** Methods or accessors the built-in's own prototype declares. */
    readonly members: readonly string[];
    /** Keys of the built-in's own static `defaultOptions` object. */
    readonly defaultOptions?: readonly string[];
}

/** The signatures of the built-ins the adapter recognizes, stable across the peer range (8.2.6 to 8.22). */
export const BUILTIN_SIGNATURES = Object.freeze({
    /** 8.5+. Not a Container: its prototype declares only its colour accessors, its static options the particle fields. */
    Particle: { base: null, members: ['alpha', 'tint'], defaultOptions: ['anchorX', 'anchorY', 'scaleX', 'scaleY', 'rotation'] },
    /** 8.5+. */
    ParticleContainer: { base: 'Container', members: ['addParticle', 'addParticleAt', 'removeParticle', 'removeParticleAt', 'removeParticles'] },
    /** 8.7+. */
    RenderLayer: { base: 'Container', members: ['attach', 'detach', 'detachAll', 'sortRenderLayerChildren'] },
    /** 8.9+. */
    DOMContainer: { base: 'Container', members: ['anchor', 'element'] },
    /** 8.11+: the shared base of `SplitText` and `SplitBitmapText`. */
    AbstractSplitText: { base: 'Container', members: ['split', 'lineAnchor', 'wordAnchor', 'charAnchor'] },
    /** Also the base of `MeshPlane`, `MeshRope`, `MeshSimple` and `PerspectiveMesh`. */
    Mesh: { base: 'Container', members: ['geometry', 'shader', 'material', 'batched'] },
    Sprite: { base: 'Container', members: ['anchor', 'texture', 'sourceBounds'] },
    /** The shared base of `Text`, `BitmapText` and `HTMLText`. */
    AbstractText: { base: 'Container', members: ['anchor', 'text', 'style', 'resolution'] },
    TilingSprite: { base: 'Container', members: ['tilePosition', 'tileScale', 'tileRotation', 'tileTransform'] },
    AlphaFilter: { base: 'Filter', members: ['alpha'], defaultOptions: ['alpha'] },
    BlurFilter: { base: 'Filter', members: ['blurX', 'blurY', 'quality', 'repeatEdgePixels'] },
    ColorMatrixFilter: { base: 'Filter', members: ['matrix', 'brightness', 'contrast', 'hue', 'saturate', 'greyscale'] },
    NoiseFilter: { base: 'Filter', members: ['noise', 'seed'], defaultOptions: ['noise'] },
} as const satisfies Record<string, BuiltinSignature>);

export type BuiltinName = keyof typeof BUILTIN_SIGNATURES;

/** The two base classes the adapter imports by name; signatures are matched only below the right one. */
export interface BuiltinBases
{
    readonly Container: AnyFunction;
    readonly Filter: AnyFunction;
}

const FUNCTION_PROTOTYPE: unknown = Object.getPrototypeOf(Object);
const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

function isSubclass(ctor: AnyFunction, base: AnyFunction): boolean
{
    return ctor === base || ctor.prototype instanceof base;
}

/** Whether `cls` itself (not an ancestor) declares the members and default options of `signature`. Reads no getter. */
function declares(cls: AnyFunction, signature: BuiltinSignature): boolean
{
    const prototype: unknown = cls.prototype;

    if (typeof prototype !== 'object' || prototype === null || !signature.members.every((member) => hasOwn(prototype, member)))
    {
        return false;
    }

    if (!signature.defaultOptions)
    {
        return true;
    }

    const options: unknown = Object.getOwnPropertyDescriptor(cls, 'defaultOptions')?.value;

    return typeof options === 'object' && options !== null && signature.defaultOptions.every((key) => key in options);
}

/** `ctor` and its ancestors, most derived first. */
export function *classChain(ctor: unknown): Generator<AnyFunction>
{
    for (let current = ctor; typeof current === 'function' && current !== FUNCTION_PROTOTYPE; current = Object.getPrototypeOf(current))
    {
        yield current as AnyFunction;
    }
}

/** Finds built-ins in prototype chains, below the `Container` and `Filter` of one Pixi module. Results are cached. */
export class BuiltinMatcher
{
    private readonly found = new WeakMap<AnyFunction, Map<BuiltinName, ClassLike | null>>();

    constructor(private readonly bases: BuiltinBases)
    {}

    /** The built-in `name` in `ctor`'s prototype chain (itself included), or `undefined` when it does not extend it. */
    builtinOf(value: unknown, name: BuiltinName): ClassLike | undefined
    {
        if (typeof value !== 'function')
        {
            return undefined;
        }

        const ctor = value as AnyFunction;
        let cache = this.found.get(ctor);

        if (!cache)
        {
            cache = new Map();
            this.found.set(ctor, cache);
        }

        let result = cache.get(name);

        if (result === undefined)
        {
            result = this.search(ctor, BUILTIN_SIGNATURES[name]);
            cache.set(name, result);
        }

        return result ?? undefined;
    }

    /** Whether `ctor` is the built-in `name` or extends it. */
    is(ctor: unknown, name: BuiltinName): boolean
    {
        return this.builtinOf(ctor, name) !== undefined;
    }

    /**
     * The class directly below the built-in `name` in `ctor`'s chain: for `AbstractText`, which of `Text`,
     * `BitmapText` or `HTMLText` (or a custom direct subclass) `ctor` extends.
     */
    childOf(ctor: unknown, name: BuiltinName): ClassLike | undefined
    {
        const base = this.builtinOf(ctor, name);

        if (!base)
        {
            return undefined;
        }

        for (const current of classChain(ctor))
        {
            if (Object.getPrototypeOf(current) === base)
            {
                return current as ClassLike;
            }
        }

        return undefined;
    }

    private search(ctor: AnyFunction, signature: BuiltinSignature): ClassLike | null
    {
        const { Container, Filter } = this.bases;
        const below = (base: AnyFunction) => isSubclass(ctor, base);
        const inScope = signature.base === null ? !below(Container) && !below(Filter) : below(this.bases[signature.base]);

        if (!inScope)
        {
            return null;
        }

        let result: ClassLike | null = null;

        for (const current of classChain(ctor))
        {
            if (current === this.bases.Container || current === this.bases.Filter)
            {
                break;
            }

            if (declares(current, signature))
            {
                // Keep walking: the least-derived class declaring the signature is the built-in itself.
                result = current as ClassLike;
            }
        }

        return result;
    }
}
