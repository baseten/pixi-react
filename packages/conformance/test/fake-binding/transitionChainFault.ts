import * as React from 'react';

import type { FakeRuntimeFaults } from './runtime';

interface SharedInternals19
{
    S: ((...args: unknown[]) => void) | null;
}

/**
 * Applies the `breakTransitionChain` fault: replaces React 19's transition-finish handler with one that throws before
 * forwarding, like react-reconciler 0.34 reading `transition.types.length` on a React 19.0-19.2 transition. Returns
 * the function that restores the replaced handler.
 */
export function applyTransitionChainFault(faults: FakeRuntimeFaults): () => void
{
    const internals = (React as unknown as Record<string, SharedInternals19 | undefined>)
        .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    if (!faults.breakTransitionChain || !internals)
    {
        return () => undefined;
    }

    const previous = internals.S;

    internals.S = function faultyOnStartTransitionFinish(this: unknown, ...args: unknown[])
    {
        const { types } = args[0] as { types?: readonly unknown[] | null };
        const queued: unknown[] = [];

        // 0.34 checks only for `null`. React 19.0-19.2 transitions have no `types` at all, so reading its length throws
        // before the previous handler is called.
        if (types !== null)
        {
            for (let i = 0; i < (types as readonly unknown[]).length; i++)
            {
                queued.push((types as readonly unknown[])[i]);
            }
        }

        previous?.apply(this, args);
    };

    return () =>
    {
        internals.S = previous;
    };
}
