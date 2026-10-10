/**
 * Conformance binding for one React 19 epoch: `createRenderer({ react: new React19Adapter(), pixi })` with the
 * fake Pixi adapter, from the BUILT per-minor package. Each scenario gets a fresh composition (a fresh runtime).
 */
import { PIXI8_SCENE_CAPABILITIES, PixiJournal } from '@pixi-react-provisional/conformance';
import { FakePixiAdapter, type FakePixiTypes } from '@pixi-react-provisional/conformance/fake-pixi-adapter';
import { createBuiltins, createFakeProbe } from '@pixi-react-provisional/conformance/fake-probe';
import { createRenderer, type Renderer } from '@pixi-react-provisional/renderer';

import type { Composition, ConformanceBinding, PixiElement, PixiProbe, ReactBindingApi } from '@pixi-react-provisional/conformance';
import type { React19AdapterBase, React19Family } from '@pixi-react-provisional/react-19-under-test';

/** What a per-minor package exports, as far as the fixtures use it. */
export interface EpochModule
{
    readonly React19Adapter: new () => React19AdapterBase;
    readonly EPOCH: { readonly epoch: string; readonly reconciler: string; readonly testedReact: readonly string[] };
}

export type EpochRenderer = Renderer<React19Family, FakePixiTypes>;

export interface EpochComposition extends Composition
{
    readonly renderer: EpochRenderer;
    readonly probe: PixiProbe;
}

export function createEpochComposition(epoch: EpochModule): EpochComposition
{
    const journal = new PixiJournal();
    const { builtins, kindOf } = createBuiltins();
    let rootCount = () => 0;
    const { probe, interceptInit } = createFakeProbe(journal, () => rootCount());
    const renderer = createRenderer({
        react: new epoch.React19Adapter(),
        pixi: new FakePixiAdapter({ journal, kindOf, interceptInit, prefix: 'fake' }),
    });

    rootCount = () => renderer.runtime.roots().length;
    renderer.extend(builtins);

    // Built-in kinds use the component(Ctor) route; names registered later through extend use intrinsic tags.
    const elements = {
        container: renderer.component(builtins.Container) as PixiElement,
        sprite: renderer.component(builtins.Sprite) as PixiElement,
        graphics: renderer.component(builtins.Graphics) as PixiElement,
        text: renderer.component(builtins.Text) as PixiElement,
    };

    return {
        renderer,
        api: renderer as unknown as ReactBindingApi,
        elements,
        elementFor: (name: string) => `fake${name}` as unknown as PixiElement,
        probe,
        appOptions: { width: 64, height: 64 },
        // Disposing the runtime tears down every root it still holds and aggregates failures.
        dispose: () => renderer.runtime.dispose(),
    };
}

export function createEpochBinding(epoch: EpochModule): ConformanceBinding
{
    return {
        id: `react-${epoch.EPOCH.epoch} (react-reconciler ${epoch.EPOCH.reconciler}) + fake Pixi`,
        capabilities: ['react.19', 'dom.resize', ...PIXI8_SCENE_CAPABILITIES],
        // No expected failures: every issue-9 defect the facade still lists is fixed in the adapter.
        expectedFailures: {},
        create: () => createEpochComposition(epoch),
    };
}
