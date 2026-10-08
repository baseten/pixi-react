import type {
    AnimatedSprite, Application, ApplicationOptions, BitmapText, BlurFilter, BlurFilterOptions, Container, DestroyOptions,
    DisplacementFilter, DisplacementFilterOptions, ExtensionFormatLoose, FederatedEventHandler, FederatedPointerEvent,
    FederatedWheelEvent, FrameObject, Graphics, GraphicsContext, HTMLText, HTMLTextOptions, Mesh, MeshGeometry,
    MeshGeometryOptions, MeshOptions, NineSliceSprite, NineSliceSpriteOptions, PlaneGeometry, PlaneGeometryOptions,
    RendererDestroyOptions, SpriteOptions, Text, TextOptions, TextStyleOptions, Texture, Ticker, TilingSprite,
    TilingSpriteOptions,
} from 'pixi.js';
import type { Constructor, NodeDefinition, PropsFamily, Runtime, SceneSession, SceneTypes } from './core.js';
import { SceneAdapter } from './core.js';
/**
 * Version-owned override table, ported from upstream src/typedefs/ConstructorOverrides.ts (30cf1f8).
 * Deprecated positional overloads otherwise win ConstructorParameters. The AnimatedSprite row is the
 * Pixi 8.2.6 positional constructor (options form arrives in 8.3); its descriptor translates it.
 * The complete per-minor table is owned by issue 8/11.
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
/**
 * Upstream's Extract<ConstructorOverrides, { 0: C }> lookup, made exact in both directions: one-way
 * assignability lets a structurally compatible custom class (e.g. Container subclass with required
 * options) pick up another row's options.
 */
type OverrideFor<C extends Constructor> = ConstructorOverrides extends infer O
    ? O extends [infer K, infer R] ? ([K] extends [C] ? ([C] extends [K] ? R : never) : never) : never
    : never;
type DeclaredOptions<C extends Constructor> = NonNullable<Exclude<ConstructorParameters<C>[0], ConstructorOptionExcludes>>;
/** Upstream ConstructorOptions; a constructor declaring no options parameter contributes no option props. */
export type ConstructorOptions<C extends Constructor> =
    [OverrideFor<C>] extends [never]
        ? [DeclaredOptions<C>] extends [never] ? {} : DeclaredOptions<C>
        : OverrideFor<C>;
/** Upstream src/typedefs/UtilityTypes.ts. */
type ExcludeFunctionProps<T> = { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K] };
type OmitKeys<T1, T2> = { [K in keyof T1 as K extends keyof T2 ? never : K]: T1[K] };
/** Upstream NodeProps keys: the tree, not constructor options, owns children/parent/key/ref. */
interface TreeOwnedKeys { children: unknown; parent: unknown; key: unknown; ref: unknown; __pixireact: unknown }
/** Upstream src/constants/EventPropNames.ts (PixiToReactEventPropNames). */
interface PixiToReactEventPropNames {
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
/** Upstream EventHandlers, with each handler keeping its own Pixi 8 payload instead of a union. */
export type Pixi8EventHandlers = {
    [K in keyof PixiToReactEventPropNames as PixiToReactEventPropNames[K]]?:
        FederatedEventHandler<K extends 'onwheel' ? FederatedWheelEvent : FederatedPointerEvent> | null;
};
/** Upstream GraphicsProps. */
type GraphicsProps<I> = I extends Graphics ? { draw: (graphics: I) => void } : unknown;
/** Upstream PixiReactElementProps minus the framework-owned ref/key/children (added by the framework binding). */
export type Pixi8Props<C extends Constructor> =
    & GraphicsProps<InstanceType<C>>
    & OmitKeys<ExcludeFunctionProps<ConstructorOptions<C>>, TreeOwnedKeys & PixiToReactEventPropNames>
    & Pixi8EventHandlers;
export interface Pixi8PropsFamily extends PropsFamily { readonly type: Pixi8Props<Extract<this['constructorType'], Constructor>> }
export interface Pixi8Types extends SceneTypes {
    readonly node: object;
    readonly app: Application;
    readonly options: Partial<ApplicationOptions>;
    readonly appProps: Partial<ApplicationOptions> & {
        extensions?: ExtensionFormatLoose[];
        defaultTextStyle?: TextStyleOptions;
        resizeTo?: HTMLElement | Window;
    };
    readonly destroy: { destroyOptions?: DestroyOptions; rendererDestroyOptions?: RendererDestroyOptions };
    readonly nodeDestroy: DestroyOptions;
    readonly tick: Ticker;
    readonly props: Pixi8PropsFamily;
}
export declare class Pixi8Adapter extends SceneAdapter<Pixi8Types> {
    readonly manifest: import('./core.js').AdapterManifest;
    createSession(runtime: Runtime<Pixi8Types>, target: HTMLElement | HTMLCanvasElement): SceneSession<Pixi8Types>;
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}
/** Child support is selected by the Pixi catalog, never assumed by core. */
export type ContainerInstance = Container;
