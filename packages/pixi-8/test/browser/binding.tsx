/**
 * The conformance binding of the real Pixi 8 adapter: `createRenderer({ framework, scene })` with the conformance
 * package's fake React 19 framework adapter (a react-reconciler 0.31 test double; the real one is issue 9) and
 * `Pixi8Adapter`, rendering real Pixi applications in Chromium. Each scenario gets a fresh runtime.
 */
import { Pixi8Adapter, type Pixi8AdapterOptions } from '../../src/index';
import { createPixiProbe } from './pixiProbe';
import { FakeReactFrameworkAdapter } from '@pixi-react-provisional/conformance/fake-react-framework';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, ReactBindingApi, SceneElement } from '@pixi-react-provisional/conformance';

/** Deterministic application options: manual ticker, fixed size, no autostart (as the facade binding). */
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
 * `scene.globals`: the adapter leases extensions and the default text style, and the probe observes both.
 * `parity.upstream` is not provided: the modular adapter ships the corrected global behaviour (D4), so the parity
 * scenarios that record upstream's extension and default-style quirks do not apply.
 */
export const PIXI8_BINDING_CAPABILITIES: readonly Capability[] = ['framework.react-19', 'scene.globals', 'dom.resize'];

/** A fresh composition; scene tests also get the renderer and the adapter. */
export function createPixi8Composition(options: Pixi8AdapterOptions = {})
{
    let roots = () => 0;
    const probe = createPixiProbe(() => roots());
    const adapter = new Pixi8Adapter(options);
    const renderer = createRenderer({ framework: new FakeReactFrameworkAdapter(), scene: adapter });

    roots = () => renderer.runtime.roots().length;
    renderer.extend(probe.catalog);

    const api: ReactBindingApi = renderer;
    const element = (name: string) => `pixi${name}` as unknown as SceneElement;

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

export function createPixi8Binding(version: string): ConformanceBinding
{
    return {
        id: `core + renderer + Pixi8Adapter on pixi.js ${version} (fake React 19 framework adapter)`,
        capabilities: PIXI8_BINDING_CAPABILITIES,
        // Every issue-8 defect the facade still lists passes here; nothing is expected to fail.
        expectedFailures: {},
        create: () => createPixi8Composition(),
    };
}
