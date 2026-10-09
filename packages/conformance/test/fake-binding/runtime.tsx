/**
 * A minimal React 19 renderer over the fake scene backend. It is a test double, not an adapter: it exists to
 * prove that the conformance binding interface is not shaped around the facade, to exercise the fake scene
 * backend, and to host committed negative controls (faulty variants that the suite must reject).
 *
 * It follows the adapter contract where the facade does not (one teardown per root, no late commits after
 * unmount, init failures routed to `onInitError`, per-runtime roots), so it passes contract scenarios the
 * facade lists as expected failures.
 */
import { FiberProvider, useContextBridge } from 'its-fine';
import {
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
    applyFakeProps,
    type FakeContainer,
    type FakeNodeDestroyOptions,
    type FakeSceneFaults,
    FakeSceneSession,
} from '../../src/fake-scene';

import type {
    ApplicationStateLike,
    Constructor,
    ReactBindingApi,
    RootLike,
    TickOptionsLike,
} from '../../src/binding';
import type { SceneJournal } from '../../src/journal';

type Props = Record<string, any>;

/** `NoEventPriority` of reconciler 0.31; missing from the installed (0.28) reconciler types. */
const NoEventPriority = 0;

interface RootContainer
{
    session: FakeSceneSession;
    root: InternalRoot;
}

interface RenderRequest
{
    children: ReactNode;
    appOptions: Props;
    resolve(app: unknown): void;
    reject(error: unknown): void;
}

interface RootOptions
{
    onInit?: (app: unknown) => void;
    onInitError?: (error: unknown) => void;
    destroyOptions?: FakeNodeDestroyOptions;
    rendererDestroyOptions?: unknown;
    onUncaughtError?: (error: unknown, info: unknown) => void;
    onCaughtError?: (error: unknown, info: unknown) => void;
    onRecoverableError?: (error: unknown, info: unknown) => void;
}

type Status = 'new' | 'initialising' | 'ready' | 'failed' | 'disposing' | 'disposed';

export interface FakeRoot extends RootLike
{
    readonly status: Status;
    readonly applicationState: ApplicationStateLike;
    readonly session: FakeSceneSession;
    render(children: ReactNode, options?: Props): Promise<unknown>;
    unmount(): Promise<void>;
    /** Teardown deferred by one microtask, cancelled by a StrictMode remount. */
    scheduleUnmount(): void;
    cancelScheduledUnmount(): void;
    updateOptions(options: RootOptions): void;
}

interface InternalRoot extends FakeRoot
{
    /** Destroy options for nodes removed now: the root's destroyOptions while it is tearing down. */
    teardownOptions(): FakeNodeDestroyOptions;
}

export interface FakeRuntime
{
    readonly api: ReactBindingApi;
    readonly journal: SceneJournal;
    readonly roots: ReadonlySet<FakeRoot>;
    tagFor(name: string): string;
}

const TAG_PREFIX = 'fake';

/** Scene faults plus faults of the fake React runtime itself. */
export interface FakeRuntimeFaults extends FakeSceneFaults
{
    /** `<Application>` does not handle a rejected render, so an init failure becomes an unhandled rejection. */
    leakInitRejection?: boolean;
}

export interface FakeRuntimeOptions
{
    faults?: FakeRuntimeFaults;
    kindOf?: (ctor: Constructor) => string;
    interceptInit?: (init: () => Promise<void>) => Promise<void>;
}

