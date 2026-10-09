/**
 * Catalogs and element names, as types. A catalog is what `extend` registers: an object of constructors keyed by
 * name. These types turn one into element names and props without naming React, so a React adapter's JSX entry
 * (`./jsx`) or a future catalog-wide component factory can map the same catalog.
 *
 * Exports added within the peer range (Particle 8.5, RenderLayer 8.7, DOMContainer 8.9, SplitText 8.11, ...) are
 * reached through `InstalledPixiExport`, never imported by name, so the declarations compile against 8.2.6, where
 * those entries are simply absent.
 */
import type {
    AlphaFilter,
    AnimatedSprite,
    BitmapText,
    BlurFilter,
    ColorMatrixFilter,
    Container,
    DisplacementFilter,
    Filter,
    Graphics,
    HTMLText,
    Mesh,
    MeshPlane,
    MeshRope,
    MeshSimple,
    NineSliceSprite,
    NoiseFilter,
    RenderContainer,
    Sprite,
    Text,
    TilingSprite,
} from 'pixi.js';

type PixiNamespace = typeof import('pixi.js');

/** The installed `pixi.js` value export `K`, or `never` when the installed version does not declare it. */
export type InstalledPixiExport<K extends string> = K extends keyof PixiNamespace ? PixiNamespace[K] : never;

/** The installed instance type of export `K`, or `never` when it is absent (checked first: `never` matches any pattern). */
type InstalledInstance<K extends string> =
    [InstalledPixiExport<K>] extends [never]
        ? never
        : InstalledPixiExport<K> extends abstract new (...args: any[]) => infer I ? I : never;

/** Catalog entries for the exports among `K` that the installed `pixi.js` declares. */
export type InstalledPixiEntries<K extends string> = {
    [P in K as P extends keyof PixiNamespace ? P : never]: InstalledPixiExport<P>;
};

/** A Pixi 8.5+ `Particle` instance; `never` before 8.5. */
export type Pixi8ParticleInstance = InstalledInstance<'Particle'>;

/** What the adapter can attach: Containers, Filters and (8.5+) Particles. Anything else is a resource, passed as a prop. */
export type Pixi8Node = Container | Filter | Pixi8ParticleInstance;

/** A concrete constructor of a node. Abstract classes (`AbstractText`, `ViewContainer`, ...) do not match. */
export type Pixi8NodeConstructor = new (...args: never[]) => Pixi8Node;

/**
 * Nodes that take no JSX children: filters and particles attach to their parent, and RenderLayer (8.7+) and
 * DOMContainer (8.9+) reject children. Their element props declare `children?: never`.
 */
export type Pixi8LeafNode = Filter | Pixi8ParticleInstance | InstalledInstance<'RenderLayer'> | InstalledInstance<'DOMContainer'>;

/** The built-in nodes the 8.2.6 floor declares. */
export interface Pixi8FloorCatalog
{
    Container: typeof Container;
    Sprite: typeof Sprite;
    AnimatedSprite: typeof AnimatedSprite;
    Graphics: typeof Graphics;
    Text: typeof Text;
    BitmapText: typeof BitmapText;
    HTMLText: typeof HTMLText;
    TilingSprite: typeof TilingSprite;
    NineSliceSprite: typeof NineSliceSprite;
    Mesh: typeof Mesh;
    MeshPlane: typeof MeshPlane;
    MeshRope: typeof MeshRope;
    MeshSimple: typeof MeshSimple;
    RenderContainer: typeof RenderContainer;
    Filter: typeof Filter;
    AlphaFilter: typeof AlphaFilter;
    BlurFilter: typeof BlurFilter;
    ColorMatrixFilter: typeof ColorMatrixFilter;
    DisplacementFilter: typeof DisplacementFilter;
    NoiseFilter: typeof NoiseFilter;
}

/** Built-in nodes exported later in the peer range; present in `Pixi8StandardCatalog` only when installed. */
export type Pixi8LaterExport =
    | 'ParticleContainer'
    | 'Particle'
    | 'PerspectiveMesh'
    | 'RenderLayer'
    | 'DOMContainer'
    | 'SplitText'
    | 'SplitBitmapText';

/**
 * Every public, concrete built-in node the adapter supports, as typed by the installed `pixi.js`. It excludes abstract
 * bases (`AbstractText`, `AbstractSplitText`, `ViewContainer`), internal classes (`BitmapTextGraphics`,
 * `BlurFilterPass`, `MaskFilter`, `PassthroughFilter`, `BlendModeFilter` and the blend-mode extensions), deprecated
 * aliases (`NineSlicePlane`) and resources (`Texture`, `GraphicsContext`, geometries). A catalog type: pick from it
 * to declare what you `extend`.
 */
export type Pixi8StandardCatalog = Pixi8FloorCatalog & InstalledPixiEntries<Pixi8LaterExport>;

/** Unprefixed element names that are not `lowerFirst(name)`: upstream's `NameOverrides`, canonical name to element name. */
export interface Pixi8NameOverrides
{
    HTMLText: 'htmlText';
    HTMLTextPipe: 'htmlTextPipe';
    HTMLTextRenderData: 'htmlTextRenderData';
    HTMLTextStyle: 'htmlTextStyle';
    HTMLTextSystem: 'htmlTextSystem';
    IGLUniformData: 'iglUniformData';
}

type CanonicalOfUnprefixed<U extends string> = {
    [K in keyof Pixi8NameOverrides as Pixi8NameOverrides[K]]: K;
} extends infer Inverse
    ? U extends keyof Inverse ? Inverse[U] & string : Capitalize<U>
    : never;

/**
 * The catalog name `normalizePixiName` gives a key: `pixiSprite`, `sprite` and `Sprite` are `Sprite`; `pixiHtmlText`,
 * `htmlText` and `HTMLText` are `HTMLText`.
 */
export type Pixi8CanonicalName<K extends string> =
    K extends `pixi${infer First}${infer Rest}`
        ? First extends Uppercase<First>
            ? First extends Lowercase<First> ? CanonicalOfUnprefixed<K> : CanonicalOfUnprefixed<`${Lowercase<First>}${Rest}`>
            : CanonicalOfUnprefixed<K>
        : CanonicalOfUnprefixed<K>;

/** The unprefixed element name of a catalog key: `sprite`, `htmlText`. */
export type Pixi8UnprefixedName<K extends string> =
    Pixi8CanonicalName<K> extends keyof Pixi8NameOverrides
        ? Pixi8NameOverrides[Pixi8CanonicalName<K>]
        : Uncapitalize<Pixi8CanonicalName<K>>;

/** The prefixed element name of a catalog key: `pixiSprite`, `pixiHtmlText`. */
export type Pixi8PrefixedName<K extends string> = `pixi${Capitalize<Pixi8UnprefixedName<K>>}`;

/** The string keys of a catalog whose values are concrete node constructors. Resources and abstract classes drop out. */
export type Pixi8NodeKeys<Cat> = {
    [K in keyof Cat]: K extends string ? (Cat[K] extends Pixi8NodeConstructor ? K : never) : never;
}[keyof Cat];
