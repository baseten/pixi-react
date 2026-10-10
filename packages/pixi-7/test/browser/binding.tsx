/**
 * The conformance binding of the real Pixi 7 adapter: `createRenderer({ react, pixi })` with the conformance package's
 * fake React 19 adapter (a react-reconciler 0.31 test double) and `Pixi7Adapter`, rendering real Pixi 7 applications in
 * Chromium. Each scenario gets a fresh runtime. The real React 18 and React 19.x adapters run the same suite with this
 * probe in the compatibility cells (design/compatibility/cells).
 */
import { Pixi7Adapter, type Pixi7AdapterOptions } from '../../src/index';
import { createPixi7Probe } from './pixiProbe';
import { FakeReactAdapter } from '@pixi-react-provisional/conformance/fake-react-adapter';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, PixiElement, ReactBindingApi } from '@pixi-react-provisional/conformance';

/** Deterministic Pixi 7 application options: manual ticker, fixed size, no autostart, no console banner. */
export const appOptions = Object.freeze({
    autoStart: false,
    sharedTicker: false,
    width: 64,
    height: 64,
    resolution: 1,
    antialias: false,
    backgroundAlpha: 0,
    hello: false,
});

/**
 * `pixi.globals`: the adapter leases extensions and the default text style, and the probe observes both;
 * `pixi.filter-children`: filter elements join their parent's `filters` in JSX order. Not provided:
 * `parity.upstream` (as for the Pixi 8 adapter, the modular adapter ships the corrected global behaviour), and the
 * Pixi 8 scene features `pixi.graphics-context` (Pixi 7 has no GraphicsContext) and `pixi.renderer-destroy-options`
 * (Pixi 7's `Application.destroy` takes `removeView`, a boolean, not Pixi 8's renderer options object). The runner
 * skips those scenarios and names the capability.
 */
export const PIXI7_BINDING_CAPABILITIES: readonly Capability[] = ['react.19', 'pixi.globals', 'dom.resize', 'pixi.filter-children'];

/** A fresh composition; Pixi-specific tests also get the renderer and the adapter. */
export function createPixi7Composition(options: Pixi7AdapterOptions = {})
{
    let roots = () => 0;
    const probe = createPixi7Probe(() => roots());
    const adapter = probe.instrumentAdapter(new Pixi7Adapter(options));
    const renderer = createRenderer({ react: new FakeReactAdapter(), pixi: adapter });

    roots = () => renderer.runtime.roots().length;
    renderer.extend(probe.catalog);

    const api: ReactBindingApi = renderer;
    const element = (name: string) => `pixi${name}` as unknown as PixiElement;

    const composition: Composition = {
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
                await renderer.runtime.dispose();
            }
            finally
            {
                probe.restore();
            }
        },
    };

    return Object.assign(composition, { renderer, adapter, probe });
}

export function createPixi7Binding(version: string): ConformanceBinding
{
    return {
        id: `core + renderer + Pixi7Adapter on pixi.js ${version} (fake React 19 adapter)`,
        capabilities: PIXI7_BINDING_CAPABILITIES,
        expectedFailures: {},
        create: () => createPixi7Composition(),
    };
}
