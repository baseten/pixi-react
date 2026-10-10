/**
 * Binds the single implementation to one loaded pixi.js module (decision D6, adapted for a dual-package peer).
 *
 * pixi.js ships separate ESM and CJS builds, so `import 'pixi.js'` and `require('pixi.js')` can load two Pixi
 * instances. If this package's one CJS implementation required pixi.js itself, an ESM consumer's `Sprite` and the
 * adapter's `Sprite` would come from different instances (different `extensions` registries, `TextStyle` defaults
 * and classes). Instead the implementation never imports pixi.js at runtime: the CJS entry binds the module
 * `require` loads, and the generated ESM wrapper binds the module `import` loads. This module is loaded once by
 * both entries, so every bound export, lease table and style registry is cached per Pixi instance here, and both
 * entries share them whenever they share a Pixi instance.
 *
 * Each entry imports only `PIXI8_BINDING_EXPORTS`, by name, and passes those (never the module namespace), so a
 * bundler keeps only the Pixi classes the application itself imports, as with the upstream facade.
 */
import { createAdapterClass, normalizePixiName, type Pixi8AdapterConstructor } from './adapter.js';
import { DefaultStyleRegistry, ExtensionLeaseTable } from './globals.js';
import { PixiNodes } from './nodes.js';
import { PIXI8_BINDING_EXPORTS, type PixiBinding } from './pixi.js';
import {
    checkSupportedVersion,
    PIXI8_BOUNDARIES,
    PIXI8_BOUNDS,
    PIXI8_PEER_RANGE,
    PIXI8_TESTED_VERSIONS,
} from './version.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

export { PIXI8_BINDING_EXPORTS };

/** Everything the package exports at runtime, bound to one Pixi module. */
export interface BoundExports
{
    readonly Pixi8Adapter: Pixi8AdapterConstructor;
    readonly normalizePixiName: typeof normalizePixiName;
    readonly checkSupportedVersion: typeof checkSupportedVersion;
    readonly PIXI8_PEER_RANGE: typeof PIXI8_PEER_RANGE;
    readonly PIXI8_BOUNDS: typeof PIXI8_BOUNDS;
    readonly PIXI8_BOUNDARIES: typeof PIXI8_BOUNDARIES;
    readonly PIXI8_TESTED_VERSIONS: typeof PIXI8_TESTED_VERSIONS;
}

/** Keyed by the module's `Container` class: one identity per Pixi instance, whichever namespace object wraps it. */
const bound = new WeakMap<object, BoundExports>();

function reportError(error: unknown): void
{
    console.error(error);
}

/**
 * Binds the implementation to the `PIXI8_BINDING_EXPORTS` of one loaded pixi.js module, given as an object of those
 * exports (the entries pass exactly those) or as the whole module namespace. Cached per Pixi instance: every binding
 * of one instance returns the same exports. Only the binding exports are read and kept.
 */
export function bindPixi(binding: PixiBinding): BoundExports
{
    const key = binding?.Container;

    if (typeof key !== 'function' || typeof binding.Application !== 'function')
    {
        throw new TypeError(process.env.NODE_ENV !== 'production' ? `bindPixi expects the pixi.js exports ${PIXI8_BINDING_EXPORTS.join(', ')}.` : 'Invalid bindPixi() exports.');
    }

    let exports = bound.get(key);

    if (!exports)
    {
        const missing = PIXI8_BINDING_EXPORTS.filter((name) => binding[name] === undefined || binding[name] === null);

        if (missing.length)
        {
            throw new TypeError(process.env.NODE_ENV !== 'production' ? `bindPixi expects the pixi.js exports ${PIXI8_BINDING_EXPORTS.join(', ')}; missing ${missing.join(', ')}.` : `bindPixi() is missing ${missing.join(', ')}.`);
        }

        const pixi = Object.freeze(Object.fromEntries(PIXI8_BINDING_EXPORTS.map((name) => [name, binding[name]]))) as PixiBinding;
        const extensions = new ExtensionLeaseTable(pixi.extensions as unknown as ConstructorParameters<typeof ExtensionLeaseTable>[0]);
        const defaultStyle = new DefaultStyleRegistry(pixi.TextStyle.defaultTextStyle as unknown as Record<string, unknown>);

        exports = Object.freeze({
            Pixi8Adapter: createAdapterClass({
                globals: {
                    pixi,
                    extensions,
                    defaultStyle,
                    reportError,
                    createNodes: (enabled: (capability: string) => boolean) => new PixiNodes(pixi, enabled),
                },
            }),
            normalizePixiName,
            checkSupportedVersion,
            PIXI8_PEER_RANGE,
            PIXI8_BOUNDS,
            PIXI8_BOUNDARIES,
            PIXI8_TESTED_VERSIONS,
        });
        bound.set(key, exports);
    }

    return exports;
}
