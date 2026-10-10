/**
 * Pixi 7 `PixiTypes` and the public constructor-to-props mapping. Every type is derived from the consumer's installed
 * pixi.js 7 declarations. Nothing here names a Pixi 8 type (`GraphicsContext`, `TextOptions`, `ApplicationOptions`,
 * `RendererDestroyOptions`), and nothing reuses the Pixi 8 adapter's mapping.
 *
 * Pixi 7 constructors are positional, so the props of a node are not its constructor's options object as on Pixi 8:
 *
 * - the constructor arguments of the built-in it is constructed as (`Pixi7ConstructorProps`, the table in
 *   `construct.ts`), named and as optional or required as the constructor declares them;
 * - every writable, non-function instance property of the class (`Pixi7InstanceProps`): `x`, `alpha`, `tint`, `name`,
 *   `eventMode`, `position` (any `IPointData`), and the class's own fields;
 * - the PascalCase event handlers, and `draw` on Graphics.
 *
 * A class that is not constructed positionally (`Container`, its custom subclasses, custom filters) receives one options
 * object, so its declared first constructor parameter contributes props, as on Pixi 8.
 */
import type {
    AlphaFilter,
    AnimatedSprite,
    Application,
    BitmapText,
    BlurFilter,
    ColorMatrixFilter,
    DisplacementFilter,
    ExtensionFormatLoose,
    FederatedEventHandler,
    FederatedPointerEvent,
    FederatedWheelEvent,
    Filter,
    FXAAFilter,
    Geometry,
    Graphics,
    GraphicsGeometry,
    HTMLText,
    IApplicationOptions,
    IDestroyOptions,
    IPointData,
    ITextStyle,
    Mesh,
    NineSlicePlane,
    NoiseFilter,
    ObservablePoint,
    ParticleContainer,
    SimpleMesh,
    SimplePlane,
    SimpleRope,
    Sprite,
    Text,
    TextStyle,
    Texture,
    TilingSprite,
} from 'pixi.js';
import type { Pixi7LeafNode } from './catalog.js';
import type { Constructor, PixiTypes, PropsFamily } from '@pixi-react-provisional/core';

/** Upstream `src/typedefs/UtilityTypes.ts`: drops the keys whose values are functions. */
export type ExcludeFunctionProps<T> = { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K] };
/** Upstream `src/typedefs/UtilityTypes.ts`: `T1` without the keys of `T2`. */
export type OmitKeys<T1, T2> = { [K in keyof T1 as K extends keyof T2 ? never : K]: T1[K] };

type IfEquals<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? A : B;

/** The keys of `T` that can be assigned: not `readonly`, which includes getter-only accessors. */
export type WritableKeys<T> = {
    [K in keyof T]-?: IfEquals<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>;
}[keyof T];

type Params<C> = C extends abstract new (...args: infer A) => unknown ? A : never;

/**
 * The positional constructor arguments of each built-in as named props (the rows of `construct.ts`), with each
 * argument's declared type and optionality. Exact in both directions, as on Pixi 8, so a structurally compatible
 * class never picks up another row.
 */
export type Pixi7ConstructorOverrides =
    | [typeof Sprite, { texture?: Params<typeof Sprite>[0] }]
    | [typeof AnimatedSprite, { textures: Params<typeof AnimatedSprite>[0]; autoUpdate?: Params<typeof AnimatedSprite>[1] }]
    | [typeof TilingSprite, { texture: Params<typeof TilingSprite>[0]; width?: number; height?: number }]
    | [typeof Text, { text?: Params<typeof Text>[0]; style?: Params<typeof Text>[1]; canvas?: Params<typeof Text>[2] }]
    | [typeof HTMLText, { text?: Params<typeof HTMLText>[0]; style?: Params<typeof HTMLText>[1] }]
    | [typeof BitmapText, { text: Params<typeof BitmapText>[0]; style?: Params<typeof BitmapText>[1] }]
    | [typeof Graphics, { geometry?: Params<typeof Graphics>[0] }]
    | [typeof Mesh, { geometry: Params<typeof Mesh>[0]; shader: Params<typeof Mesh>[1]; state?: Params<typeof Mesh>[2]; drawMode?: Params<typeof Mesh>[3] }]
    | [typeof SimpleMesh, {
        texture?: Params<typeof SimpleMesh>[0];
        vertices?: Params<typeof SimpleMesh>[1];
        uvs?: Params<typeof SimpleMesh>[2];
        indices?: Params<typeof SimpleMesh>[3];
        drawMode?: Params<typeof SimpleMesh>[4];
    }]
    | [typeof SimplePlane, { texture: Params<typeof SimplePlane>[0]; verticesX?: number; verticesY?: number }]
    | [typeof SimpleRope, { texture: Params<typeof SimpleRope>[0]; points: Params<typeof SimpleRope>[1]; textureScale?: number }]
    | [typeof NineSlicePlane, { texture: Params<typeof NineSlicePlane>[0]; leftWidth?: number; topHeight?: number; rightWidth?: number; bottomHeight?: number }]
    | [typeof ParticleContainer, {
        maxSize?: number;
        properties?: Params<typeof ParticleContainer>[1];
        batchSize?: number;
        autoResize?: boolean;
    }]
    | [typeof Filter, { vertexSrc?: string; fragmentSrc?: string; uniforms?: Params<typeof Filter>[2] }]
    | [typeof AlphaFilter, { alpha?: number }]
    | [typeof BlurFilter, { strength?: number; quality?: number; resolution?: number; kernelSize?: number }]
    | [typeof ColorMatrixFilter, {}]
    | [typeof DisplacementFilter, { sprite: Params<typeof DisplacementFilter>[0]; scale?: number }]
    | [typeof FXAAFilter, {}]
    | [typeof NoiseFilter, { noise?: number; seed?: number }];

