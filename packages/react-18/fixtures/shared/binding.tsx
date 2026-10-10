/**
 * The conformance binding of the React 18 cell: `createRenderer({ react: new React18Adapter(), pixi: new
 * Pixi8Adapter() })` from the PACKED packages, rendering real Pixi 8 applications in Chromium with React 18 and
 * react-dom 18. The probe is the Pixi 8 adapter's own browser probe, unchanged. Each scenario gets a fresh runtime.
 */
import { createPixi8Probe, type Pixi8Probe } from '../../../pixi-8/test/browser/pixiProbe';
import { PIXI8_SCENE_CAPABILITIES } from '@pixi-react-provisional/conformance';
import { Pixi8Adapter, type Pixi8Types } from '@pixi-react-provisional/pixi-8';
import { React18Adapter, type React18Family } from '@pixi-react-provisional/react-18';
import { createRenderer, type Renderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, PixiElement, ReactBindingApi } from '@pixi-react-provisional/conformance';

/** Deterministic application options: manual ticker, fixed size, no autostart (as the Pixi 8 and facade bindings). */
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

/**
 * `react.18` instead of `react.19`; `pixi.globals` and `dom.resize` as for the React 19 + Pixi 8 cells. Not
 * `parity.upstream`: only the facade promises upstream behaviour, and the facade composes React 19 (D1). React 19
 * capabilities React 18 lacks (`react.activity`, root error callbacks) are not provided either.
 */
export const REACT18_BINDING_CAPABILITIES: readonly Capability[] = ['react.18', 'pixi.globals', 'dom.resize', ...PIXI8_SCENE_CAPABILITIES];

export type React18Renderer = Renderer<React18Family, Pixi8Types>;

export interface React18Composition extends Composition
{
    readonly renderer: React18Renderer;
    readonly probe: Pixi8Probe;
}

export function createReact18Composition(): React18Composition
{
    let roots = () => 0;
    const probe = createPixi8Probe(() => roots());
    const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
    // Intrinsic tag strings cast to components: the minimum element typing this runtime fixture needs. Replaced by
    // issue 11's React 18 JSX entrypoint, which owns global tag declarations.
    const element = (name: string) => `pixi${name}` as unknown as PixiElement;

    roots = () => renderer.runtime.roots().length;
    renderer.extend(probe.catalog);

    return {
        renderer,
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

export function createReact18Binding(pixiVersion: string): ConformanceBinding
{
    return {
        id: `createRenderer: React18Adapter (react-reconciler 0.29.2) + Pixi8Adapter on pixi.js ${pixiVersion}`,
        capabilities: REACT18_BINDING_CAPABILITIES,
        expectedFailures: {},
        create: () => createReact18Composition(),
    };
}
