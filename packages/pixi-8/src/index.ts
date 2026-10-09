/**
 * The CJS entry: binds the implementation to the pixi.js module `require` loads. The generated ESM wrapper
 * (`dist/esm/index.mjs`) binds the module `import` loads instead; see `bind.ts`.
 */
import * as pixi from 'pixi.js';
import { bindPixi } from './bind.js';

import type { Pixi8AdapterBase } from './adapter.js';

const bound = bindPixi(pixi);

/** The Pixi 8 adapter, bound to the loaded pixi.js module. */
export const Pixi8Adapter = bound.Pixi8Adapter;
/** An instance of `Pixi8Adapter`. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- the bound class value and its instance type share a name.
export type Pixi8Adapter = Pixi8AdapterBase;

export const normalizePixiName = bound.normalizePixiName;
export const checkSupportedVersion = bound.checkSupportedVersion;
export const PIXI8_PEER_RANGE = bound.PIXI8_PEER_RANGE;
export const PIXI8_BOUNDS = bound.PIXI8_BOUNDS;
export const PIXI8_BOUNDARIES = bound.PIXI8_BOUNDARIES;
export const PIXI8_TESTED_VERSIONS = bound.PIXI8_TESTED_VERSIONS;

export type { Pixi8AdapterBase, Pixi8AdapterConstructor, Pixi8AdapterOptions, Pixi8Manifest, Pixi8ManifestDetails } from './adapter.js';
export type { BoundExports } from './bind.js';
export { bindPixi } from './bind.js';
export type {
    InstalledPixiEntries,
    InstalledPixiExport,
    Pixi8CanonicalName,
    Pixi8FloorCatalog,
    Pixi8LaterExport,
    Pixi8LeafNode,
    Pixi8NameOverrides,
    Pixi8Node,
    Pixi8NodeConstructor,
    Pixi8NodeKeys,
    Pixi8ParticleInstance,
    Pixi8PrefixedName,
    Pixi8StandardCatalog,
    Pixi8UnprefixedName,
} from './catalog.js';
export type { PixiFeatures } from './nodes.js';
export type { OptionalPixiExports, ParticleContainerLike, ParticleLike, PixiModule } from './pixi.js';
export type {
    ConstructorOptions,
    ConstructorOverrides,
    DrawCallback,
    ExcludeFunctionProps,
    InstalledOptions,
    OmitKeys,
    OverloadedOptions,
    Pixi8AppProps,
    Pixi8DestroyOptions,
    Pixi8EventHandlers,
    Pixi8GlobalAppProps,
    Pixi8InitOptions,
    Pixi8Props,
    Pixi8PropsFamily,
    Pixi8ResizeTarget,
    Pixi8TickCallback,
    Pixi8Types,
    PixiToReactEventPropNames,
} from './types.js';
export type { PixiVersion, SupportVerdict } from './version.js';
