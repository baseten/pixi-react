import {
    dispatchFakeEvent,
    type FakeApplication,
    FakeContainer,
    FakeGraphics,
    FakeResource,
    FakeSprite,
    FakeText,
} from '../../src/fake-scene';
import { SceneJournal } from '../../src/journal';
import { createFakeRuntime, type FakeRuntimeFaults } from './runtime';

import type {
    Composition,
    ConformanceBinding,
    Constructor,
    InitAttempt,
    InitGate,
    SceneElement,
    SceneProbe,
} from '../../src/binding';

interface PendingInit
{
    gate?: Promise<void>;
    error?: Error;
    started(): void;
    settled(): void;
}

function attemptHandle()
{
    let started!: () => void;
    let settled!: () => void;
    const attempt: InitAttempt = {
        started: new Promise<void>((resolve) =>
        {
            started = resolve;
        }),
        settled: new Promise<void>((resolve) =>
        {
            settled = resolve;
        }),
    };

    return { attempt, started, settled };
}

function createComposition(faults: FakeRuntimeFaults): Composition
{
    const journal = new SceneJournal();
    const pendingInits: PendingInit[] = [];
    const virtualTime = new WeakMap<object, number>();
    // Fresh built-in classes per composition, so constructions are attributed to this composition.
    const builtins = {
        Container: class extends FakeContainer {},
        Sprite: class extends FakeSprite {},
        Graphics: class extends FakeGraphics {},
        Text: class extends FakeText {},
    };
    const kinds = new Map<Constructor, string>([
        [builtins.Container, 'container'],
        [builtins.Sprite, 'sprite'],
        [builtins.Graphics, 'graphics'],
        [builtins.Text, 'text'],
    ]);
    const runtime = createFakeRuntime(journal, {
        faults,
        kindOf: (ctor) => kinds.get(ctor) ?? 'custom',
        async interceptInit(init)
        {
            const pending = pendingInits.shift();

            pending?.started();

            try
            {
                if (pending?.gate)
                {
                    await pending.gate;
                }

                if (pending?.error)
                {
                    throw pending.error;
                }

                await init();
            }
            finally
            {
                pending?.settled();
            }
        },
    });

    runtime.api.extend(builtins);

    const element = (name: string) => runtime.tagFor(name) as unknown as SceneElement;

    const probe: SceneProbe = {
        journal,
        stage: (app) => (app as FakeApplication).stage,
        children: (node) => [...((node as FakeContainer | null)?.children ?? [])],
        parent: (node) => (node as FakeContainer).parent,
        get: (node, path) => path.split('.').reduce<any>((value, key) => value?.[key], node),
        isDestroyed: (node) => (node as FakeContainer).destroyed,
        label: (node) => (node as FakeContainer).label,
        dispatch: (_app, node, type) => dispatchFakeEvent(node as object, type),
        advance(app, ms)
        {
            const ticker = (app as FakeApplication).ticker;
            const now = (virtualTime.get(ticker) ?? 1000) + ms;

            virtualTime.set(ticker, now);
            ticker.update(now);
        },
        tickerListenerCount: (app) => (app as FakeApplication).ticker.count,
        screen: (app) => ({ ...(app as FakeApplication).screen }),
        isAppDestroyed: (app) => (app as FakeApplication).destroyed,
        rootCount: () => runtime.roots.size,
        createTexture: () => new FakeResource('texture'),
        createGraphicsContext: () => new FakeResource('graphics-context'),
        isResourceDestroyed: (resource) => (resource as FakeResource).destroyed,
        customClass({ requiredArgument = false } = {})
        {
            return class FakeCustom extends FakeContainer
            {
                constructor(...args: unknown[])
                {
                    if (requiredArgument && args.length === 0)
                    {
                        throw new Error('FakeCustom requires a constructor argument');
                    }

                    super(...args);
                }
            };
        },
        failNextInit(error): InitAttempt
        {
            const { attempt, started, settled } = attemptHandle();

            pendingInits.push({ error, started, settled });

            return attempt;
        },
        holdNextInit(): InitGate
        {
            const { attempt, started, settled } = attemptHandle();
            let release!: () => void;
            const gate = new Promise<void>((resolve) =>
            {
                release = resolve;
            });

            pendingInits.push({ gate, started, settled });

            return { ...attempt, release };
        },
    };

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
