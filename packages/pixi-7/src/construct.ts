/**
 * Pixi 7 constructors are positional (`new Sprite(texture)`, `new Text(text, style)`, `new BlurFilter(strength, ...)`),
 * where Pixi 8's take one options object. This table names, for each built-in, the props that become its positional
 * arguments, in order. The adapter constructs a node with these arguments and then applies the remaining props as
 * instance properties.
 *
 * Which signature a class uses (`signatureOf`): the nearest class in its prototype chain that has a row and either is
 * the class itself or marks its row `inherited`. Display objects pass their row on to subclasses (`class Bunny extends
 * Sprite {}` is constructed as `new Bunny(texture)`); filter rows apply only to the built-in itself, because custom
 * filters (pixi-filters, for example) declare constructors of their own. A class with no applicable row (`Container`,
 * its custom subclasses, custom filters) receives one options object, as on Pixi 8: the props without React-owned
 * keys, event handlers, `draw` and dashed props.
 */

/** One positional argument. */
export interface PositionalArgument
{
    /** The prop that supplies it. */
    readonly prop: string;
    /**
     * `property` (the default): after construction the prop is an instance property of the same meaning, so an update
     * assigns it. `constructor`: the instance has no property of that meaning (or one with another meaning, as
     * `DisplacementFilter.scale`, a Point), so an update cannot apply it; the adapter warns and keeps the node.
     */
    readonly update?: 'property' | 'constructor';
}

export interface ConstructorSignature
{
    readonly args: readonly PositionalArgument[];
    /** Whether subclasses are constructed with the same arguments. */
    readonly inherited: boolean;
}

const args = (...props: Array<string | PositionalArgument>): readonly PositionalArgument[] =>
    Object.freeze(props.map((prop) => Object.freeze(typeof prop === 'string' ? { prop } : prop)));
const constructorOnly = (prop: string): PositionalArgument => ({ prop, update: 'constructor' });

/** The positional constructors of the pixi.js 7 built-ins, keyed by export name (7.4.2 and 7.4.3 declare the same). */
export const POSITIONAL_CONSTRUCTORS = Object.freeze({
    Sprite: { args: args('texture'), inherited: true },
    AnimatedSprite: { args: args('textures', 'autoUpdate'), inherited: true },
    TilingSprite: { args: args('texture', 'width', 'height'), inherited: true },
    Text: { args: args('text', 'style', 'canvas'), inherited: true },
    HTMLText: { args: args('text', 'style'), inherited: true },
    // BitmapText has no `style` property: its style options are separate properties (`fontName`, `fontSize`, ...).
    BitmapText: { args: args('text', constructorOnly('style')), inherited: true },
    Graphics: { args: args(constructorOnly('geometry')), inherited: true },
    Mesh: { args: args('geometry', 'shader', 'state', 'drawMode'), inherited: true },
    SimpleMesh: { args: args('texture', 'vertices', constructorOnly('uvs'), constructorOnly('indices'), 'drawMode'), inherited: true },
    SimplePlane: { args: args('texture', constructorOnly('verticesX'), constructorOnly('verticesY')), inherited: true },
    SimpleRope: { args: args('texture', constructorOnly('points'), constructorOnly('textureScale')), inherited: true },
    NineSlicePlane: { args: args('texture', 'leftWidth', 'topHeight', 'rightWidth', 'bottomHeight'), inherited: true },
    ParticleContainer: { args: args(constructorOnly('maxSize'), constructorOnly('properties'), constructorOnly('batchSize'), 'autoResize'), inherited: true },
    Filter: { args: args(constructorOnly('vertexSrc'), constructorOnly('fragmentSrc'), constructorOnly('uniforms')), inherited: false },
    AlphaFilter: { args: args('alpha'), inherited: false },
    BlurFilter: { args: args(constructorOnly('strength'), 'quality', 'resolution', constructorOnly('kernelSize')), inherited: false },
    ColorMatrixFilter: { args: args(), inherited: false },
    DisplacementFilter: { args: args(constructorOnly('sprite'), constructorOnly('scale')), inherited: false },
    FXAAFilter: { args: args(), inherited: false },
    NoiseFilter: { args: args('noise', 'seed'), inherited: false },
} as const satisfies Record<string, ConstructorSignature>);

export type PositionalBuiltin = keyof typeof POSITIONAL_CONSTRUCTORS;

/** Any class, for prototype-chain walks. */
type ClassLike = abstract new (...params: any[]) => unknown;

const FUNCTION_PROTOTYPE: unknown = Object.getPrototypeOf(Object);

/** `ctor` and its ancestors, most derived first. */
export function *classChain(ctor: unknown): Generator<ClassLike>
{
    for (let current = ctor; typeof current === 'function' && current !== FUNCTION_PROTOTYPE; current = Object.getPrototypeOf(current))
    {
        yield current as ClassLike;
    }
}

/** The signature `ctor` is constructed with, or `undefined` for the options object. */
export function signatureOf(ctor: unknown, builtins: Readonly<Record<PositionalBuiltin, unknown>>): ConstructorSignature | undefined
{
    const rows = new Map<unknown, ConstructorSignature>(
        (Object.keys(POSITIONAL_CONSTRUCTORS) as PositionalBuiltin[]).map((name) => [builtins[name], POSITIONAL_CONSTRUCTORS[name]]),
    );

    for (const current of classChain(ctor))
    {
        const row = rows.get(current);

        if (row && (current === ctor || row.inherited))
        {
            return row;
        }
    }

    return undefined;
}
