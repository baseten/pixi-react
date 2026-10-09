import { useMemo } from 'react';

import type { createExtend } from '../helpers/extend';

/** Creates the facade's `useExtend`: the facade's `extend`, memoized on the catalog object. */
export function createUseExtend(extend: ReturnType<typeof createExtend>)
{
    /** Expose Pixi.js components for use in JSX. */
    return function useExtend(
        /** @description The Pixi.js components to be exposed. */
        objects: Parameters<typeof extend>[0],
    ): void
    {
        useMemo(() =>
        {
            extend(objects);
        }, [objects]);
    };
}
