/**
 * The conformance binding of one cell: `createRenderer({ react, pixi })` from the PACKED packages, rendering real Pixi
 * applications in Chromium with the cell's own React, react-dom and pixi.js. The adapter classes come from the
 * generated `./adapter` module (the manifest names the package, entry and class), so this file never names a layout.
 */
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import { createPixi8Probe } from './pixiProbe';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, PixiElement, ReactBindingApi } from '@pixi-react-provisional/conformance';

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

function createComposition(): Composition
{
    let roots = () => 0;
    const probe = createPixi8Probe(() => roots());
    const renderer = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });
    // Intrinsic tag strings cast to components: the minimum element typing a runtime test needs.
    const element = (name: string) => `pixi${name}` as unknown as PixiElement;

    roots = () => renderer.runtime.roots().length;
    renderer.extend(probe.catalog);

    return {
        api: renderer as unknown as ReactBindingApi,
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
                await renderer.runtime.dispose();
            }
            finally
            {
                probe.restore();
            }
        },
    };
}

/** Scenarios the manifest records as confirmed defects of this React epoch (see `expectedConformanceFailures`). */
export type KnownFailures = Readonly<Record<string, { readonly reason: string; readonly match: string; readonly owner?: string }>>;

export function createCellBinding(id: string, capabilities: readonly Capability[], known: KnownFailures = {}): ConformanceBinding
{
    const expectedFailures = Object.fromEntries(Object.entries(known).map(([scenario, failure]) =>
        [scenario, { reason: failure.reason, match: new RegExp(failure.match), owner: failure.owner }]));

    return { id, capabilities, expectedFailures, create: createComposition };
}
