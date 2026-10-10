/**
 * The CJS entry: binds the implementation to the pixi.js 7 module `require` loads. The generated ESM wrapper
 * (`dist/esm/index.mjs`) binds the module `import` loads instead; see `bind.ts`. Both pass only the exports in
 * `PIXI7_BINDING_EXPORTS`, imported by name, never the module namespace.
 */
import {
    AlphaFilter,
    AnimatedSprite,
    Application,
    autoDetectRenderer,
    BitmapText,
    BlurFilter,
    ColorMatrixFilter,
    Container,
    DisplacementFilter,
    extensions,
    Filter,
    FXAAFilter,
    Graphics,
    HTMLText,
    Mesh,
    NineSlicePlane,
    NoiseFilter,
    ObservablePoint,
    ParticleContainer,
    Point,
    SimpleMesh,
    SimplePlane,
    SimpleRope,
    Sprite,
    Text,
    TextStyle,
    TilingSprite,
    VERSION,
} from 'pixi.js';
import { bindPixi } from './bind.js';

import type { Pixi7AdapterBase } from './adapter.js';

const bound = bindPixi({
    AlphaFilter,
    AnimatedSprite,
    Application,
    autoDetectRenderer,
    BitmapText,
    BlurFilter,
    ColorMatrixFilter,
    Container,
    DisplacementFilter,
    extensions,
    Filter,
    FXAAFilter,
    Graphics,
    HTMLText,
    Mesh,
    NineSlicePlane,
    NoiseFilter,
    ObservablePoint,
    ParticleContainer,
    Point,
    SimpleMesh,
    SimplePlane,
    SimpleRope,
    Sprite,
    Text,
    TextStyle,
    TilingSprite,
    VERSION,
});

/** The Pixi 7 adapter, bound to the loaded pixi.js module. */
export const Pixi7Adapter = bound.Pixi7Adapter;
/** An instance of `Pixi7Adapter`. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- the bound class value and its instance type share a name.
export type Pixi7Adapter = Pixi7AdapterBase;

export const normalizePixiName = bound.normalizePixiName;
export const checkSupportedVersion = bound.checkSupportedVersion;
export const PIXI7_PEER_RANGE = bound.PIXI7_PEER_RANGE;
export const PIXI7_BOUNDS = bound.PIXI7_BOUNDS;
export const PIXI7_TESTED_VERSIONS = bound.PIXI7_TESTED_VERSIONS;

export type { Pixi7AdapterBase, Pixi7AdapterConstructor, Pixi7AdapterOptions, Pixi7Manifest, Pixi7ManifestDetails } from './adapter.js';
export type { BoundExports } from './bind.js';
export { bindPixi, PIXI7_BINDING_EXPORTS } from './bind.js';
export type {
    IsPixi7Identifier,
    Pixi7CanonicalName,
    Pixi7LeafNode,
    Pixi7NameOverrides,
    Pixi7Node,
    Pixi7NodeConstructor,
    Pixi7NodeKeys,
    Pixi7PrefixedName,
    Pixi7StandardCatalog,
    Pixi7UnprefixedName,
} from './catalog.js';
export type { ConstructorSignature, PositionalArgument, PositionalBuiltin } from './construct.js';
export type { PixiBinding, PixiBindingExport, PixiModule } from './pixi.js';
export type {
    DrawCallback,
    ExcludeFunctionProps,
    OmitKeys,
    Pixi7AppProps,
    Pixi7ConstructorOverrides,
    Pixi7ConstructorProps,
    Pixi7DestroyOptions,
    Pixi7EventHandlers,
    Pixi7GlobalAppProps,
    Pixi7InitOptions,
    Pixi7InstanceProps,
    Pixi7Props,
    Pixi7PropsFamily,
    Pixi7ResizeTarget,
    Pixi7TickCallback,
    Pixi7Types,
    PixiToReactEventPropNames,
    WritableKeys,
} from './types.js';
export type { PixiVersion, SupportVerdict } from './version.js';
