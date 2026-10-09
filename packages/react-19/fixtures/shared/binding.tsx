/**
 * Conformance binding for one React 19 epoch: `createRenderer({ framework: new React19Adapter(), scene })` with the
 * fake scene adapter, from the BUILT react-19 package. Each scenario gets a fresh composition (a fresh runtime).
 */
import { SceneJournal } from '@pixi-react-provisional/conformance';
import { createBuiltins, createFakeProbe } from '@pixi-react-provisional/conformance/fake-probe';
import { FakeSceneAdapter, type FakeSceneTypes } from '@pixi-react-provisional/conformance/fake-scene-adapter';
import { createRenderer, type Renderer } from '@pixi-react-provisional/renderer';

import type { Composition, ConformanceBinding, ReactBindingApi, SceneElement, SceneProbe } from '@pixi-react-provisional/conformance';
import type { React19AdapterBase, React19Family } from '@pixi-react-provisional/react-19/19.0';

/** What a subpath module exports, as far as the fixtures use it. */
export interface EpochModule
{
    readonly React19Adapter: new () => React19AdapterBase;
    readonly EPOCH: { readonly epoch: string; readonly reconciler: string; readonly testedReact: readonly string[] };
}

export type EpochRenderer = Renderer<React19Family, FakeSceneTypes>;

export interface EpochComposition extends Composition
{
    readonly renderer: EpochRenderer;
    readonly probe: SceneProbe;
}

export function createEpochComposition(epoch: EpochModule): EpochComposition
{
    const journal = new SceneJournal();
    const { builtins, kindOf } = createBuiltins();
    let rootCount = () => 0;
    const { probe, interceptInit } = createFakeProbe(journal, () => rootCount());
    const renderer = createRenderer({
        framework: new epoch.React19Adapter(),
        scene: new FakeSceneAdapter({ journal, kindOf, interceptInit, prefix: 'fake' }),
    });

    rootCount = () => renderer.runtime.roots().length;
    renderer.extend(builtins);

    // Built-in kinds use the component(Ctor) route; names registered later through extend use intrinsic tags.
    const elements = {
        container: renderer.component(builtins.Container) as SceneElement,
        sprite: renderer.component(builtins.Sprite) as SceneElement,
        graphics: renderer.component(builtins.Graphics) as SceneElement,
        text: renderer.component(builtins.Text) as SceneElement,
    };

    return {
        renderer,
        api: renderer as unknown as ReactBindingApi,
        elements,
        elementFor: (name: string) => `fake${name}` as unknown as SceneElement,
        probe,
        appOptions: { width: 64, height: 64 },
        // Disposing the runtime tears down every root it still holds and aggregates failures.
        dispose: () => renderer.runtime.dispose(),
    };
}

export function createEpochBinding(epoch: EpochModule): ConformanceBinding
{
    return {
        id: `react-19/${epoch.EPOCH.epoch} (react-reconciler ${epoch.EPOCH.reconciler}) + fake scene`,
        capabilities: ['framework.react-19', 'dom.resize'],
        // No expected failures: every issue-9 defect the facade still lists is fixed in the adapter.
        expectedFailures: {},
        create: () => createEpochComposition(epoch),
    };
}
