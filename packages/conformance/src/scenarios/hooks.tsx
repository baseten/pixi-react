import { createContext, useContext, useState } from 'react';
import { expect } from 'vitest';
import { defineScenario } from '../scenario';
import { ErrorBoundary, getByLabel, messageOf } from './helpers';

export const hookScenarios = [
    defineScenario({
        id: 'context-bridge.initial',
        feature: 'context-bridge',
        title: 'a React DOM context value reaches the scene tree',
        expected: 'A component inside `<Application>` reads a context provided by the primary React DOM tree.',
        async run({ api: { Application }, composition, elements: { container: Container }, renderUntil, deferred, probe })
        {
            const Theme = createContext('default');
            const Labelled = () => <Container label={useContext(Theme)} />;
            const ready = deferred<unknown>();

            await renderUntil(
                <Theme.Provider value="from-dom">
                    <Application {...composition.appOptions} onInit={ready.resolve}><Labelled /></Application>
                </Theme.Provider>,
                ready.promise,
            );

            expect(probe.label(probe.children(probe.stage(await ready.promise))[0]), 'bridged value').toBe('from-dom');
        },
    }),
    defineScenario({
        id: 'context-bridge.update',
        feature: 'context-bridge',
        title: 'context updates in the React DOM tree propagate into the scene tree',
        expected: 'Changing the DOM provider value re-renders the scene consumer and updates its node in place.',
        async run({ api: { Application }, composition, elements: { container: Container }, renderUntil, act, deferred, probe })
        {
            const Theme = createContext('default');
            const Labelled = () => <Container label={useContext(Theme)} />;
            // A stable element: only context propagation, not a parent re-render, can update it.
            const consumer = <Labelled />;
            const ready = deferred<unknown>();
            let setTheme!: (value: string) => void;
            const DomTree = () =>
            {
                const [theme, update] = useState('first');

                setTheme = update;

                return (
                    <Theme.Provider value={theme}>
                        <Application {...composition.appOptions} onInit={ready.resolve}>{consumer}</Application>
                    </Theme.Provider>
                );
            };

            await renderUntil(<DomTree />, ready.promise);
            const stage = probe.stage(await ready.promise);
            const node = probe.children(stage)[0];

            expect(probe.label(node), 'initial value').toBe('first');

            await act(() => setTheme('second'));

            expect(probe.children(stage)[0], 'same node').toBe(node);
            expect(probe.label(node), 'updated value').toBe('second');
        },
    }),
    defineScenario({
        id: 'context-bridge.scene-provider-wins',
        feature: 'context-bridge',
        title: 'a provider inside the scene tree overrides the bridged value',
        expected: 'The nearest provider wins, whether it is in the DOM tree or the scene tree.',
        async run({ api: { Application }, composition, elements: { container: Container }, renderUntil, deferred, probe })
        {
            const Theme = createContext('default');
            const Labelled = () => <Container label={useContext(Theme)} />;
            const ready = deferred<unknown>();

            await renderUntil(
                <Theme.Provider value="from-dom">
                    <Application {...composition.appOptions} onInit={ready.resolve}>
                        <Theme.Provider value="from-scene"><Labelled /></Theme.Provider>
                    </Application>
                </Theme.Provider>,
                ready.promise,
            );

            expect(probe.label(probe.children(probe.stage(await ready.promise))[0]), 'nearest value').toBe('from-scene');
        },
    }),
    defineScenario({
        id: 'useApplication.inside',
        feature: 'useApplication',
        title: 'useApplication returns the initialized app inside the Application',
        expected: 'The hook returns the same app `onInit` received, with `isInitialised` true.',
        async run({ api, mountApp })
        {
            let state: { app: unknown; isInitialised: boolean } | undefined;
            const Reader = () =>
            {
                const { app, isInitialised } = api.useApplication();

                state = { app, isInitialised };

                return null;
            };
            const { app } = await mountApp(<Reader />);

            expect(state, 'hook state').toEqual({ app, isInitialised: true });
        },
    }),
    defineScenario({
        id: 'useApplication.outside',
        feature: 'useApplication',
        title: 'useApplication throws outside an Application',
        expected: 'Calling the hook in the React DOM tree throws an error caught by an error boundary.',
        async run({ api, render, captureConsoleErrors })
        {
            captureConsoleErrors();
            const caught: unknown[] = [];
            const Reader = () =>
            {
                api.useApplication();

                return null;
            };

            await render(<ErrorBoundary onError={(error) => caught.push(error)}><Reader /></ErrorBoundary>);

            expect(caught.length, 'caught errors').toBe(1);
            expect(caught[0], 'caught value').toBeInstanceOf(Error);
        },
    }),
    defineScenario({
        id: 'useTick.function',
        feature: 'useTick',
        title: 'a tick callback runs once per manual tick',
        expected: 'After the app initialized, each manual ticker advance calls the callback once with the tick value.',
        async run({ api, mountApp, tick })
        {
            const ticks: unknown[] = [];
            const Ticking = () =>
            {
                api.useTick((value: unknown) => ticks.push(value));

                return null;
            };
            const { app } = await mountApp(<Ticking />);

            await tick(app);
            await tick(app);

            expect(ticks.length, 'tick calls').toBe(2);
            expect(ticks[0], 'tick argument').toBeDefined();
        },
    }),
    defineScenario({
        id: 'useTick.options',
        feature: 'useTick',
        title: 'the options form passes the context as this',
        expected: '`useTick({ callback, context })` calls `callback` with `this === context`.',
        async run({ api, mountApp, tick })
        {
            const context = { name: 'tick-context' };
            const receivers: unknown[] = [];

            function callback(this: unknown)
            {
                receivers.push(this);
            }
            const Ticking = () =>
            {
                api.useTick({ callback, context });

                return null;
            };
            const { app } = await mountApp(<Ticking />);

            await tick(app);

            expect(receivers, 'this values').toEqual([context]);
        },
    }),
    defineScenario({
        id: 'useTick.isEnabled',
        feature: 'useTick',
        title: 'isEnabled pauses and resumes the callback',
        expected: 'With `isEnabled: false` ticks do not call the callback; enabling it again resumes calls.',
        async run({ api, mountApp, tick })
        {
            let calls = 0;
            const callback = () =>
            {
                calls += 1;
            };
            const Ticking = ({ enabled }: { enabled: boolean }) =>
            {
                api.useTick({ callback, isEnabled: enabled });

                return null;
            };
            const mounted = await mountApp(<Ticking enabled={false} />);

            await tick(mounted.app);
            expect(calls, 'calls while disabled').toBe(0);

            await mounted.rerender(<Ticking enabled />);
            await tick(mounted.app);
            expect(calls, 'calls after enabling').toBe(1);
        },
    }),
    defineScenario({
        id: 'useTick.priority',
        feature: 'useTick',
        title: 'higher priority callbacks run first',
        expected: 'Callbacks run in descending priority regardless of mount order.',
        async run({ api, mountApp, tick })
        {
            const order: string[] = [];
            const Ticking = ({ name, priority }: { name: string; priority: number }) =>
            {
                api.useTick({ callback: () => order.push(name), priority });

                return null;
            };
            const { app } = await mountApp(<><Ticking name="low" priority={-10} /><Ticking name="high" priority={10} /></>);

            await tick(app);

            expect(order, 'call order').toEqual(['high', 'low']);
        },
    }),
    defineScenario({
        id: 'useTick.replace-callback',
        feature: 'useTick',
        title: 'replacing the callback does not leak listeners',
        expected: 'After several rerenders with new inline callbacks, only the latest runs and the listener count is stable.',
        async run({ api, mountApp, tick, probe })
        {
            const calls: number[] = [];
            const Ticking = ({ version }: { version: number }) =>
            {
                api.useTick(() => calls.push(version));

                return null;
            };
            const mounted = await mountApp(<Ticking version={1} />);
            const listeners = probe.tickerListenerCount(mounted.app);

            await mounted.rerender(<Ticking version={2} />);
            await mounted.rerender(<Ticking version={3} />);
            await tick(mounted.app);

            expect(calls, 'calls').toEqual([3]);
            expect(probe.tickerListenerCount(mounted.app), 'ticker listeners').toBe(listeners);
        },
    }),
    defineScenario({
        id: 'useTick.unmount-cleanup',
        feature: 'useTick',
        title: 'unmounting the component removes its ticker listener',
        expected: 'After the ticking component unmounts, ticks no longer call it and the listener count is restored.',
        async run({ api, mountApp, tick, probe })
        {
            let calls = 0;
            const Ticking = () =>
            {
                api.useTick(() =>
                {
                    calls += 1;
                });

                return null;
            };
            const mounted = await mountApp(null);
            const listeners = probe.tickerListenerCount(mounted.app);

            await mounted.rerender(<Ticking />);
            await tick(mounted.app);
            await mounted.rerender(null);
            await tick(mounted.app);

            expect(calls, 'calls').toBe(1);
            expect(probe.tickerListenerCount(mounted.app), 'ticker listeners').toBe(listeners);
        },
    }),
    defineScenario({
        id: 'useTick.outside',
        feature: 'useTick',
        title: 'useTick throws outside an Application',
        expected: 'Calling the hook in the React DOM tree throws an error caught by an error boundary.',
        async run({ api, render, captureConsoleErrors })
        {
            captureConsoleErrors();
            const caught: unknown[] = [];
            const Ticking = () =>
            {
                api.useTick(() => undefined);

                return null;
            };

            await render(<ErrorBoundary onError={(error) => caught.push(error)}><Ticking /></ErrorBoundary>);

            expect(caught.map(messageOf).length, 'caught errors').toBe(1);
        },
    }),
    defineScenario({
        id: 'resources.texture-borrowed',
        feature: 'resources',
        title: 'an externally supplied texture survives node removal and app unmount',
        expected: 'Removing a sprite and unmounting its app destroy the sprite but never the borrowed texture.',
        async run({ elements: { sprite: Sprite }, mountApp, unmount, probe, journal })
        {
            const texture = probe.createTexture();
            const mounted = await mountApp(<Sprite label="s" texture={texture} />);
            const sprite = getByLabel(probe, mounted.stage, 's');

            expect(probe.get(sprite, 'texture'), 'sprite texture').toBe(texture);

            await mounted.rerender(null);
            expect(journal.destroyCount(sprite), 'sprite destroy count').toBe(1);
            expect(probe.isResourceDestroyed(texture), 'texture destroyed after removal').toBe(false);

            await mounted.rerender(<Sprite label="again" texture={texture} />);
            await unmount();
            expect(probe.isResourceDestroyed(texture), 'texture destroyed after unmount').toBe(false);
        },
    }),
    defineScenario({
        id: 'resources.graphics-context-borrowed',
        feature: 'resources',
        title: 'an externally supplied graphics context survives node removal',
        expected: 'Removing a graphics node destroys the node but not the borrowed graphics context.',
        async run({ elements: { graphics: Graphics }, mountApp, probe, journal })
        {
            const context = probe.createGraphicsContext();
            const mounted = await mountApp(<Graphics label="g" context={context} />);
            const node = getByLabel(probe, mounted.stage, 'g');

            await mounted.rerender(null);

            expect(journal.destroyCount(node), 'graphics destroy count').toBe(1);
            expect(probe.isResourceDestroyed(context), 'context destroyed').toBe(false);
        },
    }),
    defineScenario({
        id: 'resources.destroy-options-transfer',
        feature: 'resources',
        title: 'explicit destroy options transfer texture ownership to the app teardown',
        expected: 'With `destroyOptions={{ children: true, texture: true, textureSource: true }}` unmount destroys the texture.',
        async run({ elements: { sprite: Sprite }, mountApp, unmount, probe })
        {
            const texture = probe.createTexture();

            await mountApp(<Sprite label="s" texture={texture} />, {
                destroyOptions: { children: true, texture: true, textureSource: true },
            });
            await unmount();

            expect(probe.isResourceDestroyed(texture), 'texture destroyed').toBe(true);
        },
    }),
];