export function createFakeRuntime(journal: SceneJournal, options: FakeRuntimeOptions = {}): FakeRuntime
{
    const { faults = {}, kindOf, interceptInit } = options;
    const catalog = new Map<string, Constructor>();
    const rootsByTarget = new Map<Element, InternalRoot>();
    const roots = new Set<InternalRoot>();
    const pendingDestroy: Array<{ session: FakeSceneSession; node: FakeContainer; options: FakeNodeDestroyOptions }> = [];
    let currentUpdatePriority: number = NoEventPriority;

    const extend = (objects: Record<string, Constructor>) =>
    {
        for (const [name, ctor] of Object.entries(objects))
        {
            const existing = catalog.get(name);

            if (existing && existing !== ctor)
            {
                throw new Error(`REGISTRY_CONFLICT: "${name}" is already registered with another constructor`);
            }

            catalog.set(name, ctor);
        }
    };

    const resolve = (type: string) =>
    {
        const name = type.startsWith(TAG_PREFIX) ? type.slice(TAG_PREFIX.length) : type;
        const ctor = catalog.get(name);

        if (!ctor)
        {
            throw new Error(`UNKNOWN_ELEMENT: "${name}" is not registered; call extend({ ${name} }) first`);
        }

        return { name, ctor };
    };

    const queueRemoval = (container: RootContainer, parent: FakeContainer, child: FakeContainer) =>
    {
        container.session.remove(parent, child);
        pendingDestroy.push({ session: container.session, node: child, options: container.root.teardownOptions() });
    };

    const sessionlessUpdater = { update: (node: object, previous: Props, next: Props) => applyFakeProps(node, previous, next, faults) };

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
        rendererPackageName: '@pixi-react-provisional/conformance-fake',
        rendererVersion: '0.0.0',

        createInstance(type: string, props: Props, container: RootContainer)
        {
            return container.session.create(resolve(type), props);
        },
        createTextInstance(text: string)
        {
            throw new Error(`Raw text "${text}" cannot be rendered in the scene; use a Text component`);
        },
        appendInitialChild: (parent: FakeContainer, child: FakeContainer) => parent.addChild(child),
        finalizeInitialChildren: () => false,
        shouldSetTextContent: () => false,
        getRootHostContext: () => ({}),
        getChildHostContext: (context: object) => context,
        getPublicInstance: (instance: unknown) => instance,
        prepareForCommit: () => null,
        resetAfterCommit()
        {
            // Destruction happens after the commit, each removed subtree exactly once.
            for (const { session, node, options } of pendingDestroy.splice(0))
            {
                session.destroySubtree(node, options);
            }
        },
        preparePortalMount: () => undefined,
        appendChild: (parent: FakeContainer, child: FakeContainer) => parent.addChild(child),
        appendChildToContainer: (container: RootContainer, child: FakeContainer) =>
            container.session.append(container.session.container, child),
        insertBefore(parent: FakeContainer, child: FakeContainer, before: FakeContainer)
        {
            if (child.parent === parent)
            {
                parent.removeChild(child);
            }

            parent.addChild(child, parent.children.indexOf(before));
        },
        insertInContainerBefore: (container: RootContainer, child: FakeContainer, before: FakeContainer) =>
            container.session.insertBefore(container.session.container, child, before),
        removeChild(parent: FakeContainer, child: FakeContainer)
        {
            const root = [...roots].find((candidate) => candidate.session.app.stage === rootOf(parent));

            if (root)
            {
                queueRemoval({ session: root.session, root }, parent, child);
            }
        },
        removeChildFromContainer: (container: RootContainer, child: FakeContainer) =>
            queueRemoval(container, container.session.container, child),
        commitUpdate(instance: FakeContainer, _type: string, previous: Props, next: Props)
        {
            const root = [...roots].find((candidate) => candidate.session.app.stage === rootOf(instance));

            (root?.session ?? sessionlessUpdater).update(instance, previous, next);
        },
        hideInstance: (instance: FakeContainer) => sessionFor(instance)?.setHidden(instance, true),
        unhideInstance: (instance: FakeContainer) => sessionFor(instance)?.setHidden(instance, false),
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

    function rootOf(node: FakeContainer): FakeContainer
    {
        let current = node;

        while (current.parent)
        {
            current = current.parent;
        }

        return current;
    }

    function sessionFor(node: FakeContainer)
    {
        const stage = rootOf(node);

        return [...roots].find((candidate) => candidate.session.app.stage === stage)?.session;
    }

    const reconciler = (createReconciler as unknown as (config: unknown) => any)(hostConfig);
    const Context = createContext<ApplicationStateLike | null>(null);

    function createRoot(target: HTMLElement | HTMLCanvasElement, options: RootOptions = {}): InternalRoot
    {
        const existing = rootsByTarget.get(target);

        if (existing)
        {
            existing.updateOptions(options);

            return existing;
        }

        let canvas: HTMLCanvasElement;

        if (target instanceof HTMLCanvasElement)
        {
            canvas = target;
        }
        else
        {
            canvas = document.createElement('canvas');
            target.replaceChildren(canvas);
        }

        let rootOptions = options;
        let status: Status = 'new';
        let initPromise: Promise<void> | null = null;
        let teardown: Promise<void> | null = null;
        let scheduled = false;
        const pending: RenderRequest[] = [];
        const session = new FakeSceneSession({ journal, faults, kindOf, interceptInit });
        let applicationState: ApplicationStateLike = { app: session.app, isInitialised: false, isInitialising: false };

        const report = (key: 'onUncaughtError' | 'onCaughtError' | 'onRecoverableError') =>
            (error: unknown, info: unknown) => (rootOptions[key] ?? console.error)(error, info);

        const fiber = reconciler.createContainer(
            { session, root: null },
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

        // Commits synchronously from the caller's job (no await in between), so a commit that follows
        // initialization joins the act scope that is waiting for onInit, exactly like the facade.
        const commitRequest = ({ children, appOptions, resolve }: RenderRequest) =>
        {
            session.updateApplication({ resizeTo: (appOptions.resizeTo as HTMLElement | null | undefined) ?? null });
            reconciler.updateContainer(
                <Context.Provider value={applicationState}>{children}</Context.Provider>,
                fiber,
                null,
                () => resolve(session.app),
            );
        };

        const rejectPending = (error: unknown) =>
        {
            for (const request of pending.splice(0))
            {
                request.reject(error);
            }
        };

        const startInit = (appOptions: Props) =>
        {
            const { resizeTo: _resizeTo, ...initOptions } = appOptions;

            status = 'initialising';
            applicationState = { ...applicationState, isInitialising: true };
            initPromise = session.init(initOptions).then(
                () =>
                {
                    if (status !== 'initialising')
                    {
                        rejectPending(new Error('ROOT_DISPOSED: the root was unmounted before initialization finished'));

                        return;
                    }

                    status = 'ready';
                    applicationState = { app: session.app, isInitialised: true, isInitialising: false };
                    rootOptions.onInit?.(session.app);
                    pending.splice(0).forEach(commitRequest);
                },
                (error: unknown) =>
                {
                    if (status === 'initialising')
                    {
                        status = 'failed';
                        rootOptions.onInitError?.(error);
                    }

                    rejectPending(error);
                },
            );
        };

        const root: InternalRoot = {
            get status()
            {
                return status;
            },
            get applicationState()
            {
                return applicationState;
            },
            session,
            teardownOptions: () => (status === 'disposing' ? rootOptions.destroyOptions ?? {} : {}),
            updateOptions(next)
            {
                rootOptions = { ...rootOptions, ...next };
            },
            render(children, appOptions = {})
            {
                // Requests are committed in call order; each promise resolves after its own commit.
                return new Promise<unknown>((resolve, reject) =>
                {
                    const request = { children, appOptions, resolve, reject };

                    if (status === 'ready')
                    {
                        commitRequest(request);
                    }
                    else if (status === 'new' || status === 'initialising')
                    {
                        pending.push(request);

                        if (status === 'new')
                        {
                            startInit(appOptions);
                        }
                    }
                    else
                    {
                        reject(new Error(`ROOT_DISPOSED: cannot render into a ${status} root`));
                    }
                });
            },
            unmount()
            {
                scheduled = false;
                teardown ??= (async () =>
                {
                    const wasInitialising = status === 'initialising';

                    status = 'disposing';

                    if (wasInitialising)
                    {
                        await initPromise;
                    }

                    if (session.app.initialised)
                    {
                        reconciler.updateContainerSync(null, fiber, null, null);
                        reconciler.flushSyncWork();
                        session.destroy(rootOptions.rendererDestroyOptions, rootOptions.destroyOptions);
                    }

                    status = 'disposed';
                    roots.delete(root);
                    rootsByTarget.delete(target);
                    rootsByTarget.delete(canvas);
                })();

                return teardown;
            },
            scheduleUnmount()
            {
                scheduled = true;
                queueMicrotask(() =>
                {
                    if (scheduled)
                    {
                        void root.unmount();
                    }
                });
            },
            cancelScheduledUnmount()
            {
                scheduled = false;
            },
        };

        fiber.containerInfo.root = root;
        roots.add(root);
        rootsByTarget.set(target, root);
        rootsByTarget.set(canvas, root);

        return root;
    }

    const useApplication = (): ApplicationStateLike =>
    {
        const state = useContext(Context);

        if (!state)
        {
            throw new Error('useApplication must be used inside <Application>');
        }

        return state;
    };

    const useTick = (options: ((tick: unknown) => void) | TickOptionsLike) =>
    {
        const { app, isInitialised } = useApplication();
        const normalized: TickOptionsLike = typeof options === 'function' ? { callback: options } : options;
        const { callback, context, isEnabled = true, priority = 0 } = normalized;
        const root = [...roots].find((candidate) => candidate.session.app === app);

        useLayoutEffect(() =>
        {
            if (!isInitialised || !root)
            {
                return undefined;
            }

            return root.session.subscribe({ callback, context, isEnabled, priority });
        }, [root, isInitialised, callback, context, isEnabled, priority]);
    };

    const useExtend = (objects: Record<string, Constructor>) =>
    {
        useMemo(() => extend(objects), [objects]);
    };

    interface ApplicationProps extends Props
    {
        children?: ReactNode;
        className?: string;
        onInit?: (app: unknown) => void;
        onInitError?: (error: unknown) => void;
        destroyOptions?: FakeNodeDestroyOptions;
        rendererDestroyOptions?: unknown;
        resizeTo?: HTMLElement | RefObject<HTMLElement | null> | null;
    }

    const ApplicationInner = forwardRef<unknown, ApplicationProps>(function ApplicationInner(props, ref)
    {
        const { children, className, onInit, onInitError, destroyOptions, rendererDestroyOptions, resizeTo, ...appOptions } = props;
        const Bridge = useContextBridge();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const rootRef = useRef<FakeRoot | null>(null);
        const latest = useRef(props);

        latest.current = props;

        useImperativeHandle(ref, () => ({
            getApplication: () => (rootRef.current?.applicationState.isInitialised ? rootRef.current.applicationState.app : null),
            getCanvas: () => canvasRef.current,
        }));

        useLayoutEffect(() =>
        {
            const root = createRoot(canvasRef.current!, {
                onInit: (app) => latest.current.onInit?.(app),
                onInitError: (error) => latest.current.onInitError?.(error),
            });

            root.cancelScheduledUnmount();
            rootRef.current = root;

            return () => root.scheduleUnmount();
        }, []);

        useLayoutEffect(() =>
        {
            const root = rootRef.current!;

            root.updateOptions({ destroyOptions, rendererDestroyOptions });
            const target = resizeTo && 'current' in resizeTo ? resizeTo.current : resizeTo;

            // Errors are delivered through onInitError / the root callbacks, never as unhandled rejections.
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
        api: {
            Application,
            createRoot: (target, options) => createRoot(target, options as RootOptions),
            extend,
            useExtend,
            useApplication,
            useTick,
            applyProps: (instance, props) =>
            {
                sessionlessUpdater.update(instance, {}, props);

                return instance;
            },
        },
        journal,
        roots,
        tagFor: (name) => `${TAG_PREFIX}${name}`,
    };
}
