/**
 * Conformance bindings for core + renderer: `createRenderer({ react, pixi })` with the fake React
 * adapter and the fake Pixi adapter. Each scenario gets a fresh composition, so a fresh runtime.
 */
import { PIXI8_SCENE_CAPABILITIES } from '../../src/binding';
import { FakePixiAdapter } from '../../src/fake-pixi/adapter';
import { FakeReactAdapter } from '../../src/fake-react/adapter';
import { PixiJournal } from '../../src/journal';
import { createBuiltins, createFakeProbe } from '../fake-binding/probe';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Capability, Composition, ConformanceBinding, PixiElement, ReactBindingApi } from '../../src/binding';
import type { FakeRuntimeFaults } from '../fake-binding/runtime';
import type { RendererOptions } from '@pixi-react-provisional/core';

function createComposition(options: RendererOptions, faults: FakeRuntimeFaults = {}): Composition
{
    const journal = new PixiJournal();
    const { builtins, kindOf } = createBuiltins();
    let rootCount = () => 0;
    const { probe, interceptInit } = createFakeProbe(journal, () => rootCount());
    const renderer = createRenderer(
        {
            react: new FakeReactAdapter({ leakInitRejection: faults.leakInitRejection }),
            pixi: new FakePixiAdapter({ journal, kindOf, interceptInit, faults, prefix: 'fake' }),
        },
        options,
    );

    rootCount = () => renderer.runtime.roots().length;
    renderer.extend(builtins);

    const api: ReactBindingApi = renderer;
    const element = (name: string) => renderer.tagFor(name) as unknown as PixiElement;

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
        appOptions: { width: 64, height: 64 },
        // Disposing the runtime tears down every root it still holds and aggregates failures.
        dispose: () => renderer.runtime.dispose(),
    };
}

/**
 * Capabilities: the fake React adapter renders with React 19 and the fake Pixi resizes to DOM elements. It
 * does not provide `pixi.globals` (the fake Pixi backend has no global extension or text-style registry: issue 8 binds
 * those with Pixi), `react.18` (bound by the React 18 binding, issue 12) or `parity.upstream` (the contract registry rejects
 * conflicting `extend` calls). Scenarios that need them are listed as skipped by the runner, with the reason.
 */
export const CORE_BINDING_CAPABILITIES: readonly Capability[] = ['react.19', 'dom.resize', ...PIXI8_SCENE_CAPABILITIES];

/** With `faults`, a deliberately faulty composition for negative controls. */
export function createCoreBinding(faults: FakeRuntimeFaults = {}): ConformanceBinding
{
    return {
        id: 'core + renderer (fake React 19 adapter, fake Pixi adapter)',
        capabilities: CORE_BINDING_CAPABILITIES,
        // No expected failures: in particular `createRoot.same-element`, a confirmed facade defect owned by
        // issue 7, passes because core maps an element target and its canvas to one root record.
        expectedFailures: {},
        create: () => createComposition({}, faults),
    };
}

/**
 * The same composition with the registry's upstream conflict policy, which the default facade selects for D4
 * parity. It provides `parity.upstream`; it is run only with the parity scenarios its policy concerns.
 */
export function createCoreParityBinding(): ConformanceBinding
{
    return {
        id: 'core + renderer, registryConflict: replace (D4 facade policy)',
        capabilities: [...CORE_BINDING_CAPABILITIES, 'parity.upstream'],
        create: () => createComposition({ registryConflict: 'replace' }),
    };
}
