import { PIXI8_SCENE_CAPABILITIES } from '../../src/binding';
import { PixiJournal } from '../../src/journal';
import { createBuiltins, createFakeProbe } from './probe';
import { createFakeRuntime, type FakeRuntimeFaults } from './runtime';

import type { Composition, ConformanceBinding, PixiElement } from '../../src/binding';

function createComposition(faults: FakeRuntimeFaults): Composition
{
    const journal = new PixiJournal();
    const { builtins, kindOf } = createBuiltins();
    let rootCount = () => 0;
    const { probe, interceptInit } = createFakeProbe(journal, () => rootCount());
    const runtime = createFakeRuntime(journal, { faults, kindOf, interceptInit });

    rootCount = () => runtime.roots.size;
    runtime.api.extend(builtins);

    const element = (name: string) => runtime.tagFor(name) as unknown as PixiElement;

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
 * A binding over the fake React renderer and fake Pixi backend. With `faults`, it is a deliberately faulty
 * binding for negative controls.
 */
export function createFakeBinding(faults: FakeRuntimeFaults = {}, id = 'fake renderer (React 19, fake Pixi)'): ConformanceBinding
{
    return {
        id,
        capabilities: ['react.19', 'dom.resize', ...PIXI8_SCENE_CAPABILITIES],
        create: () => createComposition(faults),
    };
}
