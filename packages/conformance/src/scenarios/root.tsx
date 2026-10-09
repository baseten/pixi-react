import { type ReactNode, startTransition, useState } from 'react';
import { expect } from 'vitest';
import { defineScenario } from '../scenario';
import { getByLabel, messageOf, reportedErrors } from './helpers';

import type { ScenarioContext } from '../context';

/**
 * Two state updates from outside React (no event handler, no act) must be batched into one render that is
 * scheduled rather than rendered synchronously. A legacy root renders each update synchronously. `sibling` is
 * mounted after the counter in the same Application, for scenarios that go on to check more root semantics; the
 * application's stage is returned.
 */
async function assertAutomaticBatching(ctx: ScenarioContext, sibling: ReactNode = null): Promise<unknown>
{
    const { elements: { container: Container }, mountApp, probe, waitFor } = ctx;
    let renders = 0;
    let updateBoth!: () => void;
    const Counter = () =>
    {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);

        renders += 1;
        updateBoth = () =>
        {
            setA(1);
            setB(1);
        };

        return <Container label={`${a}-${b}`} />;
    };
    const { stage } = await mountApp(<><Counter />{sibling}</>);
    const before = renders;
    let synchronousRenders = -1;

    await ctx.outsideAct(async () =>
    {
        updateBoth();
        synchronousRenders = renders - before;
        await waitFor(() => probe.label(probe.children(stage)[0]) === '1-1');
    });

    expect(synchronousRenders, 'renders before yielding').toBe(0);
    expect(renders - before, 'renders for two updates').toBe(1);
    expect(getByLabel(probe, stage, '1-1'), 'committed node').toBeDefined();

    return stage;
}

export const rootScenarios = [
    defineScenario({
        id: 'root.concurrency.automatic-batching',
        feature: 'root.concurrency',
        title: 'updates from outside React are batched and scheduled',
        expected: 'Two updates from a non-React callback produce one scheduled render (concurrent root semantics).',
        async run(ctx)
        {
            await assertAutomaticBatching(ctx);
        },
    }),
    defineScenario({
        id: 'root.concurrency.react-18-concurrent-root',
        feature: 'root.concurrency',
        requires: ['react.18'],
        title: 'the React 18 binding creates a ConcurrentRoot',
        expected: 'Automatic batching and non-synchronous transitions hold under React 18, proving a ConcurrentRoot.',
        async run(ctx)
        {
            const { elements: { container: Container }, probe, waitFor } = ctx;
            let setValue!: (value: string) => void;
            const Transitioning = () =>
            {
                const [value, update] = useState('before');

                setValue = update;

                return <Container label={value} />;
            };
            // One Application: the batching check, then a transition in a sibling of the same scene root.
            const stage = await assertAutomaticBatching(ctx, <Transitioning />);
            const transitioning = () => probe.label(probe.children(stage)[1]);
            let synchronousLabel: string | undefined;

            await ctx.outsideAct(async () =>
            {
                startTransition(() => setValue('after'));
                synchronousLabel = transitioning();
                await waitFor(() => transitioning() === 'after');
            });

            expect(synchronousLabel, 'label right after a transition update').toBe('before');
        },
    }),
    defineScenario({
        id: 'root.errors.render-error-reported',
        feature: 'root.errors',
        title: 'a render error in the scene tree is reported and does not unmount the DOM tree',
        expected: 'The error reaches the root error channel (console by default); the DOM host keeps its canvas.',
        async run(ctx)
        {
            const Failing = () =>
            {
                throw new Error('conformance: render failure');
            };
            const mounted = await ctx.mountApp(null);
            const errors = await reportedErrors(ctx, () => mounted.rerender(<Failing />));

            expect(errors.some((message) => (/conformance: render failure/).test(message)), 'error reported').toBe(true);
            expect(ctx.host.querySelector('canvas'), 'DOM canvas').toBeInstanceOf(HTMLCanvasElement);
        },
    }),
    defineScenario({
        id: 'root.errors.react-18-recoverable-error',
        feature: 'root.errors',
        requires: ['react.18'],
        title: 'a recovered concurrent render error is routed to onRecoverableError',
        expected: 'A component that throws once during a concurrent render is retried; the error goes to `onRecoverableError`.',
        async run({ api, elements: { container: Container }, composition, createSizedElement, act, actUntil, deferred, waitFor, probe, outsideAct })
        {
            const recovered: unknown[] = [];
            const ready = deferred<unknown>();
            const root = api.createRoot(createSizedElement(64, 64), {
                onInit: ready.resolve,
                onRecoverableError: (error: unknown) => recovered.push(error),
            });
            let failures = 0;
            let show!: (value: boolean) => void;
            const FlakyOnce = () =>
            {
                if (failures === 0)
                {
                    failures += 1;
                    throw new Error('conformance: recoverable');
                }

                return <Container label="recovered" />;
            };
            const Toggle = () =>
            {
                const [visible, update] = useState(false);

                show = update;

                return visible ? <FlakyOnce /> : null;
            };
            let rendered!: Promise<unknown>;

            // act flushes the scene commit only when its scope exits: wait for onInit inside it, the render after it.
            await act(async () =>
            {
                rendered = root.render(<Toggle />, { ...composition.appOptions });
                await ready.promise;
            });

            const app = await rendered;

            await outsideAct(async () =>
            {
                startTransition(() => show(true));
                await waitFor(() => probe.children(probe.stage(app)).length === 1);
            });
            await actUntil(Promise.resolve());

            expect(recovered.map(messageOf), 'recoverable errors').toEqual(
                [expect.stringMatching(/conformance: recoverable|recover/)],
            );
        },
    }),
    defineScenario({
        id: 'root.errors.react-18-modern-callbacks-rejected',
        feature: 'root.errors',
        requires: ['react.18'],
        title: 'React 19-only root error callbacks are rejected on React 18',
        expected: '`onCaughtError` / `onUncaughtError` passed to a React 18 root throw an explicit unsupported-option error.',
        async run({ api, createSizedElement })
        {
            expect(() => api.createRoot(createSizedElement(64, 64), { onCaughtError: () => undefined }), 'onCaughtError')
                .toThrow(/onCaughtError/);
            expect(() => api.createRoot(createSizedElement(64, 64), { onUncaughtError: () => undefined }), 'onUncaughtError')
                .toThrow(/onUncaughtError/);
        },
    }),
];
