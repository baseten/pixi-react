/**
 * Binds the single implementation to one loaded pixi.js 7 module (decision D6, adapted for a dual-package peer), as the
 * Pixi 8 adapter does.
 *
 * pixi.js 7 ships separate ESM and CJS builds (of `pixi.js` and of every `@pixi/*` package), so `import 'pixi.js'` and
 * `require('pixi.js')` can load two Pixi instances. The implementation never imports pixi.js at runtime: the CJS entry
 * binds the module `require` loads, and the generated ESM wrapper binds the module `import` loads. This module is
 * loaded once by both entries, so every bound export, lease table and style registry is cached per Pixi instance here,
 * and both entries share them whenever they share a Pixi instance.
 *
 * Each entry imports only `PIXI7_BINDING_EXPORTS`, by name, and passes those (never the module namespace).
 */
import { createAdapterClass, normalizePixiName, type Pixi7AdapterConstructor } from './adapter.js';
import { DefaultStyleRegistry, ExtensionLeaseTable } from './globals.js';
import { PixiNodes } from './nodes.js';
import { PIXI7_BINDING_EXPORTS, type PixiBinding } from './pixi.js';
import { checkSupportedVersion, PIXI7_BOUNDS, PIXI7_PEER_RANGE, PIXI7_TESTED_VERSIONS } from './version.js';

export { PIXI7_BINDING_EXPORTS };

/** Everything the package exports at runtime, bound to one Pixi module. */
export interface BoundExports
{
    readonly Pixi7Adapter: Pixi7AdapterConstructor;
    readonly normalizePixiName: typeof normalizePixiName;
    readonly checkSupportedVersion: typeof checkSupportedVersion;
    readonly PIXI7_PEER_RANGE: typeof PIXI7_PEER_RANGE;
    readonly PIXI7_BOUNDS: typeof PIXI7_BOUNDS;
    readonly PIXI7_TESTED_VERSIONS: typeof PIXI7_TESTED_VERSIONS;
}

/** Keyed by the module's `Container` class: one identity per Pixi instance, whichever namespace object wraps it. */
const bound = new WeakMap<object, BoundExports>();

function reportError(error: unknown): void
{
    console.error(error);
}

/**
 * Binds the implementation to the `PIXI7_BINDING_EXPORTS` of one loaded pixi.js 7 module, given as an object of those
 * exports (the entries pass exactly those) or as the whole module namespace. Cached per Pixi instance: every binding
 * of one instance returns the same exports. Only the binding exports are read and kept.
 */
export function bindPixi(binding: PixiBinding): BoundExports
{
    const key = binding?.Container;

    if (typeof key !== 'function' || typeof binding.Application !== 'function')
    {
        throw new TypeError(`bindPixi expects the pixi.js 7 exports ${PIXI7_BINDING_EXPORTS.join(', ')}.`);
    }

    let exports = bound.get(key);

    if (!exports)
    {
        const missing = PIXI7_BINDING_EXPORTS.filter((name) => binding[name] === undefined || binding[name] === null);

        // A supported pixi.js 7 lacking an export is a broken binding. Another version (pixi.js 8 lacks `SimpleMesh`,
        // `SimpleRope`, `SimplePlane` and `FXAAFilter`, for example) still binds, so that the adapter's
        // `checkEnvironment` rejects it at composition with UNSUPPORTED_TUPLE naming the Pixi 8 adapter.
        if (missing.length && checkSupportedVersion(binding.VERSION).supported)
        {
            throw new TypeError(`bindPixi expects the pixi.js 7 exports ${PIXI7_BINDING_EXPORTS.join(', ')}; missing ${missing.join(', ')}.`);
        }

        const pixi = Object.freeze(Object.fromEntries(PIXI7_BINDING_EXPORTS.map((name) => [name, binding[name]]))) as PixiBinding;
        const extensions = new ExtensionLeaseTable(pixi.extensions as unknown as ConstructorParameters<typeof ExtensionLeaseTable>[0]);
        const defaultStyle = new DefaultStyleRegistry(pixi.TextStyle.defaultStyle as unknown as Record<string, unknown>);

        exports = Object.freeze({
            Pixi7Adapter: createAdapterClass({
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
            PIXI7_PEER_RANGE,
            PIXI7_BOUNDS,
            PIXI7_TESTED_VERSIONS,
        });
        bound.set(key, exports);
    }

    return exports;
}
