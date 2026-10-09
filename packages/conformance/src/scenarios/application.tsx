import { createRef, type ReactNode } from 'react';
import { expect } from 'vitest';
import { defineScenario } from '../scenario';
import { childLabels, getByLabel, reportedErrors } from './helpers';

import type { RootLike } from '../binding';
import type { ScenarioContext } from '../context';

/**
 * Renders `children` through `createRoot(target).render` inside act and returns the app once the commit is
 * flushed. `Root.render` may resolve only after its commit, and act flushes a commit only when its scope
 * exits, so the scope waits for `onInit` and the render promise is awaited after the scope.
 */
async function renderWithCreateRoot(ctx: ScenarioContext, root: RootLike, children: ReactNode, ready: Promise<unknown>)
{
    let rendered!: Promise<unknown>;

    await ctx.act(async () =>
    {
        rendered = root.render(children, { ...ctx.composition.appOptions });
        await ready;
    });

    return rendered;
}

/** Renders an Application whose initialization is held, unmounts it, then lets initialization finish. */
async function unmountBeforeInit(ctx: ScenarioContext)
{
    const { api: { Application }, composition, elements: { sprite: Sprite }, probe } = ctx;
    const gate = probe.holdNextInit();
    const onInitCalls: unknown[] = [];

    await ctx.render(
        <Application {...composition.appOptions} onInit={(app: unknown) => onInitCalls.push(app)}>
            <Sprite label="late" />
        </Application>,
    );
    await gate.started;

    const constructedAtUnmount = ctx.journal.of('construct').length;

    await ctx.unmount();
    gate.release();
    await ctx.actUntil(gate.settled);
    await ctx.actUntil(Promise.resolve());

    const [app] = ctx.journal.appInits();

    return { app, onInitCalls, constructedAtUnmount };
}

