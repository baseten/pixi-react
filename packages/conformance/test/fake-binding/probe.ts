import {
    dispatchFakeEvent,
    type FakeApplication,
    FakeContainer,
    FakeGraphics,
    FakeResource,
    FakeSprite,
    FakeText,
} from '../../src/fake-pixi';

import type { Constructor, InitAttempt, InitGate, PixiProbe } from '../../src/binding';
import type { PixiJournal } from '../../src/journal';

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

/** Fresh built-in classes per composition, so constructions are attributed to this composition. */
export function createBuiltins()
{
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

    return { builtins, kindOf: (ctor: Constructor) => kinds.get(ctor) ?? 'custom' };
}

/**
 * The scene probe over the fake backend, shared by the fake bindings. Initializations are intercepted so a
 * scenario can hold or fail the next one.
 */
export function createFakeProbe(journal: PixiJournal, rootCount: () => number)
{
    const pendingInits: PendingInit[] = [];
    const virtualTime = new WeakMap<object, number>();

    async function interceptInit(init: () => Promise<void>): Promise<void>
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
    }

    const probe: PixiProbe = {
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
        rootCount,
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

    return { probe, interceptInit };
}
