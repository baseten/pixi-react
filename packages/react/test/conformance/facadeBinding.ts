import * as facade from '../../src/index';
import { facadeCoreRuntime } from '../utils/facadeRuntime';
import { expectedFailures } from './expectedFailures';
import { createPixi8Probe } from './pixiProbe';
import {
    act,
    type Composition,
    type ConformanceBinding,
    PIXI8_SCENE_CAPABILITIES,
    type PixiElement,
    type ReactBindingApi,
} from '@pixi-react-provisional/conformance';

import type { RootRecord } from '@pixi-react-provisional/core';

const api: ReactBindingApi = {
    // The conformance package compiles against its own @types/react line.
    Application: facade.Application as unknown as ReactBindingApi['Application'],
    createRoot: facade.createRoot,
    extend: facade.extend,
    useExtend: facade.useExtend,
    useApplication: facade.useApplication,
    useTick: facade.useTick,
    applyProps: facade.applyProps,
};

/** Deterministic application options: manual ticker, fixed size, no autostart. */
export const appOptions = Object.freeze({
    autoStart: false,
    sharedTicker: false,
    width: 64,
    height: 64,
    resolution: 1,
    antialias: false,
    backgroundAlpha: 0,
    preference: 'webgl',
});

const element = (name: string) => `pixi${name}` as unknown as PixiElement;

/**
 * Tears down roots a scenario left behind so the next scenario starts from an empty facade. The default facade is
 * one module-local runtime shared by every scenario, so a leaked root would otherwise outlive its scenario. Leaks
 * are asserted by scenarios via `rootCount`; this is only isolation.
 */
async function releaseRoots(existing: ReadonlySet<RootRecord<any>>)
{
    for (const root of facadeCoreRuntime().roots())
    {
        if (!existing.has(root))
        {
            await act(() => root.dispose());
        }
    }
}

/**
 * The default facade binding: `@pixi/react` from `packages/react/src`, the composed React19Adapter (19.3) and
 * Pixi8Adapter behind upstream's API, in the real browser harness. Each composition re-registers freshly spied
 * built-in constructors with the facade's global `extend` catalog (the historical prototype's "rebuild the
 * composition with spies" pattern); the facade itself is one module-local runtime.
 */
export const facadeBinding: ConformanceBinding = {
    id: '@pixi/react facade (React 19.3, Pixi 8)',
    capabilities: ['react.19', 'pixi.globals', 'dom.resize', 'parity.upstream', ...PIXI8_SCENE_CAPABILITIES],
    expectedFailures,
    create(): Composition
    {
        const existingRoots = new Set(facadeCoreRuntime().roots());
        const probe = createPixi8Probe(() => facadeCoreRuntime().roots().length);

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
