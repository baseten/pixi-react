import { type TickerCallback } from 'pixi.js';
import { type UseTickOptions } from '../typedefs/UseTickOptions';

import type { FacadeRuntime } from '../runtime/composition';
import type { createUseApplication } from './useApplication';

/** Creates the facade's `useTick` over the default composition's hook. */
export function createUseTick(runtime: FacadeRuntime, useApplication: ReturnType<typeof createUseApplication>)
{
    /** Attaches a callback to the application's Ticker. */
    return function useTick<T>(
        /** @description The function to be called on each tick. */
        options: TickerCallback<T> | UseTickOptions<T>,
    ): void
    {
        // Upstream read the application first, so outside an <Application> its error comes first.
        useApplication();

        const callback = typeof options === 'function' ? options : options?.callback;

        if (typeof callback !== 'function')
        {
            const error = new Error('`useTick` needs a callback function.');

            error.name = 'Invariant Violation';
            throw error;
        }

        runtime.renderer().useTick<T>(options as never);
    };
}
