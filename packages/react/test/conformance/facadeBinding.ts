import { roots } from '../../src/core/roots';
import { unmountRoot } from '../../src/helpers/unmountRoot';
import * as facade from '../../src/index';
import { store } from '../../src/store';
import { type Root } from '../../src/typedefs/Root';
import { expectedFailures } from './expectedFailures';
import { createPixiProbe } from './pixiProbe';
import {
    act,
    type Composition,
    type ConformanceBinding,
    type ReactBindingApi,
    type SceneElement,
} from '@pixi-react-provisional/conformance';

const api: ReactBindingApi = {
    Application: facade.Application,
    createRoot: facade.createRoot,
    extend: facade.extend,
    useExtend: facade.useExtend,
    useApplication: facade.useApplication,
    useTick: facade.useTick,
    applyProps: facade.applyProps,
};

/** Deterministic application options: manual ticker, fixed size, no autostart. */
const appOptions = Object.freeze({
    autoStart: false,
    sharedTicker: false,
    width: 64,
    height: 64,
    resolution: 1,
    antialias: false,
    backgroundAlpha: 0,
    preference: 'webgl',
});

const element = (name: string) => `pixi${name}` as unknown as SceneElement;

/**
 * Removes roots a scenario left behind so the next scenario starts from an empty facade. The facade keeps
 * roots in module-global state and `createRoot` roots have no public unmount, so a leaked root would
 * otherwise be torn down during a later scenario. Leaks are asserted by scenarios via `rootCount`; this is
 * only isolation, using facade internals because no public API exists.
 */
async function releaseRoots(existing: ReadonlySet<Root>)
{
    for (const [key, root] of [...roots.entries()])
    {
        if (existing.has(root))
        {
            continue;
        }

        if (root.applicationState.isInitialised)
        {
            await act(() => unmountRoot(root));
        }

        store.unmountQueue.delete(root);
        roots.delete(key);
    }
}

/**
 * The baseline binding: the current `@pixi/react` facade (React 19 + Pixi 8) from `packages/react/src`,
 * running in the real browser harness. Each composition re-registers freshly spied built-in constructors
 * with the facade's global `extend` catalog, following the historical prototype's "rebuild the composition
 * with spies" pattern; the facade itself offers no way to build a separate composition.
 */
export const facadeBinding: ConformanceBinding = {
    id: '@pixi/react facade (React 19, Pixi 8)',
    capabilities: ['framework.react-19', 'scene.globals', 'dom.resize', 'parity.upstream'],
    expectedFailures,
    create(): Composition
    {
        const existingRoots = new Set(roots.values());
        const probe = createPixiProbe(() => roots.size);

        facade.extend(probe.catalog);

        return {
            api,
            elements: {
                container: element('Container'),
                sprite: element('Sprite'),
                graphics: element('Graphics'),
                text: element('Text'),
            },
            elementFor: element,
            probe,
            appOptions,
            async dispose()
            {
                try
                {
                    await releaseRoots(existingRoots);
                }
                finally
                {
                    probe.restore();
                }
            },
        };
    },
};
