/**
 * The React 18 suite: behaviour the React 18 adapter owns, run against the PACKED packages with exactly one React
 * 18 / react-dom 18 version (the fixture's) and the real, unchanged Pixi 8 adapter in Chromium. The shared
 * conformance catalogue runs separately (test/conformance.test.tsx); this suite covers what is React 18-specific:
 * the installed tuple, refs through forwardRef, effects, the its-fine 1.x context bridge, StrictMode, pending
 * initialization and unmount, ConcurrentRoot behaviour and React 18's error routing.
 */
import { Container as PixiContainer, VERSION as pixiVersion } from 'pixi.js';
import * as React from 'react';
import {
    Component,
    createContext,
    createRef,
    type ReactNode,
    startTransition,
    StrictMode,
    Suspense,
    useContext,
    useEffect,
    useLayoutEffect,
    useState,
    useTransition,
} from 'react';
import { version as reactDomVersion } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createReact18Composition, type React18Composition } from './binding';
import { createScenarioContext, type ScenarioContext, type ScenarioContextHandle } from '@pixi-react-provisional/conformance';
import { CompatibilityError } from '@pixi-react-provisional/core';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { REACT18, React18Adapter, UNSUPPORTED_CAPABILITIES } from '@pixi-react-provisional/react-18';
import { createRenderer } from '@pixi-react-provisional/renderer';

export interface React18Expectation
{
    /** The exact React (and react-dom) version this fixture pins. */
    readonly react: string;
}

class Boundary extends Component<{ children?: ReactNode; fallback: ReactNode; onError?: (error: unknown) => void }, { failed: boolean }>
{
    state = { failed: false };

    static getDerivedStateFromError()
    {
        return { failed: true };
    }

    componentDidCatch(error: unknown)
    {
        this.props.onError?.(error);
    }

