/**
 * The conformance binding of one cell: `createRenderer({ react, pixi })` from the PACKED packages, rendering real Pixi
 * applications in Chromium with the cell's own React, react-dom and pixi.js. The adapter classes come from the
 * generated `./adapter` module (the manifest names the package, entry and class), and the probe, its factory and the
 * deterministic application options come from the Pixi adapter's manifest row, so this file never names a layout.
 */
import cell from '../cell.json';
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import * as probes from './pixiProbe';
import { rendererAppOptions } from './renderer';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, PixiElement, PixiProbe, ReactBindingApi } from '@pixi-react-provisional/conformance';

/** What a cell needs from a Pixi adapter's probe module (`probeSource`, `probeFactory` in the manifest). */
interface CellProbe extends PixiProbe
{
    readonly catalog: Record<string, new (...args: any[]) => object>;
    /** Instruments the adapter's sessions, for probes that cannot hook the Pixi application class (Pixi 7). */
    instrumentAdapter?<A extends object>(adapter: A): A;
    restore(): void;
}

const createProbe = (probes as unknown as Record<string, (rootCount: () => number) => CellProbe>)[cell.probeFactory];

/**
 * Deterministic application options of the cell's Pixi adapter (manual ticker, fixed size, no autostart), plus the
 * options that select this run's render backend (test/renderer.ts).
 */
export const appOptions = Object.freeze({ ...cell.appOptions, ...rendererAppOptions });

/**
 * Data-only probes (data-only.json) run the suite past the adapters' environment checks, to record what would happen
 * on a React or pixi.js the adapter rejects. Never set for a verification cell.
 */
function bypassForData<A extends object>(adapter: A): A
{
    if ((cell as { dataOnly?: { bypassEnvironmentCheck?: boolean } }).dataOnly?.bypassEnvironmentCheck)
    {
        Object.defineProperty(adapter, 'checkEnvironment', { value: () => undefined });
    }

    return adapter;
}

function createComposition(): Composition
{
    let roots = () => 0;
    const probe = createProbe(() => roots());
    const adapter = bypassForData(new PixiAdapterClass());
    const renderer = createRenderer({ react: bypassForData(new ReactAdapterClass()), pixi: probe.instrumentAdapter ? probe.instrumentAdapter(adapter) : adapter });
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
