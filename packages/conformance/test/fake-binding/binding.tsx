import { SceneJournal } from '../../src/journal';
import { createBuiltins, createFakeProbe } from './probe';
import { createFakeRuntime, type FakeRuntimeFaults } from './runtime';

import type { Composition, ConformanceBinding, SceneElement } from '../../src/binding';

function createComposition(faults: FakeRuntimeFaults): Composition
{
    const journal = new SceneJournal();
    const { builtins, kindOf } = createBuiltins();
    let rootCount = () => 0;
    const { probe, interceptInit } = createFakeProbe(journal, () => rootCount());
    const runtime = createFakeRuntime(journal, { faults, kindOf, interceptInit });

    rootCount = () => runtime.roots.size;
    runtime.api.extend(builtins);

    const element = (name: string) => runtime.tagFor(name) as unknown as SceneElement;

    return {
        api: runtime.api,
        elements: {
            container: element('Container'),
            sprite: element('Sprite'),
            graphics: element('Graphics'),
            text: element('Text'),
        },
        elementFor: element,
        probe,
        appOptions: { width: 64, height: 64 },
        async dispose()
        {
            await Promise.all([...runtime.roots].map((root) => root.unmount()));
        },
    };
}

/**
 * A binding over the fake React renderer and fake scene. With `faults`, it is a deliberately faulty
 * binding for negative controls.
 */
export function createFakeBinding(faults: FakeRuntimeFaults = {}, id = 'fake renderer (React 19, fake scene)'): ConformanceBinding
{
    return {
        id,
        capabilities: ['framework.react-19', 'dom.resize'],
        create: () => createComposition(faults),
    };
}
