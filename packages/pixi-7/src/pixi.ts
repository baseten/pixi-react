/**
 * The pixi.js 7 exports the implementation is bound to. The implementation never imports pixi.js at runtime: each
 * entry point binds the module its own module system loaded (see `bind.ts`), so a consumer's
 * `import { Sprite } from 'pixi.js'` and the adapter always share one Pixi instance (D6).
 *
 * Unlike the Pixi 8 adapter, this one imports the built-in classes it treats specially by name and recognizes them by
 * identity. pixi.js 7 declares no `sideEffects` field and its entry imports every `@pixi/*` package, so a bundler keeps
 * nearly all of pixi.js 7 whatever an application imports (esbuild 0.21.5: 350 modules for `Container` and `Sprite`
 * alone; these names add 9 modules, 13 KiB minified). Identity is exact where prototype signatures would be ambiguous
 * (`FXAAFilter` declares no member of its own, and `Text` extends `Sprite` in Pixi 7).
 */
import type * as Pixi from 'pixi.js';

/**
 * The pixi.js 7 exports the implementation uses at runtime, imported by name by each entry point. Every one exists on
 * the 7.2.0 floor and on every later tested release (7.2.4, 7.3.0, 7.3.3, 7.4.2, 7.4.3), so a strict ESM named import
 * never fails within the peer range.
 *
 * - `Application`, `autoDetectRenderer`: the session runs Pixi 7's application construction itself (`session.ts`).
 * - `Container`, `Filter`: what a node is.
 * - The display objects and filters with positional constructors (`construct.ts`) and the classes that supply kind
 *   defaults.
 * - `ObservablePoint`, `Point`, `TextStyle`: snapshots of captured values; `TextStyle.defaultStyle` is the global
 *   default text style. `extensions`: the extension leases. `VERSION`: the supported-range check.
 */
export const PIXI7_BINDING_EXPORTS = Object.freeze([
    'AlphaFilter',
    'AnimatedSprite',
    'Application',
    'BitmapText',
    'BlurFilter',
    'ColorMatrixFilter',
    'Container',
    'DisplacementFilter',
    'FXAAFilter',
    'Filter',
    'Graphics',
    'HTMLText',
    'Mesh',
    'NineSlicePlane',
    'NoiseFilter',
    'ObservablePoint',
    'ParticleContainer',
    'Point',
    'SimpleMesh',
    'SimplePlane',
    'SimpleRope',
    'Sprite',
    'Text',
    'TextStyle',
    'TilingSprite',
    'VERSION',
    'autoDetectRenderer',
    'extensions',
] as const);

/** The name of a pixi.js export the implementation is bound to. */
export type PixiBindingExport = typeof PIXI7_BINDING_EXPORTS[number];

/** The pixi.js exports the implementation is bound to: `PIXI7_BINDING_EXPORTS`, taken from one loaded pixi.js 7 module. */
export type PixiBinding = Pick<typeof Pixi, PixiBindingExport>;

/** A whole pixi.js 7 module namespace. A namespace is also a valid `PixiBinding` (tests bind namespaces). */
export type PixiModule = typeof Pixi;