export const applicationScenarios = [
    defineScenario({
        id: 'Application.init.success',
        feature: 'Application.init',
        title: 'initializes once and calls onInit once with the app',
        expected: 'One initialization; `onInit` receives the initialized app; `useApplication` reports it initialised.',
        async run({ api, mountApp, journal })
        {
            const onInitCalls: unknown[] = [];
            const seen: Array<{ app: unknown; isInitialised: boolean }> = [];
            const Probe = () =>
            {
                const { app, isInitialised } = api.useApplication();

                seen.push({ app, isInitialised });

                return null;
            };
            const { app } = await mountApp(<Probe />, { onInit: (value: unknown) => onInitCalls.push(value) });

            expect(journal.appInits(), 'initializations').toEqual([app]);
            expect(onInitCalls, 'onInit calls').toEqual([app]);
            expect(seen.at(-1), 'latest useApplication state').toEqual({ app, isInitialised: true });
        },
    }),
    defineScenario({
        id: 'Application.init.children-after-init',
        feature: 'Application.init',
        title: 'onInit runs before the first child node is constructed',
        expected: 'No scene node is constructed before initialization has settled and `onInit` has run.',
        async run({ elements: { sprite: Sprite }, mountApp, journal })
        {
            const order: string[] = [];
            const Recorder = () =>
            {
                order.push(`render:${journal.of('app.init.settled').length}`);

                return <Sprite label="child" />;
            };

            await mountApp(<Recorder />, { onInit: () => order.push('onInit') });

            const firstConstruct = journal.indexOf((entry) => entry.op === 'construct');
            const settled = journal.indexOf((entry) => entry.op === 'app.init.settled');

            expect(settled, 'init settled').toBeGreaterThanOrEqual(0);
            expect(firstConstruct, 'first construction after init settled').toBeGreaterThan(settled);
            expect(order.indexOf('onInit'), 'onInit before first child render').toBeLessThan(
                order.findIndex((entry) => entry.startsWith('render:')),
            );
        },
    }),
    defineScenario({
        id: 'Application.init.failure-no-unhandled-rejection',
        feature: 'Application.init',
        title: 'an initialization failure never becomes an unhandled rejection',
        expected: 'When the scene initialization rejects, no unhandled promise rejection escapes the Application.',
        async run(ctx)
        {
            const { api: { Application }, composition, probe } = ctx;
            const rejections = ctx.captureUnhandledRejections();
            const attempt = probe.failNextInit(new Error('conformance: init failure'));

            await ctx.render(<Application {...composition.appOptions} />);
            await ctx.actUntil(attempt.settled);
            await ctx.yieldTask();

            expect(rejections.map(String), 'unhandled rejections').toEqual([]);
        },
    }),
    defineScenario({
        id: 'Application.init.failure-no-children',
        feature: 'Application.init',
        title: 'children are never committed to an application that failed to initialize',
        expected: 'After an initialization failure no child node is constructed.',
        async run(ctx)
        {
            const { api: { Application }, composition, elements: { sprite: Sprite }, probe, journal } = ctx;

            ctx.captureUnhandledRejections();
            const attempt = probe.failNextInit(new Error('conformance: init failure'));

            await ctx.render(<Application {...composition.appOptions}><Sprite label="never" /></Application>);
            await ctx.actUntil(attempt.settled);

            expect(journal.constructed(), 'constructed nodes').toEqual([]);
        },
    }),
    defineScenario({
        id: 'Application.init.failure-unmount',
        feature: 'Application.init',
        title: 'unmounting after an initialization failure releases the root',
        expected: 'Unmounting a failed Application leaves no root behind and raises no error.',
        async run(ctx)
        {
            const { api: { Application }, composition, probe } = ctx;

            ctx.captureUnhandledRejections();
            const roots = probe.rootCount();
            const attempt = probe.failNextInit(new Error('conformance: init failure'));

            await ctx.render(<Application {...composition.appOptions} />);
            await ctx.actUntil(attempt.settled);
            await ctx.unmount();
            await ctx.actUntil(Promise.resolve());

            expect(probe.rootCount(), 'roots after unmount').toBe(roots);
        },
    }),
    defineScenario({
        id: 'Application.init.failure-isolated',
        feature: 'Application.init',
        title: 'a failed and unmounted Application does not disturb the next one',
        expected: 'After a failed Application unmounts, a new Application initializes and mounts without any error.',
        async run(ctx)
        {
            const { api: { Application }, composition, elements: { sprite: Sprite }, probe } = ctx;

            ctx.captureUnhandledRejections();
            const attempt = probe.failNextInit(new Error('conformance: init failure'));

            await ctx.render(<Application key="failed" {...composition.appOptions} />);
            await ctx.actUntil(attempt.settled);
            await ctx.unmount();

            let stage: unknown;
            const errors = await reportedErrors(ctx, async () =>
            {
                ({ stage } = await ctx.mountApp(<Sprite label="next" />));
            });

            expect(errors.join(' | '), 'errors while mounting the next Application').toBe('');
            expect(childLabels(probe, stage), 'next stage').toEqual(['next']);
        },
    }),
    defineScenario({
        id: 'Application.init.unmount-before-init.destroys-app',
        feature: 'Application.init',
        title: 'unmounting before initialization settles destroys the app exactly once',
        expected: 'Once the pending initialization settles the app is destroyed exactly once and its root is released.',
        async run(ctx)
        {
            const roots = ctx.probe.rootCount();
            const { app } = await unmountBeforeInit(ctx);

            expect(app, 'an initialization was attempted').toBeDefined();
            expect(ctx.journal.appDestroyCount(app), 'app destroy count').toBe(1);
            expect(ctx.probe.rootCount(), 'roots after settling').toBe(roots);
        },
    }),
    defineScenario({
        id: 'Application.init.unmount-before-init.no-late-commit',
        feature: 'Application.init',
        title: 'children are not committed after the Application unmounted',
        expected: 'No child is constructed after unmount, or every late node is destroyed before settling ends.',
        async run(ctx)
        {
            const { constructedAtUnmount } = await unmountBeforeInit(ctx);
            const late = ctx.journal.of('construct').slice(constructedAtUnmount).map((entry) => entry.node);
            const leaked = late.filter((node) => ctx.journal.destroyCount(node) === 0);

            expect(leaked.map((node) => ctx.probe.label(node)), 'late nodes left alive').toEqual([]);
        },
    }),
    defineScenario({
        id: 'Application.init.unmount-before-init.no-oninit',
        feature: 'Application.init',
        title: 'onInit is not called after the Application unmounted',
        expected: '`onInit` is never called for an Application that unmounted before initialization settled.',
        async run(ctx)
        {
            const { onInitCalls } = await unmountBeforeInit(ctx);

            expect(onInitCalls.length, 'onInit calls after unmount').toBe(0);
        },
    }),
    defineScenario({
        id: 'Application.lifecycle.remount',
        feature: 'Application.lifecycle',
        title: 'repeated mount and unmount creates a fresh app each time and releases the old one',
        expected: 'Each mount initializes a new app; each unmount destroys its app once and releases its root.',
        async run({ elements: { sprite: Sprite }, mountApp, unmount, journal, probe })
        {
            const roots = probe.rootCount();
            const first = await mountApp(<Sprite label="a" />);

            await unmount();
            const second = await mountApp(<Sprite label="a" />);

            expect(second.app, 'second app').not.toBe(first.app);
            expect(journal.appDestroyCount(first.app as object), 'first app destroy count').toBe(1);
            expect(childLabels(probe, second.stage), 'second stage').toEqual(['a']);

            await unmount();

            expect(journal.appDestroyCount(second.app as object), 'second app destroy count').toBe(1);
            expect(probe.rootCount(), 'roots after unmount').toBe(roots);
        },
    }),
    defineScenario({
        id: 'Application.lifecycle.strict-mode',
        feature: 'Application.lifecycle',
        title: 'StrictMode mounts one app with one copy of its children and tears it down once',
        expected: 'Under StrictMode: one initialization, one `onInit`, each child once, one destruction on unmount.',
        async run({ elements: { sprite: Sprite }, mountApp, unmount, journal, probe })
        {
            const roots = probe.rootCount();
            const onInitCalls: unknown[] = [];
            const { app, stage } = await mountApp(
                <Sprite label="a" />,
                { onInit: (value: unknown) => onInitCalls.push(value) },
                { strict: true },
            );

            expect(journal.appInits(), 'initializations').toEqual([app]);
            expect(onInitCalls, 'onInit calls').toEqual([app]);
            expect(childLabels(probe, stage), 'stage children').toEqual(['a']);

            await unmount();

            expect(journal.appDestroyCount(app as object), 'app destroy count').toBe(1);
            expect(probe.rootCount(), 'roots after unmount').toBe(roots);
        },
    }),
    defineScenario({
        id: 'Application.lifecycle.strict-mode-children-after-init',
        feature: 'Application.lifecycle',
        title: 'under StrictMode no child is constructed before initialization settles',
        expected: 'The StrictMode effect replay does not commit children to an uninitialized app.',
        async run({ elements: { sprite: Sprite }, mountApp, journal })
        {
            await mountApp(<Sprite label="a" />, {}, { strict: true });

            const firstConstruct = journal.indexOf((entry) => entry.op === 'construct');
            const settled = journal.indexOf((entry) => entry.op === 'app.init.settled');

            expect(firstConstruct, 'first construction after init settled').toBeGreaterThan(settled);
        },
    }),
    defineScenario({
        id: 'Application.ref',
        feature: 'Application.ref',
        title: 'the Application ref exposes the app and its canvas',
        expected: '`getApplication()` returns the initialized app; `getCanvas()` returns the canvas in the DOM.',
        async run({ mountApp, host })
        {
            const ref = createRef<{ getApplication(): unknown; getCanvas(): unknown }>();
            const { app } = await mountApp(null, { ref });

            expect(ref.current?.getApplication(), 'getApplication').toBe(app);
            const canvas = ref.current?.getCanvas();

            expect(canvas, 'getCanvas').toBeInstanceOf(HTMLCanvasElement);
            expect(host.contains(canvas as Node), 'canvas is in the host').toBe(true);
        },
    }),
    defineScenario({
        id: 'Application.resizeTo.element',
        feature: 'Application.resizeTo',
        requires: ['dom.resize'],
        title: 'resizeTo an element sizes the screen to it',
        expected: 'With `resizeTo={element}` the screen matches the element size after initialization.',
        async run({ mountApp, createSizedElement, probe })
        {
            const element = createSizedElement(120, 80);
            const { app } = await mountApp(null, { resizeTo: element });

            expect(probe.screen(app), 'screen').toEqual({ width: 120, height: 80 });
        },
    }),
    defineScenario({
        id: 'Application.resizeTo.ref',
        feature: 'Application.resizeTo',
        requires: ['dom.resize'],
        title: 'resizeTo accepts a ref object',
        expected: 'With `resizeTo={ref}` the screen matches `ref.current`.',
        async run({ mountApp, createSizedElement, probe })
        {
            const ref = { current: createSizedElement(90, 70) };
            const { app } = await mountApp(null, { resizeTo: ref });

            expect(probe.screen(app), 'screen').toEqual({ width: 90, height: 70 });
        },
    }),
    defineScenario({
        id: 'Application.resizeTo.change',
        feature: 'Application.resizeTo',
        requires: ['dom.resize'],
        title: 'changing resizeTo resizes to the new target',
        expected: 'Switching `resizeTo` to another element resizes the screen to that element.',
        async run({ mountApp, createSizedElement, probe })
        {
            const first = createSizedElement(120, 80);
            const second = createSizedElement(50, 40);
            const mounted = await mountApp(null, { resizeTo: first });

            await mounted.rerender(null, { resizeTo: second });

            expect(probe.screen(mounted.app), 'screen').toEqual({ width: 50, height: 40 });
        },
    }),
    defineScenario({
        id: 'Application.destroyOptions.forwarded',
        feature: 'Application.destroyOptions',
        title: 'destroy options are forwarded to the app on unmount',
        expected: 'The app is destroyed once with `rendererDestroyOptions` and `destroyOptions`, unchanged.',
        async run({ mountApp, unmount, journal })
        {
            const destroyOptions = { children: true };
            const rendererDestroyOptions = { removeView: false };
            const { app } = await mountApp(null, { destroyOptions, rendererDestroyOptions });

            await unmount();

            expect(journal.of('app.destroy').filter((entry) => entry.app === app).map((entry) => entry.args), 'destroy args')
                .toEqual([[rendererDestroyOptions, destroyOptions]]);
        },
    }),
    defineScenario({
        id: 'Application.extensions.registers',
        feature: 'Application.extensions',
        requires: ['scene.globals'],
        title: 'extensions passed to Application are registered',
        expected: 'An extension in `extensions` is active once the Application has mounted.',
        async run({ mountApp, probe })
        {
            const extension = probe.globals!.createExtension('a');

            await mountApp(null, { extensions: [extension] });

            expect(probe.globals!.isExtensionActive(extension), 'extension active').toBe(true);
        },
    }),
    defineScenario({
        id: 'Application.extensions.swap',
        feature: 'Application.extensions',
        requires: ['scene.globals'],
        title: 'replacing the extensions list removes the old one and adds the new one',
        expected: 'Changing `extensions` from [A] to [B] removes A and registers B.',
        async run({ mountApp, probe })
        {
            const first = probe.globals!.createExtension('first');
            const second = probe.globals!.createExtension('second');
            const mounted = await mountApp(null, { extensions: [first] });

            await mounted.rerender(null, { extensions: [second] });

            expect(probe.globals!.isExtensionActive(first), 'first extension active').toBe(false);
            expect(probe.globals!.isExtensionActive(second), 'second extension active').toBe(true);
        },
    }),
    defineScenario({
        id: 'Application.extensions.kept-after-unmount',
        feature: 'Application.extensions',
        kind: 'parity',
        requires: ['scene.globals'],
        title: 'extensions stay registered after the Application unmounts',
        expected: 'Upstream never removes extensions on unmount: they stay in the global registry (D4).',
        async run({ mountApp, unmount, probe })
        {
            const extension = probe.globals!.createExtension('kept');

            await mountApp(null, { extensions: [extension] });
            await unmount();

            expect(probe.globals!.isExtensionActive(extension), 'extension active after unmount').toBe(true);
        },
    }),
    defineScenario({
        id: 'Application.defaultTextStyle.applies',
        feature: 'Application.defaultTextStyle',
        requires: ['scene.globals'],
        title: 'defaultTextStyle sets the global default used by new text',
        expected: 'Text created after the Application mounted inherits the default font size.',
        async run({ elements: { text: Text }, mountApp, probe })
        {
            const { stage } = await mountApp(<Text label="t" text="t" />, { defaultTextStyle: { fontSize: 37 } });

            expect(probe.globals!.defaultTextStyle().fontSize, 'global default font size').toBe(37);
            expect(probe.get(getByLabel(probe, stage, 't'), 'style.fontSize'), 'text font size').toBe(37);
        },
    }),
    defineScenario({
        id: 'Application.defaultTextStyle.kept-after-unmount',
        feature: 'Application.defaultTextStyle',
        kind: 'parity',
        requires: ['scene.globals'],
        title: 'the global default text style is not restored on unmount',
        expected: 'Upstream leaves its default text style in place after unmount (D4 keeps this in the facade).',
        async run({ mountApp, unmount, probe })
        {
            await mountApp(null, { defaultTextStyle: { fontSize: 38 } });
            await unmount();

            expect(probe.globals!.defaultTextStyle().fontSize, 'global default after unmount').toBe(38);
        },
    }),
    defineScenario({
        id: 'Application.defaultTextStyle.removed-restores-load-time',
        feature: 'Application.defaultTextStyle',
        kind: 'parity',
        requires: ['scene.globals'],
        title: 'removing defaultTextStyle restores the module-load default',
        expected: 'Upstream restores the default captured when the module loaded, not the value before this app.',
        async run({ mountApp, probe })
        {
            const before = probe.globals!.defaultTextStyle().fontSize;
            const mounted = await mountApp(null, { defaultTextStyle: { fontSize: 39 } });

            await mounted.rerender(null, {});

            expect(probe.globals!.defaultTextStyle().fontSize, 'global default after removal').toBe(before);
        },
    }),
    defineScenario({
        id: 'createRoot.render',
        feature: 'createRoot',
        title: 'createRoot renders into a new canvas inside an element',
        expected: '`render` resolves with the initialized app; the target gets a canvas; children reach the stage.',
        async run(ctx)
        {
            const { api, elements: { container: Container }, createSizedElement, deferred, probe } = ctx;
            const target = createSizedElement(64, 64);
            const ready = deferred<unknown>();
            const root = api.createRoot(target, { onInit: ready.resolve });
            const app = await renderWithCreateRoot(ctx, root, <Container label="x" />, ready.promise);

            expect(app, 'render resolves with the initialized app').toBe(await ready.promise);
            expect(target.querySelector('canvas'), 'canvas in target').toBeInstanceOf(HTMLCanvasElement);
            expect(childLabels(probe, probe.stage(app)), 'stage children').toEqual(['x']);
        },
    }),
    defineScenario({
        id: 'createRoot.render-resolves-after-commit',
        feature: 'createRoot',
        title: 'Root.render resolves after its children are committed',
        expected: 'Without `act`, awaiting `render` is enough for the children to be in the scene.',
        async run({ api, elements: { container: Container }, composition, createSizedElement, probe, outsideAct, waitFor })
        {
            const root = api.createRoot(createSizedElement(64, 64));
            const labels = await outsideAct(async () =>
            {
                const app = await root.render(<Container label="x" />, { ...composition.appOptions });
                const atResolution = childLabels(probe, probe.stage(app));

                // Let a late commit finish before teardown so it cannot leak into cleanup.
                await waitFor(() => probe.children(probe.stage(app)).length > 0);

                return atResolution;
            });

            expect(labels, 'stage children when render resolved').toEqual(['x']);
        },
    }),
    defineScenario({
        id: 'createRoot.same-canvas',
        feature: 'createRoot',
        title: 'createRoot on the same canvas returns the same root',
        expected: 'A second `createRoot` for one canvas returns the existing root instead of a new one.',
        async run({ api })
        {
            const canvas = document.createElement('canvas');

            expect(api.createRoot(canvas), 'second root').toBe(api.createRoot(canvas));
        },
    }),
    defineScenario({
        id: 'createRoot.same-element',
        feature: 'createRoot',
        title: 'createRoot on the same element returns the same root',
        expected: 'A second `createRoot` for one HTMLElement target returns the existing root.',
        async run({ api, createSizedElement })
        {
            const target = createSizedElement(64, 64);

            expect(api.createRoot(target), 'second root').toBe(api.createRoot(target));
        },
    }),
    defineScenario({
        id: 'createRoot.unmount',
        feature: 'createRoot',
        title: 'a root created with createRoot can be unmounted',
        expected: '`root.unmount()` destroys the app once and releases the root.',
        async run(ctx)
        {
            const { api, elements: { container: Container }, createSizedElement, deferred, act, journal, probe } = ctx;
            const roots = probe.rootCount();
            const ready = deferred<unknown>();
            const root = api.createRoot(createSizedElement(64, 64), { onInit: ready.resolve });
            const app = await renderWithCreateRoot(ctx, root, <Container label="x" />, ready.promise);

            expect(typeof root.unmount, 'root.unmount').toBe('function');

            await act(() => root.unmount!());

            expect(journal.appDestroyCount(app as object), 'app destroy count').toBe(1);
            expect(probe.rootCount(), 'roots after unmount').toBe(roots);
        },
    }),
    defineScenario({
        id: 'multi-root.independent',
        feature: 'multi-root',
        title: 'two Applications keep independent scenes and lifecycles',
        expected: 'Each Application has its own app and stage; unmounting one leaves the other untouched.',
        async run({ api: { Application }, composition, elements: { sprite: Sprite }, renderUntil, render, deferred, probe, journal })
        {
            const first = deferred<unknown>();
            const second = deferred<unknown>();
            const tree = (both: boolean) => (
                <>
                    {both && (
                        <Application key="first" {...composition.appOptions} onInit={first.resolve}>
                            <Sprite label="one" />
                        </Application>
                    )}
                    <Application key="second" {...composition.appOptions} onInit={second.resolve}>
                        <Sprite label="two" />
                    </Application>
                </>
            );

            await renderUntil(tree(true), Promise.all([first.promise, second.promise]));
            const [appOne, appTwo] = [await first.promise, await second.promise];

            expect(appOne, 'distinct apps').not.toBe(appTwo);
            const two = getByLabel(probe, probe.stage(appTwo), 'two');

            await render(tree(false));

            expect(journal.appDestroyCount(appOne as object), 'first app destroy count').toBe(1);
            expect(journal.appDestroyCount(appTwo as object), 'second app destroy count').toBe(0);
            expect(journal.destroyCount(two), 'second app node destroy count').toBe(0);
            expect(childLabels(probe, probe.stage(appTwo)), 'second stage').toEqual(['two']);
        },
    }),
    defineScenario({
        id: 'multi-root.default-text-style-global',
        feature: 'multi-root',
        requires: ['scene.globals'],
        title: 'defaultTextStyle is global and non-retroactive across applications',
        expected: 'One app\'s default style affects text created later in another app, but not existing text.',
        async run({ api: { Application }, composition, elements: { text: Text }, renderUntil, deferred, probe })
        {
            const baseline = probe.globals!.defaultTextStyle().fontSize;
            const other = deferred<unknown>();
            const styled = deferred<unknown>();
            const otherApp = (children: ReactNode) => (
                <Application key="other" {...composition.appOptions} onInit={other.resolve}>{children}</Application>
            );

            await renderUntil(otherApp(<Text key="early" label="early" text="early" />), other.promise);
            await renderUntil(
                <>
                    <Application key="styled" {...composition.appOptions} defaultTextStyle={{ fontSize: 41 }} onInit={styled.resolve} />
                    {otherApp(<><Text key="early" label="early" text="early" /><Text key="late" label="late" text="late" /></>)}
                </>,
                styled.promise,
            );
            const stage = probe.stage(await other.promise);

            expect(probe.get(getByLabel(probe, stage, 'early'), 'style.fontSize'), 'existing text').toBe(baseline);
            expect(probe.get(getByLabel(probe, stage, 'late'), 'style.fontSize'), 'text created later').toBe(41);
        },
    }),
];