type OverrideFor<C> = Pixi7ConstructorOverrides extends infer O
    ? O extends [infer K, infer R] ? ([K] extends [C] ? ([C] extends [K] ? R : never) : never) : never
    : never;

type RowOf<K> = Extract<Pixi7ConstructorOverrides, [K, unknown]>[1];

/**
 * The row a custom display-object subclass inherits at runtime: the nearest built-in it extends (most specific first).
 * Filter rows are not inherited (`construct.ts`).
 */
type InheritedRow<I> =
    I extends NineSlicePlane ? RowOf<typeof NineSlicePlane>
        : I extends SimplePlane ? RowOf<typeof SimplePlane>
            : I extends SimpleRope ? RowOf<typeof SimpleRope>
                : I extends SimpleMesh ? RowOf<typeof SimpleMesh>
                    : I extends Mesh ? RowOf<typeof Mesh>
                        : I extends AnimatedSprite ? RowOf<typeof AnimatedSprite>
                            : I extends TilingSprite ? RowOf<typeof TilingSprite>
                                : I extends Text ? RowOf<typeof Text>
                                    : I extends HTMLText ? RowOf<typeof HTMLText>
                                        : I extends Sprite ? RowOf<typeof Sprite>
                                            : I extends Graphics ? RowOf<typeof Graphics>
                                                : I extends BitmapText ? RowOf<typeof BitmapText>
                                                    : I extends ParticleContainer ? RowOf<typeof ParticleContainer>
                                                        : never;

/** Resources and positional values that are not an options object. */
type NotOptions = Texture | GraphicsGeometry | Geometry | TextStyle | readonly unknown[] | string | number | boolean;

type DeclaredOptions<C extends Constructor> = Exclude<NonNullable<Params<C>[0]>, NotOptions>;

/**
 * The props a constructor consumes: the built-in's positional arguments (its own row, else the row its nearest
 * built-in display ancestor passes on), else the declared options object of a class that receives one.
 */
export type Pixi7ConstructorProps<C extends Constructor> =
    [OverrideFor<C>] extends [never]
        ? [InheritedRow<InstanceType<C>>] extends [never]
            ? ([DeclaredOptions<C>] extends [never] ? {} : DeclaredOptions<C>)
            : InheritedRow<InstanceType<C>>
        : OverrideFor<C>;

/** The tree, not props, owns these keys. */
interface TreeOwnedKeys { children: unknown; parent: unknown; key: unknown; ref: unknown }

/** Upstream `PixiToReactEventPropNames`, as a type. The runtime table is `PIXI_TO_REACT_EVENT_PROP_NAMES`. */
export interface PixiToReactEventPropNames
{
    onclick: 'onClick'; onglobalmousemove: 'onGlobalMouseMove'; onglobalpointermove: 'onGlobalPointerMove';
    onglobaltouchmove: 'onGlobalTouchMove'; onmousedown: 'onMouseDown'; onmouseenter: 'onMouseEnter';
    onmouseleave: 'onMouseLeave'; onmousemove: 'onMouseMove'; onmouseout: 'onMouseOut'; onmouseover: 'onMouseOver';
    onmouseup: 'onMouseUp'; onmouseupoutside: 'onMouseUpOutside'; onpointercancel: 'onPointerCancel';
    onpointerdown: 'onPointerDown'; onpointerenter: 'onPointerEnter'; onpointerleave: 'onPointerLeave';
    onpointermove: 'onPointerMove'; onpointerout: 'onPointerOut'; onpointerover: 'onPointerOver';
    onpointertap: 'onPointerTap'; onpointerup: 'onPointerUp'; onpointerupoutside: 'onPointerUpOutside';
    onrightclick: 'onRightClick'; onrightdown: 'onRightDown'; onrightup: 'onRightUp';
    onrightupoutside: 'onRightUpOutside'; ontap: 'onTap'; ontouchcancel: 'onTouchCancel'; ontouchend: 'onTouchEnd';
    ontouchendoutside: 'onTouchEndOutside'; ontouchmove: 'onTouchMove'; ontouchstart: 'onTouchStart'; onwheel: 'onWheel';
}

