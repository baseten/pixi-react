import { isCompatibilityError } from '../runtime/errors';
import { type ApplicationState } from '../typedefs/ApplicationState';

import type { FacadeRuntime } from '../runtime/composition';

/** Upstream's error outside an `<Application>` (its `invariant` message). */
function noContextError(cause: unknown): Error
{
    const error = new Error(
        'No Context found with `Application`. Make sure to wrap component with `AppProvider`',
        { cause },
    );

    error.name = 'Invariant Violation';

    return error;
}

/** Creates the facade's `useApplication` over the default composition's hook. */
export function createUseApplication(runtime: FacadeRuntime)
{
    /**
     * @description Retrieves the nearest Pixi.js Application from the Pixi React context.
     */
    return function useApplication(): ApplicationState
    {
        try
        {
            return runtime.applicationState(runtime.renderer().useApplication());
        }
        catch (error)
        {
            // Inside another runtime's application the adapter's own error names the problem
            // (`react-19.FOREIGN_RUNTIME`); outside any application, keep upstream's message.
            if (isCompatibilityError(error))
            {
                throw error;
            }

            throw noContextError(error);
        }
    };
}
