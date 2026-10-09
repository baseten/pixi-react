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
 */
import { createAdapterClass, normalizePixiName, type Pixi8AdapterConstructor } from './adapter.js';
import { DefaultStyleRegistry, ExtensionLeaseTable } from './globals.js';
import { PixiScene } from './scene.js';
import {
    checkSupportedVersion,
    PIXI8_BOUNDARIES,
    PIXI8_BOUNDS,
    PIXI8_PEER_RANGE,
    PIXI8_TESTED_VERSIONS,
} from './version.js';

import type { PixiModule } from './pixi.js';

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

export function bindPixi(pixi: PixiModule): BoundExports
{
    const key = pixi?.Container;

    if (typeof key !== 'function' || typeof pixi.Application !== 'function')
    {
        throw new TypeError('bindPixi expects the pixi.js module namespace.');
    }

    let exports = bound.get(key);

    if (!exports)
    {
        const extensions = new ExtensionLeaseTable(pixi.extensions as unknown as ConstructorParameters<typeof ExtensionLeaseTable>[0]);
        const defaultStyle = new DefaultStyleRegistry(pixi.TextStyle.defaultTextStyle as unknown as Record<string, unknown>);

        exports = Object.freeze({
            Pixi8Adapter: createAdapterClass({
                globals: {
                    pixi,
                    extensions,
                    defaultStyle,
                    reportError,
                    createScene: (enabled: (capability: string) => boolean) => new PixiScene(pixi, enabled),
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
