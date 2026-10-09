/**
 * A fake React 19 framework adapter: a `FrameworkAdapter` subclass over react-reconciler 0.31, for conformance
 * runs of core + renderer. It is a test double, not the issue-9 adapter. It owns only React concerns (host
 * config, roots, context, hooks). Everything else goes through core:
 *
 * - element names resolve through the runtime registry;
 * - nodes are created, mutated, hidden and destroyed through `root.scene` (so core owns WeakMap metadata,
 *   attach checks and exactly-once destruction);
 * - roots, target ownership, init/teardown ordering and StrictMode deferral are core root records.
 *
 * It is generic over the scene: nothing here knows the fake scene's node or app types.
 */
import { FiberProvider, useContextBridge } from 'its-fine';
import {
    type ComponentType,
    createContext,
    forwardRef,
    type ReactNode,
    type RefObject,
    useContext,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
import createReconciler from 'react-reconciler';
import { ConcurrentRoot, DefaultEventPriority } from 'react-reconciler/constants';
import {
    type AdapterManifest,
    type ApplicationState,
    type Bind,
    type BindingFamily,
    type Catalog,
    type Constructor,
    FrameworkAdapter,
    type RootRecord,
    type RootTarget,
    type Runtime,
    type SceneTypes,
    type TickOptions,
} from '@pixi-react-provisional/core';

/** `NoEventPriority` of reconciler 0.31; missing from the installed (0.28) reconciler types. */
const NoEventPriority = 0;
const TAG_PREFIX = 'fake';

type Props = Record<string, unknown>;

export interface FakeReactRootOptions<S extends SceneTypes>
{
    onInit?: (app: S['app']) => void;
    onInitError?: (error: unknown) => void;
    destroyOptions?: unknown;
    rendererDestroyOptions?: unknown;
    onUncaughtError?: (error: unknown, info: unknown) => void;
    onCaughtError?: (error: unknown, info: unknown) => void;
    onRecoverableError?: (error: unknown, info: unknown) => void;
}

export interface FakeReactRoot<S extends SceneTypes>
{
    readonly record: RootRecord<S>;
    render(children: ReactNode, options?: Record<string, unknown>): Promise<S['app']>;
    unmount(): Promise<void>;
    scheduleUnmount(): void;
    cancelScheduledUnmount(): void;
    updateOptions(options: FakeReactRootOptions<S>): void;
}

export interface FakeReactBindings<S extends SceneTypes>
{
    /** Test double: props are untyped here; the real adapter derives them from the scene (issue 9/11). */
    Application: ComponentType<any>;
    createRoot(target: RootTarget, options?: FakeReactRootOptions<S>): FakeReactRoot<S>;
    extend(catalog: Catalog): void;
    useExtend(catalog: Catalog): void;
    useApplication(): ApplicationState<S['app']>;
    useTick(options: ((tick: S['tick']) => void) | TickOptions<S['tick'], any>): void;
    applyProps<N extends S['node']>(instance: N, props: Props): N;
    /** Registers `ctor` and returns its element type (the registered name). */
    component(ctor: Constructor, name?: string): string;
    tagFor(name: string): string;
}

export interface FakeReactFamily extends BindingFamily
{
    readonly type: FakeReactBindings<Extract<this['scene'], SceneTypes>>;
}

export interface FakeReactFaults
{
    /** `<Application>` does not handle a rejected render, so an init failure becomes an unhandled rejection. */
    leakInitRejection?: boolean;
}

interface HostContainer<S extends SceneTypes>
{
    readonly record: RootRecord<S>;
}

export class FakeReactFrameworkAdapter extends FrameworkAdapter<FakeReactFamily>
{
    readonly manifest: AdapterManifest = {
        abi: { major: 1, minor: 0 },
        id: 'conformance.fake-react-19',
        packageVersion: '0.0.0',
        certification: 'none: conformance test double',
        provides: {},
        requires: { 'scene.mutation': 1, 'scene.visibility': 1, 'scene.application': 1, 'scene.ticker': 1 },
    };

    constructor(private readonly faults: FakeReactFaults = {})
    {
        super();
    }

    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<FakeReactFamily, S>
    {
        // `Extract<S, SceneTypes>` is `S`; TypeScript cannot reduce it for a generic S.
        return createBindings(runtime, this.faults) as Bind<FakeReactFamily, S>;
    }
}

function createBindings<S extends SceneTypes>(runtime: Runtime<S>, faults: FakeReactFaults): FakeReactBindings<S>
{
    let currentUpdatePriority: number = NoEventPriority;
    const wrappers = new WeakMap<RootRecord<S>, FakeReactRoot<S>>();
    const recordOf = (node: S['node']): RootRecord<S> =>
    {
        const info = runtime.nodeInfo(node);

        if (!info)
        {
            throw new Error('The node is not owned by this runtime.');
        }

        return info.root;
    };

    const hostConfig = {
        isPrimaryRenderer: false,
        supportsMutation: true,
        supportsPersistence: false,
        supportsHydration: false,
        noTimeout: -1,
        NotPendingTransition: null,
        warnsIfNotActing: true,
        scheduleTimeout: setTimeout,
        cancelTimeout: clearTimeout,
        rendererPackageName: '@pixi-react-provisional/conformance-fake-react',
        rendererVersion: '0.0.0',

        createInstance: (type: string, props: Props, container: HostContainer<S>) => container.record.scene.create(type, props),
        createTextInstance(text: string)
        {
            throw new Error(`Raw text "${text}" cannot be rendered in the scene; use a Text component`);
        },
        appendInitialChild: (parent: S['node'], child: S['node']) => recordOf(parent).scene.append(parent, child),
        finalizeInitialChildren: () => false,
        shouldSetTextContent: () => false,
        getRootHostContext: () => ({}),
        getChildHostContext: (context: object) => context,
        getPublicInstance: (instance: S['node']) => recordOf(instance).scene.publicInstance(instance),
        prepareForCommit: () => null,
        // Removed subtrees are destroyed after the commit, through core, each node exactly once.
        resetAfterCommit: (container: HostContainer<S>) => container.record.scene.flush(),
        preparePortalMount: () => undefined,
        appendChild: (parent: S['node'], child: S['node']) => recordOf(parent).scene.append(parent, child),
        appendChildToContainer: ({ record }: HostContainer<S>, child: S['node']) =>
            record.scene.append(record.session.container, child),
        insertBefore: (parent: S['node'], child: S['node'], before: S['node']) =>
            recordOf(parent).scene.insertBefore(parent, child, before),
        insertInContainerBefore: ({ record }: HostContainer<S>, child: S['node'], before: S['node']) =>
            record.scene.insertBefore(record.session.container, child, before),
        removeChild: (parent: S['node'], child: S['node']) => recordOf(child).scene.remove(parent, child),
        removeChildFromContainer: ({ record }: HostContainer<S>, child: S['node']) =>
            record.scene.remove(record.session.container, child),
        commitUpdate: (instance: S['node'], _type: string, previous: Props, next: Props) =>
            recordOf(instance).scene.update(instance, previous, next),
        hideInstance: (instance: S['node']) => recordOf(instance).scene.setHidden(instance, true),
        unhideInstance: (instance: S['node']) => recordOf(instance).scene.setHidden(instance, false),
        hideTextInstance: () => undefined,
        unhideTextInstance: () => undefined,
        clearContainer: () => undefined,
        detachDeletedInstance: () => undefined,
        getCurrentUpdatePriority: () => currentUpdatePriority,
        setCurrentUpdatePriority(priority: number)
        {
            currentUpdatePriority = priority;
        },
        resolveUpdatePriority: () => (currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority),
        maySuspendCommit: () => false,
        preloadInstance: () => true,
        startSuspendingCommit: () => undefined,
        suspendInstance: () => undefined,
        waitForCommitToBeReady: () => null,
        shouldAttemptEagerTransition: () => false,
        requestPostPaintCallback: () => undefined,
        trackSchedulerEvent: () => undefined,
        resolveEventType: () => null,
        resolveEventTimeStamp: () => -1.1,
        resetFormInstance: () => undefined,
        getInstanceFromNode: () => null,
        getInstanceFromScope: () => null,
        beforeActiveInstanceBlur: () => undefined,
        afterActiveInstanceBlur: () => undefined,
        prepareScopeUpdate: () => undefined,
    };

    const reconciler = (createReconciler as unknown as (config: unknown) => any)(hostConfig);
    const StateContext = createContext<ApplicationState<S['app']> | null>(null);
    const RecordContext = createContext<RootRecord<S> | null>(null);

    function createRoot(target: RootTarget, options: FakeReactRootOptions<S> = {}): FakeReactRoot<S>
    {
        // Core maps the target and its canvas to one root record, and rejects targets another runtime owns.
        const record = runtime.createRoot(target);
        const existing = wrappers.get(record);

        if (existing)
        {
            existing.updateOptions(options);

            return existing;
        }

        let rootOptions = options;
        const report = (key: 'onUncaughtError' | 'onCaughtError' | 'onRecoverableError') =>

            (error: unknown, info: unknown) => (rootOptions[key] ?? console.error)(error, info);
        const fiber = reconciler.createContainer(
            { record } satisfies HostContainer<S>,
            ConcurrentRoot,
            null,
            false,
            null,
            '',
            report('onUncaughtError'),
            report('onCaughtError'),
            report('onRecoverableError'),
            null,
        );

        record.setHooks({
            onInit: (app) => rootOptions.onInit?.(app),
            onInitError: (error) => rootOptions.onInitError?.(error),
        });
        // Core runs this first when the root tears down; nodes removed here get the root's destroy options.
        record.onTeardown(() =>
        {
            reconciler.updateContainerSync(null, fiber, null, null);
            reconciler.flushSyncWork();
        });

        const destroyOptions = () => ({
            destroyOptions: rootOptions.destroyOptions,
            rendererDestroyOptions: rootOptions.rendererDestroyOptions,
        }) as S['destroy'];

        const root: FakeReactRoot<S> = {
            record,
            render(children, appOptions = {})
            {
                const { resizeTo, ...initOptions } = appOptions;

                void record.initialise(initOptions as S['options']);

                // Runs after onInit, in call order; resolves after this request's own commit. Every render passes
                // the complete set of application props; the scene decides which ones are mutable.
                return record.schedule((app) => new Promise<S['app']>((resolve) =>
                {
                    record.scene.updateApplication({ ...initOptions, resizeTo: resizeTo ?? null } as S['appProps']);
                    reconciler.updateContainer(
                        <RecordContext.Provider value={record}>
                            <StateContext.Provider value={record.applicationState}>{children}</StateContext.Provider>
                        </RecordContext.Provider>,
                        fiber,
                        null,
                        () => resolve(app),
                    );
                }));
            },
            unmount: () => record.dispose(destroyOptions()),
            scheduleUnmount: () => record.deferDispose(destroyOptions()),
            cancelScheduledUnmount: () =>
            {
                record.cancelDeferredDispose();
            },
            updateOptions(next)
            {
                rootOptions = { ...rootOptions, ...next };
            },
        };

        wrappers.set(record, root);

        return root;
    }

    const useApplication = (): ApplicationState<S['app']> =>
    {
        const state = useContext(StateContext);

        if (!state)
        {
            throw new Error('useApplication must be used inside <Application>');
        }

        return state;
    };

    const useTick = (options: ((tick: S['tick']) => void) | TickOptions<S['tick'], any>) =>
    {
        const { isInitialised } = useApplication();
        const record = useContext(RecordContext);
        const normalized: TickOptions<S['tick'], any> = typeof options === 'function' ? { callback: options } : options;
        const { callback, context, isEnabled = true, priority = 0 } = normalized;

        useLayoutEffect(() =>
        {
            if (!isInitialised || !record)
            {
                return undefined;
            }

            return record.scene.subscribe({ callback, context, isEnabled, priority });
        }, [record, isInitialised, callback, context, isEnabled, priority]);
    };

    const useExtend = (catalog: Catalog) =>
    {
        useMemo(() => runtime.registry.extend(catalog), [catalog]);
    };

    // `any` values as in the baseline fake: forwardRef's PropsWithoutRef drops members of an `unknown` index type.
    interface ApplicationProps extends Record<string, any>
    {
        children?: ReactNode;
        className?: string;
        onInit?: (app: S['app']) => void;
        onInitError?: (error: unknown) => void;
        destroyOptions?: unknown;
        rendererDestroyOptions?: unknown;
        resizeTo?: HTMLElement | RefObject<HTMLElement | null> | null;
    }

    const ApplicationInner = forwardRef<unknown, ApplicationProps>(function ApplicationInner(props, ref)
    {
        const { children, className, onInit, onInitError, destroyOptions, rendererDestroyOptions, resizeTo, ...appOptions } = props;
        const Bridge = useContextBridge();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const rootRef = useRef<FakeReactRoot<S> | null>(null);
        const latest = useRef(props);

        latest.current = props;

        useImperativeHandle(ref, () => ({
            getApplication: () => (rootRef.current?.record.status === 'ready' ? rootRef.current.record.app : null),
            getCanvas: () => canvasRef.current,
        }));

        useLayoutEffect(() =>
        {
            const root = createRoot(canvasRef.current!, {
                onInit: (app) => latest.current.onInit?.(app),
                onInitError: (error) => latest.current.onInitError?.(error),
            });

            // A StrictMode replay remounts before the deferred teardown runs, and cancels it.
            root.cancelScheduledUnmount();
            rootRef.current = root;

            return () => root.scheduleUnmount();
        }, []);

        useLayoutEffect(() =>
        {
            const root = rootRef.current!;

            root.updateOptions({ destroyOptions, rendererDestroyOptions });

            const target = resizeTo && 'current' in resizeTo ? resizeTo.current : resizeTo;
            // Errors reach onInitError / the root callbacks, never an unhandled rejection.
            const rendered = root.render(<Bridge>{children}</Bridge>, { ...appOptions, resizeTo: target ?? null });

            if (!faults.leakInitRejection)
            {
                rendered.catch(() => undefined);
            }
        });

        return <canvas ref={canvasRef} className={className} />;
    });

    const Application = forwardRef<unknown, ApplicationProps>(function Application(props, ref)
    {
        return (
            <FiberProvider>
                <ApplicationInner ref={ref} {...props} />
            </FiberProvider>
        );
    });

    return {
        Application,
        createRoot,
        extend: (catalog) => runtime.registry.extend(catalog),
        useExtend,
        useApplication,
        useTick,
        applyProps(instance, props)
        {
            if (!runtime.scene.applyProps)
            {
                throw new Error(`Scene adapter "${runtime.manifests.scene.id}" has no standalone applyProps.`);
            }

            runtime.scene.applyProps(instance, props);

            return instance;
        },
        component: (ctor, name) => runtime.registry.define(ctor, name).name,
        tagFor: (name) => `${TAG_PREFIX}${name}`,
    };
}