    render()
    {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

/** A suspending resource that a test can suspend and resolve (a thrown thenable, as React 18 needs). */
function createSuspender()
{
    let pending: { promise: Promise<void>; resolve: () => void } | null = null;

    return {
        read()
        {
            if (pending)
            {
                throw pending.promise;
            }
        },
        suspend()
        {
            let resolve!: () => void;
            const promise = new Promise<void>((done) =>
            {
                resolve = done;
            });

            pending = { promise, resolve };
        },
        resolve()
        {
            const current = pending;

            pending = null;
            current?.resolve();
        },
    };
}

const messageOf = (value: unknown) => (value instanceof Error ? value.message : String(value));

export function describeReact18(expected: React18Expectation): void
{
    describe(`react-18 with React ${expected.react} + Pixi8Adapter on pixi.js ${pixiVersion}`, () =>
    {
        let handle: ScenarioContextHandle | undefined;
        let composition: React18Composition | undefined;

        const setup = (): { ctx: ScenarioContext; composition: React18Composition } =>
        {
            composition = createReact18Composition();
            handle = createScenarioContext(composition);

            return { ctx: handle.context, composition };
        };

        afterEach(async () =>
        {
            try
            {
                await handle?.cleanup();
            }
            finally
            {
                await composition?.dispose();
                handle = undefined;
                composition = undefined;
            }
        });

        describe('installed tuple', () =>
        {
            it('runs against exactly the pinned React and react-dom 18, with no React 19 API', () =>
            {
                expect(React.version).toBe(expected.react);
                expect(reactDomVersion).toBe(expected.react);
                // React 19 APIs the adapter must not rely on.
                expect((React as Record<string, unknown>).use).toBeUndefined();
                expect((React as Record<string, unknown>).Activity).toBeUndefined();
            });

            it('composes the React 18 adapter with the unchanged Pixi 8 adapter through the version-neutral factory', () =>
            {
                const react = new React18Adapter();
                const pixi = new Pixi8Adapter();
                const renderer = createRenderer({ react, pixi });

                expect(react.manifest.id).toBe('react-18');
                expect(react.manifest.verification).toContain(`react ${expected.react}`);
                expect(react.manifest.verification).toContain(`react-reconciler ${REACT18.reconciler}`);
                expect(REACT18.testedReact).toContain(expected.react);
                expect(pixi.manifest.id).toBe('pixi-8');
                expect([renderer.runtime.manifests.react.id, renderer.runtime.manifests.pixi.id]).toEqual(['react-18', 'pixi-8']);
                expect(() => react.checkEnvironment()).not.toThrow();

                return renderer.runtime.dispose();
            });

            it('declares React 19-only capabilities as missing: requiring them fails before anything is allocated', () =>
            {
                for (const capability of Object.keys(UNSUPPORTED_CAPABILITIES))
                {
                    let failure: unknown;

                    try
                    {
                        createRenderer(
                            { react: new React18Adapter(), pixi: new Pixi8Adapter() },
                            { requiredCapabilities: { [capability]: 1 } },
                        );
                    }
                    catch (error)
                    {
                        failure = error;
                    }

                    expect(failure, capability).toBeInstanceOf(CompatibilityError);
                    expect((failure as CompatibilityError).code, capability).toBe('CAPABILITY_MISSING');
                    expect((failure as CompatibilityError).capability, capability).toBe(capability);
                }
            });
        });

        describe('refs and effects', () =>
        {
            it('calls a callback ref with the node, then with null on removal (React 18 semantics)', async () =>
            {
                const { ctx } = setup();
                const { elements: { sprite: Sprite } } = ctx;
                const calls: unknown[] = [];
                const mounted = await ctx.mountApp(<Sprite ref={(node: unknown) => calls.push(node)} label="a" />);
                const node = ctx.probe.children(mounted.stage)[0];

                await mounted.rerender(null);

                expect(calls).toEqual([node, null]);
            });

            it('forwards refs through component(Ctor) and Application with forwardRef', async () =>
            {
                const { ctx, composition: { renderer } } = setup();
                const SpriteComponent = renderer.component(composition!.probe.catalog.Sprite, 'Sprite');
                const nodeRef = createRef<unknown>();
                const appRef = createRef<{ getApplication(): unknown; getCanvas(): HTMLCanvasElement | null }>();
                const { Application } = renderer;
                const ready = ctx.deferred<unknown>();

                await ctx.renderUntil(
                    <Application {...composition!.appOptions} ref={appRef as never} onInit={ready.resolve}>
                        <SpriteComponent ref={nodeRef as never} label="by-component" />
                    </Application>,
                    ready.promise,
                );
                await ctx.actUntil(Promise.resolve());

                const app = await ready.promise;
                const [node] = ctx.probe.children(ctx.probe.stage(app));

                expect(nodeRef.current).toBe(node);
                expect(nodeRef.current).toBeInstanceOf(PixiContainer);
                expect(ctx.probe.label(node)).toBe('by-component');
                expect(appRef.current?.getApplication()).toBe(app);
                expect(appRef.current?.getCanvas()).toBe(ctx.host.querySelector('canvas'));
            });

            it('runs layout effects with the node attached, then passive effects; cleanups before destruction', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const log: string[] = [];
                const Probe = () =>
                {
                    const ref = React.useRef<unknown>(null);

                    useLayoutEffect(() =>
                    {
                        const node = ref.current;

                        log.push(`layout:${probe.label(probe.parent(node) as object) ?? 'stage'}`);

                        return () =>
                        {
                            log.push(`layout-cleanup:destroyed=${probe.isDestroyed(node)}`);
                        };
                    }, []);
                    useEffect(() =>
                    {
                        log.push('passive');

                        return () =>
                        {
                            log.push('passive-cleanup');
                        };
                    }, []);

                    return <Container ref={ref} label="child" />;
                };
                const mounted = await ctx.mountApp(<Container label="parent"><Probe /></Container>);

                expect(log).toEqual(['layout:parent', 'passive']);

                await mounted.rerender(null);

                expect(log).toEqual(['layout:parent', 'passive', 'layout-cleanup:destroyed=false', 'passive-cleanup']);
                expect(ctx.journal.of('construct').every((entry) => ctx.journal.destroyCount(entry.node) === 1)).toBe(true);
            });

            it('replays scene effects under a StrictMode inside the scene without reconstructing nodes', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, journal } = ctx;
                const log: string[] = [];
                const refs: unknown[] = [];
                const Effects = () =>
                {
                    useLayoutEffect(() =>
                    {
                        log.push('layout');

                        return () =>
                        {
                            log.push('layout-cleanup');
                        };
                    }, []);
                    useEffect(() =>
                    {
                        log.push('passive');

                        return () =>
                        {
                            log.push('passive-cleanup');
                        };
                    }, []);

                    return <Container ref={(node: unknown) => refs.push(node)} label="strict" />;
                };
                const mounted = await ctx.mountApp(<StrictMode><Effects /></StrictMode>);
                const node = ctx.probe.children(mounted.stage)[0];

                // React 18 StrictMode replays effects (not refs) once on mount, in the scene root too.
                expect(log).toEqual(['layout', 'passive', 'layout-cleanup', 'passive-cleanup', 'layout', 'passive']);
                expect(refs).toEqual([node]);
                expect(journal.constructed()).toEqual([node]);
                expect(journal.destroyCount(node as object)).toBe(0);
            });

            it('under a DOM StrictMode mounts one application whose scene renders once per update', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, journal } = ctx;
                let renders = 0;
                const Counted = () =>
                {
                    renders += 1;

                    return <Container label="once" />;
                };

                await ctx.mountApp(<Counted />, {}, { strict: true });

                expect(journal.appInits()).toHaveLength(1);
                expect(journal.constructed()).toHaveLength(1);
                // StrictMode does not cross into the separate scene root: no double render there.
                expect(renders).toBe(1);
            });
        });

        describe('context bridge (its-fine 1.x)', () =>
        {
            it('bridges a React DOM context into a createRoot tree through the public useContextBridge, with updates', async () =>
            {
                const { ctx, composition: { renderer } } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const Theme = createContext('default');
                const target = ctx.createSizedElement(64, 64);
                const root = renderer.createRoot(target);
                const Labelled = () =>
                {
                    const { isInitialised } = renderer.useApplication();

                    return <Container label={`${useContext(Theme)}:${isInitialised}`} />;
                };
                let setTheme!: (value: string) => void;
                let app: unknown;
                const Host = () =>
                {
                    const Bridge = renderer.useContextBridge();

                    useLayoutEffect(() =>
                    {
                        root.render(<Bridge><Labelled /></Bridge>, { ...composition!.appOptions } as never).then((value) =>
                        {
                            app = value;
                        }, () => undefined);
                    });

                    return null;
                };
                const DomTree = () =>
                {
                    const [theme, update] = useState('first');

                    setTheme = update;

                    return (
                        <Theme.Provider value={theme}>
                            <renderer.ContextBridgeProvider><Host /></renderer.ContextBridgeProvider>
                        </Theme.Provider>
                    );
                };

                await ctx.render(<DomTree />);
                await ctx.waitFor(() => app !== undefined);
                await ctx.actUntil(Promise.resolve());

                const stage = probe.stage(app);
                const node = probe.children(stage)[0];

                expect(probe.label(node)).toBe('first:true');

                await ctx.act(() => setTheme('second'));
                await ctx.actUntil(Promise.resolve());

                expect(probe.children(stage)[0]).toBe(node);
                expect(probe.label(node)).toBe('second:true');

                await ctx.act(() => root.unmount());
                expect(root.status).toBe('disposed');
            });

            it('useContextBridge outside a ContextBridgeProvider fails with guidance', async () =>
            {
                const { ctx, composition: { renderer } } = setup();
                const caught: unknown[] = [];
                const Host = () =>
                {
                    renderer.useContextBridge();

                    return null;
                };

                ctx.captureConsoleErrors();
                await ctx.render(<Boundary fallback={null} onError={(error) => caught.push(error)}><Host /></Boundary>);

                expect(caught).toHaveLength(1);
                expect(messageOf(caught[0])).toMatch(/ContextBridgeProvider/);
            });

            it('useApplication validates the runtime token: another runtime\'s hook is rejected', async () =>
            {
                const { ctx } = setup();
                const other = createReact18Composition();
                const caught: unknown[] = [];
                const Foreign = () =>
                {
                    other.renderer.useApplication();

                    return null;
                };

                ctx.captureConsoleErrors();

                try
                {
                    await ctx.mountApp(<Boundary fallback={null} onError={(error) => caught.push(error)}><Foreign /></Boundary>);
                }
                finally
                {
                    await other.dispose();
                }

                expect(caught).toHaveLength(1);
                expect(caught[0]).toBeInstanceOf(CompatibilityError);
                expect((caught[0] as CompatibilityError).code).toBe('react-18.FOREIGN_RUNTIME');
            });
        });

        describe('Suspense, pending initialization and unmount', () =>
        {
            it('hides and restores committed nodes through Suspense, in the Pixi session', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const resource = createSuspender();
                const Suspending = () =>
                {
                    resource.read();

                    return <Container label="loaded" />;
                };
                const tree = (marker: number) => (
                    <Suspense fallback={<Container label="fallback" />}>
                        <Container label="kept" />
                        <Suspending key={marker} />
                    </Suspense>
                );
                const mounted = await ctx.mountApp(tree(0));
                const kept = probe.children(mounted.stage)[0];

                resource.suspend();
                await mounted.rerender(tree(1));
                expect(probe.get(kept, 'visible')).toBe(false);
                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toContain('fallback');

                await ctx.act(() => resource.resolve());
                await ctx.actUntil(Promise.resolve());
                expect(probe.get(kept, 'visible')).toBe(true);
                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['kept', 'loaded']);
            });

            it('unmounting while initialization is pending rejects the render with ROOT_DISPOSED and commits nothing', async () =>
            {
                const { ctx, composition: { renderer } } = setup();
                const { elements: { container: Container }, journal } = ctx;
                const gate = ctx.probe.holdNextInit();
                const root = renderer.createRoot(ctx.createSizedElement(64, 64));
                const rendered = root.render(<Container label="late" />, { ...composition!.appOptions } as never);
                const settled = rendered.then(() => 'resolved', (error: unknown) => error);

                await gate.started;
                expect(root.status).toBe('initialising');

                const unmounted = root.unmount();

                gate.release();
                await ctx.actUntil(gate.settled);
                await unmounted;

                const outcome = await settled;

                expect(outcome).toBeInstanceOf(CompatibilityError);
                expect((outcome as CompatibilityError).code).toBe('ROOT_DISPOSED');
                expect(journal.constructed()).toEqual([]);
                expect(root.status).toBe('disposed');
                expect(root.unmount()).toBe(unmounted);
            });

            it('unmounting while a suspended transition is pending destroys everything and never commits it', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, journal, probe } = ctx;
                const resource = createSuspender();
                let show!: (value: boolean) => void;
                const Suspending = () =>
                {
                    resource.read();

                    return <Container label="pending" />;
                };
                const Toggle = () =>
                {
                    const [visible, setVisible] = useState(false);

                    show = setVisible;

                    return (
                        <Suspense fallback={<Container label="fallback" />}>
                            <Container label="current" />
                            {visible ? <Suspending /> : null}
                        </Suspense>
                    );
                };
                const mounted = await ctx.mountApp(<Toggle />);

                resource.suspend();
                await ctx.act(() => startTransition(() => show(true)));
                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['current']);

                await ctx.unmount();
                await ctx.actUntil(Promise.resolve());
                resource.resolve();
                await ctx.actUntil(Promise.resolve());

                expect(journal.constructed().map((node) => probe.label(node))).not.toContain('pending');
                expect(journal.constructed().every((node) => journal.destroyCount(node) === 1)).toBe(true);
                expect(journal.appDestroyCount(mounted.app as object)).toBe(1);
            });
        });

        describe('ConcurrentRoot', () =>
        {
            it('useTransition keeps the committed scene while a transition is pending', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const resource = createSuspender();
                let navigate!: () => void;
                let pendingSeen = false;
                const Page = ({ page }: { page: string }) =>
                {
                    if (page === 'next')
                    {
                        resource.read();
                    }

                    return <Container label={page} />;
                };
                const Router = () =>
                {
                    const [page, setPage] = useState('first');
                    const [isPending, start] = useTransition();

                    pendingSeen ||= isPending;
                    navigate = () => start(() => setPage('next'));

                    return (
                        <Suspense fallback={<Container label="fallback" />}>
                            <Page page={page} />
                        </Suspense>
                    );
                };
                const mounted = await ctx.mountApp(<Router />);

                resource.suspend();
                await ctx.act(() => navigate());

                expect(pendingSeen).toBe(true);
                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['first']);

                await ctx.act(() => resource.resolve());
                await ctx.actUntil(Promise.resolve());

                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['next']);
            });
        });

        describe('root error routing (React 18 has onRecoverableError only)', () =>
        {
            it('routes a recovered concurrent render error to onRecoverableError (Application prop)', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const recoverable: unknown[] = [];
                let failOnce = false;
                let setValue!: (value: string) => void;
                const Flaky = () =>
                {
                    const [value, update] = useState('before');

                    setValue = update;

                    if (failOnce && value === 'after')
                    {
                        failOnce = false;
                        throw new Error('concurrent render failure');
                    }

                    return <Container label={value} />;
                };
                const mounted = await ctx.mountApp(<Flaky />, {
                    onRecoverableError: (error: unknown) => recoverable.push(error),
                });

                failOnce = true;
                await ctx.act(() => startTransition(() => setValue('after')));

                expect(probe.label(probe.children(mounted.stage)[0])).toBe('after');
                expect(recoverable).toHaveLength(1);
            });

            it('rejects the React 19 root callbacks on createRoot and Application with CAPABILITY_MISSING', async () =>
            {
                const { ctx, composition: { renderer } } = setup();

                for (const option of ['onCaughtError', 'onUncaughtError'])
                {
                    let failure: unknown;

                    try
                    {
                        renderer.createRoot(ctx.createSizedElement(64, 64), { [option]: () => undefined } as never);
                    }
                    catch (error)
                    {
                        failure = error;
                    }

                    expect(failure, option).toBeInstanceOf(CompatibilityError);
                    expect((failure as CompatibilityError).code).toBe('CAPABILITY_MISSING');
                    expect((failure as CompatibilityError).capability).toBe('react.root-error-callbacks');
                    expect(messageOf(failure)).toContain(option);
                }

                // Nothing was allocated by the rejected calls.
                expect(composition!.renderer.runtime.roots()).toEqual([]);

                const caught: unknown[] = [];
                const { Application } = renderer;

                ctx.captureConsoleErrors();
                await ctx.render(
                    <Boundary fallback={null} onError={(error) => caught.push(error)}>
                        <Application {...({ onUncaughtError: () => undefined } as object)} />
                    </Boundary>,
                );

                expect(caught).toHaveLength(1);
                expect((caught[0] as CompatibilityError).capability).toBe('react.root-error-callbacks');
            });

            it('a boundary in the scene catches a render error; React 18 reports it to console.error', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const calls = ctx.captureConsoleErrors();
                const Failing = () =>
                {
                    throw new Error('caught failure');
                };
                const mounted = await ctx.mountApp(<Boundary fallback={<Container label="fallback" />}><Failing /></Boundary>);

                expect(probe.label(probe.children(mounted.stage)[0])).toBe('fallback');
                expect(calls.some((args) => args.some((arg) => (/caught failure/).test(messageOf(arg))))).toBe(true);
            });

            it('an uncaught render error unmounts the scene tree and is rethrown, the DOM tree keeps its canvas', async () =>
            {
                const { ctx } = setup();
                const { elements: { container: Container }, probe } = ctx;
                const Failing = () =>
                {
                    throw new Error('uncaught failure');
                };
                const mounted = await ctx.mountApp(<Container label="before" />);
                const before = probe.children(mounted.stage)[0];
                const thrown: unknown[] = [];

                ctx.captureConsoleErrors();

                try
                {
                    await mounted.rerender(<Failing />);
                }
                catch (error)
                {
                    thrown.push(error);
                }

                expect(thrown.map(messageOf).join('\n')).toMatch(/uncaught failure/);
                expect(probe.children(mounted.stage)).toEqual([]);
                expect(probe.isDestroyed(before)).toBe(true);
                expect(ctx.host.querySelector('canvas')).toBeInstanceOf(HTMLCanvasElement);
            });
        });
    });
}
