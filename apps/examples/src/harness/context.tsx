import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type Harness, type HarnessApi } from './harness';

const HarnessContext = createContext<Harness | null>(null);

const NOOP: HarnessApi = {
    options: {},
    attach: () => undefined,
    detach: () => undefined,
    fail: () => undefined,
    report: () => undefined,
};

export function HarnessProvider({ harness, children }: { harness: Harness; children?: ReactNode })
{
    return <HarnessContext.Provider value={harness}>{children}</HarnessContext.Provider>;
}

/**
 * The example's handle on the harness; a no-op without a `HarnessProvider` (the docs render the examples without one).
 * With `scene`, the component reports that state after every commit, and `ready` (when given) says whether the scene
 * is complete. Every example calls it with `scene` from a component inside `<Application>`: that report follows the
 * scene's commit, which is what makes the route ready (see `Harness`).
 */
export function useExampleHarness(scene?: Record<string, unknown>, ready?: boolean): HarnessApi
{
    const harness = useContext(HarnessContext);

    useEffect(() =>
    {
        if (harness && scene) harness.report(scene, ready);
    });

    return harness ?? NOOP;
}