/** PascalCase event handler props; each handler keeps its own Pixi 7 federated payload. */
export type Pixi7EventHandlers = {
    [K in keyof PixiToReactEventPropNames as PixiToReactEventPropNames[K]]?:
        FederatedEventHandler<K extends 'onwheel' ? FederatedWheelEvent : FederatedPointerEvent> | null;
};

/**
 * What an instance property accepts when it is assigned. Pixi 7's point setters take any `IPointData`
 * (`set position(value: IPointData)`), while the getter returns an `ObservablePoint`; a mapped type sees only the
 * getter, so point properties are widened to what the setter takes.
 */
type Assignable<T> = T extends ObservablePoint ? IPointData : T;

/**
 * Writable, non-function instance properties of `I`, minus the keys the constructor props own, the tree, Pixi-cased
 * event properties and internal `_`-prefixed fields.
 */
export type Pixi7InstanceProps<I, Owned> = {
    [K in WritableKeys<I> as K extends `_${string}` | keyof Owned | keyof TreeOwnedKeys | keyof PixiToReactEventPropNames
        ? never
        : I[K] extends (...args: any[]) => any ? never : K]?: Assignable<I[K]>;
};

/** Called on mount and whenever the callback identity changes; only on Graphics, with Pixi 7's imperative API. */
export type DrawCallback<I> = (graphics: I) => void;

type GraphicsProps<I> = I extends Graphics ? { draw?: DrawCallback<I> } : unknown;

/** Leaves take no JSX children: filters attach to their parent's `filters`, and BitmapText manages its own. */
type ChildrenProps<I> = I extends Pixi7LeafNode ? { children?: never } : unknown;

/**
 * Element props of a constructor, minus the React-owned `ref`/`key` (and `children` for nodes that take them). This
 * is the Pixi half of an element's props; each React adapter adds its own half (`ElementProps` in the React 19
 * adapters, `PixiElementProps` in `./jsx`).
 */
export type Pixi7Props<C extends Constructor> =
    & GraphicsProps<InstanceType<C>>
    & ChildrenProps<InstanceType<C>>
    & OmitKeys<Pixi7ConstructorProps<C>, TreeOwnedKeys & PixiToReactEventPropNames>
    & Pixi7InstanceProps<InstanceType<C>, Pixi7ConstructorProps<C>>
    & Pixi7EventHandlers;

export interface Pixi7PropsFamily extends PropsFamily
{
    readonly type: Pixi7Props<Extract<this['constructorType'], Constructor>>;
}

/** Global, process-wide application settings. The adapter leases them per application (see the README). */
export interface Pixi7GlobalAppProps
{
    /** Extensions acquired before construction and reference-counted across applications. */
    extensions?: readonly ExtensionFormatLoose[];
    /**
     * Default style for text created later, in any application of this Pixi module (Pixi 7's
     * `TextStyle.defaultStyle`). Last explicit writer wins.
     */
    defaultTextStyle?: TextStyle | Partial<ITextStyle>;
}

/** What `resizeTo` accepts once React has unwrapped its refs. `null` clears it. */
export type Pixi7ResizeTarget = HTMLElement | Window | null;

/**
 * Initialization options: Pixi 7's `IApplicationOptions` (renderer options plus the ticker and resize plugins') and
 * the global settings. `view` is the canvas core created for the root, so it is not an option; Pixi 8's `canvas`,
 * `preference` and other v8-only options are not part of the type.
 */
export type Pixi7InitOptions = Partial<Omit<IApplicationOptions, 'view' | 'resizeTo'>> & Pixi7GlobalAppProps & {
    resizeTo?: Pixi7ResizeTarget;
};

/**
 * The complete set of mutable application props, passed on every update. Absent keys are cleared. Construction-only
 * renderer options are ignored here: they are never copied onto the application after initialization.
 */
export type Pixi7AppProps = Pixi7GlobalAppProps & { resizeTo?: Pixi7ResizeTarget };

/** Both destroy channels of an application, forwarded to Pixi 7's `Application.destroy(removeView, stageOptions)`. */
export interface Pixi7DestroyOptions
{
    /** Forwarded as `stageOptions`, and to every renderer-owned node: Pixi 7's `children`, `texture`, `baseTexture`. */
    destroyOptions?: IDestroyOptions | boolean;
    /**
     * Pixi 7's `removeView`. Pixi 8's object form `{ removeView }` is accepted and converted; its other keys are Pixi 8
     * options and are ignored with a warning.
     */
    rendererDestroyOptions?: boolean | { removeView?: boolean };
}

export interface Pixi7Types extends PixiTypes
{
    readonly node: object;
    readonly app: Application;
    readonly options: Pixi7InitOptions;
    readonly appProps: Pixi7AppProps;
    readonly destroy: Pixi7DestroyOptions;
    readonly nodeDestroy: IDestroyOptions | boolean;
    /** Pixi 7's ticker passes the frame delta, a number. */
    readonly tick: number;
    readonly props: Pixi7PropsFamily;
}

/** The ticker callback type of this scene: Pixi 7 passes `deltaTime`. */
export type Pixi7TickCallback<Context = unknown> = (this: Context, delta: number) => void;
