/**
 * Catalogs and element names, as types. A catalog is what `extend` registers: an object of constructors keyed by
 * name. These types turn one into element names and props without naming React, so a React adapter's JSX entry
 * (`./jsx`) can map the same catalog. pixi.js 7.2.0 to 7.4.3 export the same classes, so there are no version-dependent
 * entries.
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
    FXAAFilter,
    Graphics,
    HTMLText,
    Mesh,
    NineSlicePlane,
    NoiseFilter,
    ParticleContainer,
    SimpleMesh,
    SimplePlane,
    SimpleRope,
    Sprite,
    Text,
    TilingSprite,
} from 'pixi.js';

/** What the adapter can attach: display objects (Containers) and Filters. Anything else is a resource, passed as a prop. */
export type Pixi7Node = Container | Filter;

/** A concrete constructor of a node. Abstract classes (`DisplayObject`) do not match. */
export type Pixi7NodeConstructor = new (...args: never[]) => Pixi7Node;

/**
 * Nodes that take no JSX children: filters attach to their parent, and BitmapText adds and removes its own glyph
 * children. Their element props declare `children?: never`.
 */
export type Pixi7LeafNode = Filter | BitmapText;

/**
 * Every public, concrete built-in node of pixi.js 7. It excludes `DisplayObject` (abstract), internal classes
 * (`TemporaryDisplayObject`, `BlurFilterPass`, `SpriteMaskFilter`) and resources (`Texture`, `GraphicsGeometry`,
 * geometries). An object type alias, not an interface: only aliases get the implicit string index signature that core's
 * `Catalog` requires, so it can be passed to `extend`. Pixi 8-only classes (`Particle`, `RenderLayer`, `DOMContainer`,
 * `SplitText`, `NineSliceSprite`, `MeshPlane`, ...) are absent: Pixi 7 does not declare them.
 */
export type Pixi7StandardCatalog = {
    Container: typeof Container;
    Sprite: typeof Sprite;
    AnimatedSprite: typeof AnimatedSprite;
    TilingSprite: typeof TilingSprite;
    Graphics: typeof Graphics;
    Text: typeof Text;
    BitmapText: typeof BitmapText;
    HTMLText: typeof HTMLText;
    Mesh: typeof Mesh;
    SimpleMesh: typeof SimpleMesh;
    SimplePlane: typeof SimplePlane;
    SimpleRope: typeof SimpleRope;
    NineSlicePlane: typeof NineSlicePlane;
    ParticleContainer: typeof ParticleContainer;
    Filter: typeof Filter;
    AlphaFilter: typeof AlphaFilter;
    BlurFilter: typeof BlurFilter;
    ColorMatrixFilter: typeof ColorMatrixFilter;
    DisplacementFilter: typeof DisplacementFilter;
    FXAAFilter: typeof FXAAFilter;
    NoiseFilter: typeof NoiseFilter;
};

/** Unprefixed element names that are not `lowerFirst(name)`: upstream's `NameOverrides`, canonical name to element name. */
export interface Pixi7NameOverrides
{
    HTMLText: 'htmlText';
    FXAAFilter: 'fxaaFilter';
}

type CanonicalOfUnprefixed<U extends string> = {
    [K in keyof Pixi7NameOverrides as Pixi7NameOverrides[K]]: K;
} extends infer Inverse
    ? U extends keyof Inverse ? Inverse[U] & string : Capitalize<U>
    : never;

type IdentifierStart =
    | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
    | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
    | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
    | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
    | '_' | '$';
type IdentifierPart = IdentifierStart | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type IsIdentifierTail<S extends string> =
    S extends `${infer C}${infer Rest}` ? (C extends IdentifierPart ? IsIdentifierTail<Rest> : false) : true;

/** Whether `normalizePixiName` treats a key as an identifier (`/^[A-Za-z_$][\w$]*$/`). Other keys are used unchanged. */
export type IsPixi7Identifier<S extends string> =
    S extends `${infer C}${infer Rest}` ? (C extends IdentifierStart ? IsIdentifierTail<Rest> : false) : false;

/** The catalog name `normalizePixiName` gives a key: `pixiSprite`, `sprite` and `Sprite` are `Sprite`. */
export type Pixi7CanonicalName<K extends string> = IsPixi7Identifier<K> extends false ? K :
    K extends `pixi${infer First}${infer Rest}`
        ? First extends Uppercase<First>
            ? First extends Lowercase<First> ? CanonicalOfUnprefixed<K> : CanonicalOfUnprefixed<`${Lowercase<First>}${Rest}`>
            : CanonicalOfUnprefixed<K>
        : CanonicalOfUnprefixed<K>;

/** The unprefixed element name of a catalog key: `sprite`, `htmlText`, `fxaaFilter`. */
export type Pixi7UnprefixedName<K extends string> = IsPixi7Identifier<K> extends false ? K :
    Pixi7CanonicalName<K> extends keyof Pixi7NameOverrides
        ? Pixi7NameOverrides[Pixi7CanonicalName<K>]
        : Uncapitalize<Pixi7CanonicalName<K>>;

/** The prefixed element name of a catalog key: `pixiSprite`, `pixiHtmlText`, `pixiFxaaFilter`. */
export type Pixi7PrefixedName<K extends string> =
    IsPixi7Identifier<K> extends false ? K : `pixi${Capitalize<Pixi7UnprefixedName<K>>}`;

/** The string keys of a catalog whose values are concrete node constructors. Resources and abstract classes drop out. */
export type Pixi7NodeKeys<Cat> = {
    [K in keyof Cat]: K extends string ? (Cat[K] extends Pixi7NodeConstructor ? K : never) : never;
}[keyof Cat];
