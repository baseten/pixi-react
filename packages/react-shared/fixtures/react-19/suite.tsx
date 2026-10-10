/**
 * The per-tuple suite: the whole conformance catalogue plus the React 19 behaviour this adapter owns, run against
 * the BUILT subpath with exactly one React/react-dom version (the fixture's). Scene state is observed through the
 * fake Pixi's probe; nothing here imports a scene library.
 */
import * as React from 'react';
import {
    Component,
    createContext,
    type ReactNode,
    startTransition,
    Suspense,
    useContext,
    useEffect,
    useLayoutEffect,
    useState,
} from 'react';
import { version as reactDomVersion } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createEpochBinding, createEpochComposition, type EpochComposition, type EpochModule } from './binding';
import {
    createScenarioContext,
    describeConformance,
    type ScenarioContext,
    type ScenarioContextHandle,
} from '@pixi-react-provisional/conformance';
import { FakePixiAdapter } from '@pixi-react-provisional/conformance/fake-pixi-adapter';
import { CompatibilityError } from '@pixi-react-provisional/core';
import { createRenderer } from '@pixi-react-provisional/renderer';

export interface EpochExpectation
{
    /** The exact React (and react-dom) version this fixture pins. */
    readonly react: string;
    /** The React minor of the package under test. */
    readonly epoch: string;
}

/** Every React 19 minor with a per-minor adapter package. */
const MINORS = ['19.0', '19.1', '19.2', '19.3'];

/** React exports that only some epochs have. Read dynamically so one source compiles against every @types line. */
const ReactExtras = React as unknown as {
    Activity?: React.ComponentType<{ mode: 'visible' | 'hidden'; children?: ReactNode }>;
    ViewTransition?: React.ComponentType<{ children?: ReactNode; name?: string; ref?: unknown; onUpdate?: () => void }>;
};

interface Captured
{
    error: unknown;
    info: unknown;
}

class Boundary extends Component<{ children?: ReactNode; fallback: ReactNode }, { failed: boolean }>
{
    state = { failed: false };

    static getDerivedStateFromError()
    {
        return { failed: true };
    }

