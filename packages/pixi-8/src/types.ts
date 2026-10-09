/**
 * Pixi 8 `PixiTypes` and the public constructor-to-props mapping. Every type is derived from the consumer's installed
 * `pixi.js` declarations; nothing here names a type that the 8.2.6 floor does not declare (exports added later in the
 * peer range are reached through `InstalledPixiExport`, see `catalog.ts`). The mapping starts from upstream's
 * `ConstructorOverrides`, `ConstructorOptions`, `OmitKeys` and `PixiReactElementProps` (30cf1f8) and the corrected
 * contract mapping in `design/contract/pixi-8.d.ts`.
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
import type { Pixi8LeafNode } from './catalog.js';
import type { Constructor, PixiTypes, PropsFamily } from '@pixi-react-provisional/core';

/**
 * The first parameter of each construct signature of `C`, up to four overloads. `ConstructorParameters` sees only the
 * last overload, which in Pixi 8 is usually the deprecated positional form.
 */
export type OverloadedOptions<C> =
    C extends {
        new (...args: infer A1): unknown;
        new (...args: infer A2): unknown;
        new (...args: infer A3): unknown;
        new (...args: infer A4): unknown;
    }
        ? A1[0] | A2[0] | A3[0] | A4[0]
        : never;

/**
 * The installed options overload of `C` that matches `Selector`, else `Fallback`. A row of the override table names
 * a selector that the 8.2.6 floor declares; the installed version's own options type is what the row resolves to
 * (for example `CanvasTextOptions` for `Text` on 8.22, `AnimatedSpriteOptions` once `AnimatedSprite` has one).
 */
export type InstalledOptions<C, Selector, Fallback = Selector> =
    [Extract<OverloadedOptions<C>, Selector>] extends [never] ? Fallback : Extract<OverloadedOptions<C>, Selector>;

/** `AnimatedSprite`'s 8.2.6 positional constructor, as options (`textures` stays required). */
type AnimatedSpriteFloorOptions = Omit<SpriteOptions, 'texture'> & { textures: Texture[] | FrameObject[]; autoUpdate?: boolean };

/**
 * Version-owned constructor override table, from upstream `src/typedefs/ConstructorOverrides.ts` (30cf1f8), plus the
 * contract's `AnimatedSprite` row. Each row resolves to the installed declaration's options overload: deprecated
 * positional overloads otherwise win `ConstructorParameters`.
 */
export type ConstructorOverrides =
    | [typeof AnimatedSprite, InstalledOptions<typeof AnimatedSprite, { textures: unknown }, AnimatedSpriteFloorOptions>]
    | [typeof BitmapText, InstalledOptions<typeof BitmapText, TextOptions>]
    | [typeof BlurFilter, InstalledOptions<typeof BlurFilter, BlurFilterOptions>]
    | [typeof DisplacementFilter, InstalledOptions<typeof DisplacementFilter, DisplacementFilterOptions>]
    | [typeof HTMLText, InstalledOptions<typeof HTMLText, HTMLTextOptions>]
    | [typeof Mesh, InstalledOptions<typeof Mesh, MeshOptions>]
    | [typeof MeshGeometry, InstalledOptions<typeof MeshGeometry, MeshGeometryOptions>]
    | [typeof NineSliceSprite, InstalledOptions<typeof NineSliceSprite, NineSliceSpriteOptions>]
    | [typeof PlaneGeometry, InstalledOptions<typeof PlaneGeometry, PlaneGeometryOptions>]
    | [typeof TilingSprite, InstalledOptions<typeof TilingSprite, TilingSpriteOptions>]
    | [typeof Text, InstalledOptions<typeof Text, TextOptions>];

type ConstructorOptionExcludes = GraphicsContext | Texture;

/** Exact in both directions, so a structurally compatible custom class does not pick up another row. */
type OverrideFor<C extends Constructor> = ConstructorOverrides extends infer O
    ? O extends [infer K, infer R] ? ([K] extends [C] ? ([C] extends [K] ? R : never) : never) : never
    : never;

type DeclaredOptions<C extends Constructor> = NonNullable<Exclude<ConstructorParameters<C>[0], ConstructorOptionExcludes>>;

/**
 * Upstream `ConstructorOptions`: the override row of `C`, else its declared first constructor parameter without the
 * `Texture`/`GraphicsContext` shorthand. A constructor declaring no options parameter contributes no option props;
 * a custom constructor's required options stay required.
 */
export type ConstructorOptions<C extends Constructor> =
    [OverrideFor<C>] extends [never]
        ? [DeclaredOptions<C>] extends [never] ? {} : DeclaredOptions<C>
        : OverrideFor<C>;

/** Upstream `src/typedefs/UtilityTypes.ts`: drops the keys whose values are functions. */
export type ExcludeFunctionProps<T> = { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K] };
/** Upstream `src/typedefs/UtilityTypes.ts`: `T1` without the keys of `T2`. */
export type OmitKeys<T1, T2> = { [K in keyof T1 as K extends keyof T2 ? never : K]: T1[K] };

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

/**
 * Leaves take no JSX children: the adapter attaches filters to their parent's `filters`, particles through their
 * ParticleContainer, and rejects children of a RenderLayer or DOMContainer (see the README). Every other node keeps
 * the React adapter's `children`.
 */
type ChildrenProps<I> = I extends Pixi8LeafNode ? { children?: never } : unknown;

/**
 * Element props of a constructor, minus the React-owned `ref`/`key` (and `children` for nodes that take them):
 * Graphics `draw`, the constructor's options without function-valued, tree-owned and Pixi-cased event keys, and the
 * PascalCase event handlers. This is upstream's `PixiReactElementProps` mapping without its React half, which each
 * React adapter adds (`ElementProps` in `react-19`, `PixiElementProps` in `./jsx`).
 */
export type Pixi8Props<C extends Constructor> =
    & GraphicsProps<InstanceType<C>>
    & ChildrenProps<InstanceType<C>>
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
 * onto the application after initialization. A React adapter may pass its whole option object; keys other than these
 * are ignored. The type has no index signature, so the public `Application` props that a React adapter derives from it
 * keep every named Pixi option (an index signature would collapse `Omit<...>` of them to `Record<string, unknown>`).
 */
export type Pixi8AppProps = Pixi8GlobalAppProps & { resizeTo?: Pixi8ResizeTarget };

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
