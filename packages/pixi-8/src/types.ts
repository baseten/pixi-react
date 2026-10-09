/**
 * Pixi 8 `PixiTypes`. Every type is derived from the consumer's installed `pixi.js` declarations; nothing here
 * names a type that the 8.2.6 floor does not declare (particles, RenderLayer and DOMContainer are typed by the
 * installed Pixi when a consumer passes their constructors). The complete public constructor/event/children
 * mapping is issue 11's work; these are ported from the contract sketch (`design/contract/pixi-8.d.ts`), which in
 * turn ports upstream's `ConstructorOverrides`, `ConstructorOptions`, `OmitKeys` and `PixiReactElementProps`.
 */
import type {
    AnimatedSprite,
    Application,
    ApplicationOptions,
    BitmapText,
    BlurFilter,
    BlurFilterOptions,
    DestroyOptions,
    DisplacementFilter,
    DisplacementFilterOptions,
    ExtensionFormatLoose,
    FederatedEventHandler,
    FederatedPointerEvent,
    FederatedWheelEvent,
    FrameObject,
    Graphics,
    GraphicsContext,
    HTMLText,
    HTMLTextOptions,
    Mesh,
    MeshGeometry,
    MeshGeometryOptions,
    MeshOptions,
    NineSliceSprite,
    NineSliceSpriteOptions,
    PlaneGeometry,
    PlaneGeometryOptions,
    RendererDestroyOptions,
    SpriteOptions,
    Text,
    TextOptions,
    TextStyle,
    TextStyleOptions,
    Texture,
    Ticker,
    TilingSprite,
    TilingSpriteOptions,
} from 'pixi.js';
import type { Constructor, PixiTypes, PropsFamily } from '@pixi-react-provisional/core';

/**
 * Version-owned constructor override table, from upstream `src/typedefs/ConstructorOverrides.ts` (30cf1f8).
 * Deprecated positional overloads otherwise win `ConstructorParameters`.
 */
export type ConstructorOverrides =
    | [typeof AnimatedSprite, Omit<SpriteOptions, 'texture'> & { textures: Texture[] | FrameObject[]; autoUpdate?: boolean }]
    | [typeof BitmapText, TextOptions]
    | [typeof BlurFilter, BlurFilterOptions]
    | [typeof DisplacementFilter, DisplacementFilterOptions]
    | [typeof HTMLText, HTMLTextOptions]
    | [typeof Mesh, MeshOptions]
    | [typeof MeshGeometry, MeshGeometryOptions]
    | [typeof NineSliceSprite, NineSliceSpriteOptions]
    | [typeof PlaneGeometry, PlaneGeometryOptions]
    | [typeof TilingSprite, TilingSpriteOptions]
    | [typeof Text, TextOptions];

type ConstructorOptionExcludes = GraphicsContext | Texture;

/** Exact in both directions, so a structurally compatible custom class does not pick up another row. */
type OverrideFor<C extends Constructor> = ConstructorOverrides extends infer O
    ? O extends [infer K, infer R] ? ([K] extends [C] ? ([C] extends [K] ? R : never) : never) : never
    : never;

type DeclaredOptions<C extends Constructor> = NonNullable<Exclude<ConstructorParameters<C>[0], ConstructorOptionExcludes>>;

/** Upstream `ConstructorOptions`; a constructor declaring no options parameter contributes no option props. */
export type ConstructorOptions<C extends Constructor> =
    [OverrideFor<C>] extends [never]
        ? [DeclaredOptions<C>] extends [never] ? {} : DeclaredOptions<C>
        : OverrideFor<C>;

type ExcludeFunctionProps<T> = { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K] };
type OmitKeys<T1, T2> = { [K in keyof T1 as K extends keyof T2 ? never : K]: T1[K] };

/** The tree, not constructor options, owns these keys. */
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

/** PascalCase event handler props; each handler keeps its own Pixi 8 payload. */
export type Pixi8EventHandlers = {
    [K in keyof PixiToReactEventPropNames as PixiToReactEventPropNames[K]]?:
        FederatedEventHandler<K extends 'onwheel' ? FederatedWheelEvent : FederatedPointerEvent> | null;
};

/** Called on mount and whenever the callback identity changes; only on Graphics. */
export type DrawCallback<I> = (graphics: I) => void;

type GraphicsProps<I> = I extends Graphics ? { draw?: DrawCallback<I> } : unknown;

/** Element props of a constructor, minus the React-owned ref/key/children. */
export type Pixi8Props<C extends Constructor> =
    & GraphicsProps<InstanceType<C>>
    & OmitKeys<ExcludeFunctionProps<ConstructorOptions<C>>, TreeOwnedKeys & PixiToReactEventPropNames>
    & Pixi8EventHandlers;

export interface Pixi8PropsFamily extends PropsFamily
{
    readonly type: Pixi8Props<Extract<this['constructorType'], Constructor>>;
}

/** Global, process-wide application settings. The adapter leases them per application (see the README). */
export interface Pixi8GlobalAppProps
{
    /** Extensions acquired before init and reference-counted across applications. */
    extensions?: readonly ExtensionFormatLoose[];
    /** Default style for text created later, in any application of this Pixi module. Last explicit writer wins. */
    defaultTextStyle?: TextStyle | TextStyleOptions;
}

/** What `resizeTo` accepts once React has unwrapped its refs. `null` clears it. */
export type Pixi8ResizeTarget = HTMLElement | Window | null;

/** Initialization options: Pixi's own options plus the global settings, applied before `Application.init`. */
export type Pixi8InitOptions = Partial<Omit<ApplicationOptions, 'resizeTo'>> & Pixi8GlobalAppProps & {
    resizeTo?: Pixi8ResizeTarget;
};

/**
 * The complete set of mutable application props, passed on every update. Absent keys are cleared (no extensions,
 * no default style writer, no resize target). Init-only renderer options are ignored here: they are never copied
 * onto the application after initialization.
 */
export type Pixi8AppProps = Pixi8GlobalAppProps & { resizeTo?: Pixi8ResizeTarget } & Record<string, unknown>;

/** Both destroy channels of an application, forwarded unchanged to `Application.destroy`. */
export interface Pixi8DestroyOptions
{
    /** Forwarded as the second argument of `Application.destroy`, and to every renderer-owned node it destroys. */
    destroyOptions?: DestroyOptions | boolean;
    /** Forwarded as the first argument of `Application.destroy`. */
    rendererDestroyOptions?: RendererDestroyOptions | boolean;
}

export interface Pixi8Types extends PixiTypes
{
    readonly node: object;
    readonly app: Application;
    readonly options: Pixi8InitOptions;
    readonly appProps: Pixi8AppProps;
    readonly destroy: Pixi8DestroyOptions;
    readonly nodeDestroy: DestroyOptions | boolean;
    readonly tick: Ticker;
    readonly props: Pixi8PropsFamily;
}

/** The ticker callback type of this scene: Pixi 8 passes the `Ticker`. */
export type Pixi8TickCallback<Context = unknown> = (this: Context, ticker: Ticker) => void;