    render()
    {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

/** A suspending resource that a test can suspend and resolve. */
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

export function describeEpoch(epoch: EpochModule, expected: EpochExpectation): void
{
    describe(`react-${expected.epoch} with React ${expected.react}`, () =>
    {
        describe('installed tuple', () =>
        {
            it('runs against exactly the pinned React and react-dom', () =>
            {
                expect(React.version).toBe(expected.react);
                expect(reactDomVersion).toBe(expected.react);
            });

            it('exports the epoch adapter as React19Adapter and the audited epoch facts', () =>
            {
                const adapter = new epoch.React19Adapter();

                expect(epoch.EPOCH.epoch).toBe(expected.epoch);
                expect(epoch.EPOCH.testedReact).toContain(expected.react);
                expect(adapter.manifest.id).toBe(`react-${expected.epoch}`);
                expect(adapter.manifest.verification).toContain(expected.react);
                expect(adapter.manifest.verification).toContain(`react-reconciler ${epoch.EPOCH.reconciler}`);
                expect(() => adapter.checkEnvironment()).not.toThrow();
            });

            it('rejects the installed React as another minor with UNSUPPORTED_TUPLE before allocating anything', () =>
            {
                // Each package is installed alone, so another minor's adapter is simulated: this package's adapter,
                // told its minor is another one. The installed React stays the fixture's.
                for (const name of MINORS)
                {
                    if (name === expected.epoch)
                    {
                        continue;
                    }

                    let failure: unknown;
                    const other = new epoch.React19Adapter() as unknown as { epoch: object };

                    Object.defineProperty(other, 'epoch', { value: { ...epoch.EPOCH, epoch: name } });

                    try
                    {
                        createRenderer({ react: other as never, pixi: new FakePixiAdapter() });
                    }
                    catch (error)
                    {
                        failure = error;
                    }

                    expect(failure, name).toBeInstanceOf(CompatibilityError);
                    expect((failure as CompatibilityError).code, name).toBe('UNSUPPORTED_TUPLE');
                    expect((failure as CompatibilityError).actual, name).toEqual({ react: expected.react });
                    expect((failure as CompatibilityError).expected?.react, name).toBe(`${name}.x`);
                }
            });
        });

        describeConformance(createEpochBinding(epoch));

        describe('React behaviour owned by the adapter', () =>
        {
            let handle: ScenarioContextHandle | undefined;
            let composition: EpochComposition | undefined;

            const setup = (): { ctx: ScenarioContext; composition: EpochComposition } =>
            {
                composition = createEpochComposition(epoch);
                handle = createScenarioContext(composition);

                return { ctx: handle.context, composition };
            };

            afterEach(async () =>
            {
                await handle?.cleanup();
                await composition?.dispose();
                handle = undefined;
                composition = undefined;
            });

            it('calls a React 19 callback ref cleanup instead of the ref with null', async () =>
            {
                const { ctx } = setup();
                const { elements: { sprite: Sprite } } = ctx;
                const calls: unknown[] = [];
                const ref = (node: unknown) =>
                {
                    calls.push(node);

                    return () =>
                    {
                        calls.push(['cleanup', node]);
                    };
                };
                const mounted = await ctx.mountApp(<Sprite ref={ref} label="a" />);
                const node = ctx.probe.children(mounted.stage)[0];

                await mounted.rerender(null);

                expect(calls).toEqual([node, ['cleanup', node]]);
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

            it('bridges a React DOM context into a createRoot tree through the public useContextBridge', async () =>
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
                        root.render(<Bridge><Labelled /></Bridge>, { width: 64, height: 64 }).then((value) =>
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
                const Catcher = class extends Boundary
                {
                    componentDidCatch(error: unknown)
                    {
                        caught.push(error);
                    }
                };

                ctx.captureConsoleErrors();
                await ctx.render(<Catcher fallback={null}><Host /></Catcher>);

                expect(caught).toHaveLength(1);
                expect(String((caught[0] as Error).message)).toMatch(/ContextBridgeProvider/);
            });

            it('useApplication validates the runtime token: another runtime\'s hook is rejected', async () =>
            {
                const { ctx } = setup();
                const other = createEpochComposition(epoch);
                const caught: unknown[] = [];
                const Foreign = () =>
                {
                    other.renderer.useApplication();

                    return null;
                };
                const Catcher = class extends Boundary
                {
                    componentDidCatch(error: unknown)
                    {
                        caught.push(error);
                    }
                };

                ctx.captureConsoleErrors();
                await ctx.mountApp(<Catcher fallback={null}><Foreign /></Catcher>);
                await other.dispose();

                expect(caught).toHaveLength(1);
                expect(caught[0]).toBeInstanceOf(CompatibilityError);
                expect((caught[0] as CompatibilityError).code).toBe('react-19.FOREIGN_RUNTIME');
            });

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
                expect(ctx.composition.probe.children(mounted.stage).map((node) => probe.label(node))).toContain('fallback');

                await ctx.act(() => resource.resolve());
                expect(probe.get(kept, 'visible')).toBe(true);
            });

            it('unmounting while a render request is pending rejects it with ROOT_DISPOSED and commits nothing late', async () =>
            {
                const { ctx, composition: { renderer } } = setup();
                const { elements: { container: Container }, journal } = ctx;
                const gate = ctx.probe.holdNextInit();
                const root = renderer.createRoot(ctx.createSizedElement(64, 64));
                const rendered = root.render(<Container label="late" />, { width: 64, height: 64 });
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
                // Repeated unmount returns the same settled teardown.
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
                // The transition is suspended: the current tree stays, the pending one is not committed.
                expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['current']);

                await ctx.unmount();
                await ctx.actUntil(Promise.resolve());
                resource.resolve();
                await ctx.actUntil(Promise.resolve());

                expect(journal.constructed().map((node) => probe.label(node))).not.toContain('pending');
                expect(journal.constructed().every((node) => journal.destroyCount(node) === 1)).toBe(true);
                expect(journal.appDestroyCount(mounted.app as object)).toBe(1);
            });

            describe('root error callbacks', () =>
            {
                it('routes an uncaught render error to onUncaughtError (createRoot option)', async () =>
                {
                    const { ctx, composition: { renderer } } = setup();
                    const uncaught: Captured[] = [];
                    const root = renderer.createRoot(ctx.createSizedElement(64, 64), {
                        onUncaughtError: (error, info) => uncaught.push({ error, info }),
                    });
                    const Failing = () =>
                    {
                        throw new Error('uncaught failure');
                    };

                    // Outside act: React 19 rethrows uncaught root errors from an act scope instead.
                    await ctx.outsideAct(async () =>
                    {
                        await root.render(<Failing />, { width: 64, height: 64 });
                        await ctx.waitFor(() => uncaught.length > 0);
                    });

                    expect((uncaught[0].error as Error).message).toBe('uncaught failure');
                    expect(uncaught[0].info).toHaveProperty('componentStack');
                    await root.unmount();
                });

                it('routes a boundary-caught error to onCaughtError (Application prop)', async () =>
                {
                    const { ctx } = setup();
                    const caught: Captured[] = [];
                    const { elements: { container: Container }, probe } = ctx;
                    const Failing = () =>
                    {
                        throw new Error('caught failure');
                    };
                    const mounted = await ctx.mountApp(
                        <Boundary fallback={<Container label="fallback" />}><Failing /></Boundary>,
                        { onCaughtError: (error: unknown, info: unknown) => caught.push({ error, info }) },
                    );

                    expect(caught.map(({ error }) => (error as Error).message)).toContain('caught failure');
                    expect(probe.label(probe.children(mounted.stage)[0])).toBe('fallback');
                });

                it('routes a recovered concurrent render error to onRecoverableError (Application prop)', async () =>
                {
                    const { ctx } = setup();
                    const { elements: { container: Container }, probe } = ctx;
                    const recoverable: Captured[] = [];
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
                        onRecoverableError: (error: unknown, info: unknown) => recoverable.push({ error, info }),
                    });

                    failOnce = true;
                    await ctx.act(() => startTransition(() => setValue('after')));

                    expect(probe.label(probe.children(mounted.stage)[0])).toBe('after');
                    expect(recoverable).toHaveLength(1);
                });

                it('defaults every channel to console.error', async () =>
                {
                    const { ctx, composition: { renderer } } = setup();
                    const calls = ctx.captureConsoleErrors();
                    const root = renderer.createRoot(ctx.createSizedElement(64, 64));
                    const Failing = () =>
                    {
                        throw new Error('default channel');
                    };

                    await ctx.outsideAct(async () =>
                    {
                        await root.render(<Failing />, { width: 64, height: 64 });
                        await ctx.waitFor(() => calls.length > 0);
                    });

                    expect(calls.some((args) => args.some((arg) => arg instanceof Error && arg.message === 'default channel'))).toBe(true);
                    await root.unmount();
                });
            });

            if (ReactExtras.Activity)
            {
                const Activity = ReactExtras.Activity;

                describe('Activity (React 19.2+)', () =>
                {
                    it('hides a scene subtree through setHidden, disconnects its effects and reconnects them', async () =>
                    {
                        const { ctx, composition: { renderer } } = setup();
                        const { elements: { container: Container }, probe } = ctx;
                        const log: string[] = [];
                        let setMode!: (mode: 'visible' | 'hidden') => void;
                        const Ticking = () =>
                        {
                            renderer.useTick(() => undefined);
                            useLayoutEffect(() =>
                            {
                                log.push('connect');

                                return () =>
                                {
                                    log.push('disconnect');
                                };
                            }, []);

                            return <Container label="inner" visible={true} />;
                        };
                        const Tree = () =>
                        {
                            const [mode, update] = useState<'visible' | 'hidden'>('visible');

                            setMode = update;

                            return <Activity mode={mode}><Ticking /></Activity>;
                        };
                        const mounted = await ctx.mountApp(<Tree />);
                        const inner = probe.children(mounted.stage)[0];
                        const listeners = probe.tickerListenerCount(mounted.app);

                        await ctx.act(() => setMode('hidden'));

                        expect(probe.get(inner, 'visible')).toBe(false);
                        expect(probe.children(mounted.stage)[0]).toBe(inner);
                        expect(probe.tickerListenerCount(mounted.app)).toBe(listeners - 1);
                        expect(log).toEqual(['connect', 'disconnect']);

                        await ctx.act(() => setMode('visible'));

                        expect(probe.get(inner, 'visible')).toBe(true);
                        expect(probe.tickerListenerCount(mounted.app)).toBe(listeners);
                        expect(log).toEqual(['connect', 'disconnect', 'connect']);
                        expect(ctx.journal.destroyCount(inner as object)).toBe(0);
                    });

                    it('keeps the app and hides the scene when a React DOM Activity hides the Application', async () =>
                    {
                        const { ctx } = setup();
                        const { api: { Application }, elements: { container: Container }, probe } = ctx;
                        let ready!: (app: unknown) => void;
                        const initialised = new Promise<unknown>((resolve) =>
                        {
                            ready = resolve;
                        });
                        const tree = (mode: 'visible' | 'hidden') => (
                            <Activity mode={mode}>
                                <Application width={64} height={64} onInit={ready}>
                                    <Container label="scene" />
                                </Application>
                            </Activity>
                        );

                        const app = await ctx.renderUntil(tree('visible'), initialised);
                        const node = probe.children(probe.stage(app))[0];

                        await ctx.render(tree('hidden'));
                        await ctx.waitFor(() => probe.get(node, 'visible') === false);
                        await ctx.actUntil(Promise.resolve());

                        expect(probe.isAppDestroyed(app)).toBe(false);
                        expect(ctx.journal.appInits()).toEqual([app]);

                        await ctx.render(tree('visible'));
                        await ctx.waitFor(() => probe.get(node, 'visible') === true);

                        expect(probe.children(probe.stage(app))[0]).toBe(node);
                        expect(ctx.journal.appInits()).toEqual([app]);
                    });
                });
            }

            if (expected.epoch === '19.3')
            {
                describe('fragment refs and ViewTransition (React 19.3) are rejected', () =>
                {
                    it('a ref on a Fragment fails with CAPABILITY_MISSING (react.fragment-ref)', async () =>
                    {
                        const { ctx, composition: { renderer } } = setup();
                        const uncaught: unknown[] = [];
                        const root = renderer.createRoot(ctx.createSizedElement(64, 64), {
                            onUncaughtError: (error) => uncaught.push(error),
                        });
                        const { elements: { container: Container } } = ctx;
                        const FragmentWithRef = React.Fragment as unknown as React.ComponentType<{ ref: unknown; children?: ReactNode }>;

                        await ctx.outsideAct(async () =>
                        {
                            await root.render(<FragmentWithRef ref={() => undefined}><Container label="a" /></FragmentWithRef>, {
                                width: 64,
                                height: 64,
                            });
                            await ctx.waitFor(() => uncaught.length > 0);
                        });

                        expect(uncaught[0]).toBeInstanceOf(CompatibilityError);
                        expect((uncaught[0] as CompatibilityError).code).toBe('CAPABILITY_MISSING');
                        expect((uncaught[0] as CompatibilityError).capability).toBe('react.fragment-ref');
                        await root.unmount();
                    });

                    it('a ref on a ViewTransition fails with CAPABILITY_MISSING (react.view-transition)', async () =>
                    {
                        const ViewTransition = ReactExtras.ViewTransition!;
                        const { ctx, composition: { renderer } } = setup();
                        const uncaught: unknown[] = [];
                        const root = renderer.createRoot(ctx.createSizedElement(64, 64), {
                            onUncaughtError: (error) => uncaught.push(error),
                        });
                        const { elements: { container: Container } } = ctx;

                        await ctx.outsideAct(async () =>
                        {
                            await root.render(<ViewTransition ref={() => undefined}><Container label="a" /></ViewTransition>, {
                                width: 64,
                                height: 64,
                            });
                            await ctx.waitFor(() => uncaught.length > 0);
                        });

                        expect(uncaught[0]).toBeInstanceOf(CompatibilityError);
                        expect((uncaught[0] as CompatibilityError).capability).toBe('react.view-transition');
                        await root.unmount();
                    });

                    it('an animated ViewTransition is reported through onRecoverableError and commits without animation', async () =>
                    {
                        const ViewTransition = ReactExtras.ViewTransition!;
                        const { ctx } = setup();
                        const { elements: { container: Container }, probe } = ctx;
                        const recoverable: unknown[] = [];
                        let setLabel!: (value: string) => void;
                        const Animated = () =>
                        {
                            const [label, update] = useState('before');

                            setLabel = update;

                            return <ViewTransition key={label} name="scene"><Container label={label} /></ViewTransition>;
                        };
                        const mounted = await ctx.mountApp(<Animated />, {
                            onRecoverableError: (error: unknown) => recoverable.push(error),
                        });

                        await ctx.act(() => startTransition(() => setLabel('after')));
                        await ctx.actUntil(Promise.resolve());

                        expect(probe.children(mounted.stage).map((node) => probe.label(node))).toEqual(['after']);
                        expect(recoverable.length).toBeGreaterThan(0);
                        expect(recoverable[0]).toBeInstanceOf(CompatibilityError);
                        expect((recoverable[0] as CompatibilityError).capability).toBe('react.view-transition');
                    });
                });
            }
        });
    });
}
