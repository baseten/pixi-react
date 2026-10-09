import { facadeRuntimeFor } from '../../src/bind';
import * as pixi8 from '@pixi-react-provisional/pixi-8';

/**
 * The default runtime behind the facade that `src/index.ts` binds (the same `Pixi8Adapter` module, so the same
 * cached binding). Tests use it to count and release roots; it is not part of the package API.
 */
export function facadeCoreRuntime()
{
    return facadeRuntimeFor(pixi8).renderer().runtime;
}
