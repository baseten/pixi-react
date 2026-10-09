import { isCompatibilityError } from '../runtime/errors';
import { DROPPED_NODE_ATTACH } from '../runtime/sceneAdapter';

import type { FacadeRuntime } from '../runtime/composition';

/** Registration errors upstream's `Object.assign(catalogue, objects)` never raised. */
function isTolerated(error: unknown): boolean
{
    return isCompatibilityError(error, 'UNSUPPORTED_NODE', 'UNKNOWN_ELEMENT');
}

/**
 * Creates the facade's `extend`. It registers into the default runtime's catalog with upstream semantics (D4):
 *
 * - a name already bound to another constructor is silently replaced (`registryConflict: 'replace'`);
 * - every entry registers on its own, and nothing throws: a constructor Pixi8Adapter does not support as a scene
 *   node (`Texture`, `Point`, …) is registered as a dropped node (see `runtime/sceneAdapter.ts`), and a value that
 *   is not a constructor is ignored, so rendering it reports an unknown element.
 */
export function createExtend(runtime: FacadeRuntime)
{
    return function extend(objects: {
        [key: string]: new (...args: any) => any },
    ): void
    {
        if (objects === null || typeof objects !== 'object')
        {
            return;
        }

        const renderer = runtime.renderer();

        for (const [key, value] of Object.entries(objects))
        {
            if (typeof value !== 'function')
            {
                continue;
            }

            try
            {
                renderer.extend({ [key]: value });
            }
            catch (error)
            {
                if (!isTolerated(error))
                {
                    throw error;
                }

                try
                {
                    runtime.scene.droppedConstructors.add(value);
                    renderer.runtime.registry.register({
                        name: runtime.scene.normalizeName(key),
                        ctor: value,
                        capabilities: {},
                        attach: DROPPED_NODE_ATTACH,
                    });
                }
                catch (registerError)
                {
                    if (!isTolerated(registerError))
                    {
                        throw registerError;
                    }
                }
            }
        }
    };
}
