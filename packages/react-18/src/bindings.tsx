/**
 * The React 18 bindings: roots, `Application`, hooks, `component`, the context bridge. They are generic over the
 * Pixi types: nothing here knows a Pixi adapter's node or application types, and every scene operation goes through
 * core (the runtime registry and the root's `PixiBridge`).
 *
 * React 18 differences this module owns (compared with the React 19 epochs):
 * - roots have one error channel, `onRecoverableError`; `onCaughtError` / `onUncaughtError` are rejected;
 * - refs reach `Application` and `component(Ctor)` components through `forwardRef`, not as a prop;
 * - the context bridge is its-fine 1.x (an exact dependency), the line that supports React 18;
 * - there is no Activity, so no parent-Activity bridge.
 */
import { FiberProvider, useContextBridge as useItsFineContextBridge } from 'its-fine';
import {
    type ComponentType,
    createContext,
    createElement,
    type ForwardedRef,
    forwardRef,
    type ReactNode,
    type RefObject,
    useContext,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
import { unsupportedOptionError } from './host.js';
import {
    type ApplicationState,
    type Catalog,
    CompatibilityError,
    type Constructor,
    type PixiTypes,
    type RootRecord,
    type RootTarget,
    type Runtime,
    type TickOptions,
} from '@pixi-react-provisional/core';

import type { HostContainer, ReconcilerRoot, RecoverableErrorInfoLike, RootCallbacks, SceneRenderer } from './host.js';
import type { ApplicationProps, ApplicationRef, ReactBindings, Root, RootOptions } from './types.js';

export interface BindingsConfig<S extends PixiTypes>
{
    readonly adapterId: string;
    readonly renderer: SceneRenderer<S>;
}

/** What a scene root provides to its tree. `token` is the runtime's identity, checked by the hooks. */
interface RootContextValue
{
    readonly token: symbol;
    readonly record: RootRecord<PixiTypes>;
    readonly state: ApplicationState<unknown>;
}

/**
 * One context per loaded package copy, shared by every runtime it binds. A value carries its runtime token, so a
 * hook of one runtime rejects the provider of another instead of returning a foreign application.
 */
const RootContext = createContext<RootContextValue | null>(null);

RootContext.displayName = 'PixiReactRootContext';

/** React keys of root and Application options; every other root option is a scene destroy option. */
const ROOT_OPTION_KEYS = new Set(['onInit', 'onInitError', 'onRecoverableError', 'identifierPrefix']);

/** React 19 root options a React 18 root cannot honour. Passing one throws; it is never silently ignored. */
const REACT_19_ROOT_OPTIONS = ['onCaughtError', 'onUncaughtError'] as const;

/**
 * The Application props that carry the scene's destroy options. These are the upstream channel names
 * (`destroyOptions`, `rendererDestroyOptions`); `createRoot` takes the scene's destroy options as its own keys.
 */
const APPLICATION_DESTROY_KEYS = ['destroyOptions', 'rendererDestroyOptions'] as const;

/** The default root error channel: console reporting, as in the baseline. */
function reportToConsole(error: unknown): void
{
    console.error(error);
}

/** Throws for a React 19-only root option with a defined value. */
function rejectReact19Options(adapterId: string, options: object): void
{
    for (const key of REACT_19_ROOT_OPTIONS)
    {
        if ((options as Record<string, unknown>)[key] !== undefined)
        {
            throw unsupportedOptionError(adapterId, key);
        }
    }
}

function splitRootOptions<S extends PixiTypes>(options: RootOptions<S>): { root: RootOptions<S>; destroy: S['destroy'] }
{
    const destroy: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(options))
    {
        if (!ROOT_OPTION_KEYS.has(key))
        {
            destroy[key] = value;
        }
    }

    return { root: options, destroy: destroy as S['destroy'] };
}

/** A root plus the internal controls `Application` needs. */
interface InternalRoot<S extends PixiTypes> extends Root<S>
{
    readonly record: RootRecord<S>;
    /** Replaces the callbacks and destroy options (merged; `undefined` values clear a key). */
    configure(options: RootOptions<S>): void;
    /** StrictMode-safe unmount: tears down after one scheduled turn unless the root is mounted again. */
    scheduleUnmount(): void;
    /** Cancels a scheduled unmount (the StrictMode remount). */
    cancelScheduledUnmount(): void;
}

export function createBindings<S extends PixiTypes>(runtime: Runtime<S>, config: BindingsConfig<S>): ReactBindings<S>
{
    const { renderer, adapterId } = config;
    const roots = new WeakMap<RootRecord<S>, InternalRoot<S>>();

    function getOrCreateRoot(target: RootTarget, options: RootOptions<S>): { root: InternalRoot<S>; existed: boolean }
    {
        // Before anything is allocated: a React 19 root option is an explicit error on React 18.
        rejectReact19Options(adapterId, options);

        // Core maps the target and its canvas to one root record, and rejects targets another runtime owns.
        const record = runtime.createRoot(target);
        const existing = roots.get(record);

        if (existing)
        {
            existing.configure(options);

            return { root: existing, existed: true };
        }

        let current = splitRootOptions<S>(options);
        const callbacks: RootCallbacks = {
            onRecoverableError(error: unknown, info: RecoverableErrorInfoLike)
            {
                const callback = current.root.onRecoverableError;

                if (callback)
                {
                    callback(error, info);
                }
                else
                {
                    reportToConsole(error);
                }
            },
        };
        const container: HostContainer<S> = { runtime, record };
        const reconcilerRoot: ReconcilerRoot = renderer.createRoot(container, callbacks, current.root.identifierPrefix ?? '');

        record.setHooks({
            onInit: (app) => current.root.onInit?.(app),
            onInitError: (error) => current.root.onInitError?.(error),
        });
        // Core runs this first when the root tears down, so nodes removed here get the root's destroy options.
        record.onTeardown(() => reconcilerRoot.unmountSync());

        const root: InternalRoot<S> = {
            record,
            get applicationState()
            {
                return record.applicationState;
            },
            get status()
            {
                return record.status;
            },
            render(children, options)
            {
                const { resizeTo, ...initOptions } = (options ?? {}) as Record<string, unknown>;

                // The first request initializes; later options are mutable application props only. The init
                // promise is pre-handled by core; a failure rejects this request through `schedule`.
                void record.initialise(initOptions as S['options']);

                // Runs after onInit, in call order, never on a failed or disposing root. Resolves after this
                // request's own commit; core rejects it with ROOT_DISPOSED if teardown starts first.
                return record.schedule((app) => new Promise<S['app']>((resolve) =>
                {
                    record.pixi.updateApplication((options === undefined || !('resizeTo' in options)
                        ? initOptions
                        : { ...initOptions, resizeTo }) as S['appProps']);
                    reconcilerRoot.update(
                        <RootContext.Provider
                            value={{ token: runtime.id, record: record as RootRecord<PixiTypes>, state: record.applicationState }}
                        >
                            {children}
                        </RootContext.Provider>,
                        () => resolve(app),
                    );
                }));
            },
            unmount: () => record.dispose(current.destroy),
            configure(next)
            {
                rejectReact19Options(adapterId, next);
                current = splitRootOptions<S>({ ...current.root, ...next });
            },
            scheduleUnmount: () => record.deferDispose(current.destroy),
            cancelScheduledUnmount()
            {
                record.cancelDeferredDispose();
            },
        };

        roots.set(record, root);

        return { root, existed: false };
    }

    function createRoot(target: HTMLElement | HTMLCanvasElement, options: RootOptions<S> = {}): Root<S>
    {
        const { root, existed } = getOrCreateRoot(target, options);

        if (existed)
        {
            // Baseline behaviour: a second createRoot for the same target returns the existing root and warns.
            console.warn('createRoot should only be called once per target; returning the existing root.');
        }

        return root;
    }

    function useRootContext(hook: string): RootContextValue
    {
        const value = useContext(RootContext);

        if (!value)
        {
            throw new Error(`${hook} must be used inside an <Application> (or a createRoot tree) of this renderer.`);
        }

        if (value.token !== runtime.id)
        {
            throw new CompatibilityError(
                `${hook} was called inside an application of another renderer runtime. Use the hooks returned by the `
                + 'same createRenderer call as the <Application> that renders this component.',
                { code: 'react-18.FOREIGN_RUNTIME', adapterIds: [adapterId] },
            );
        }

        return value;
    }

    // The token check above guarantees this runtime's root provided the state.
    const useApplication = (): ApplicationState<S['app']> =>
        useRootContext('useApplication').state as ApplicationState<S['app']>;

    function useTick<C>(options: ((tick: S['tick']) => void) | TickOptions<S['tick'], C>): void
    {
        const { record, state } = useRootContext('useTick');
        const normalized: TickOptions<S['tick'], C> = typeof options === 'function' ? { callback: options } : options;
        const { callback, context, isEnabled = true, priority = 0 } = normalized;
        const isInitialised = state.isInitialised;

        useLayoutEffect(() =>
        {
            if (!isInitialised)
            {
                return undefined;
            }

            // The returned cleanup is idempotent and unregisters exactly this callback and context.
            return (record as RootRecord<S>).pixi.subscribe<C>({ callback, context, isEnabled, priority });
        }, [record, isInitialised, callback, context, isEnabled, priority]);
    }

    function extend(catalog: Catalog): void
    {
        runtime.registry.extend(catalog);
    }

    function useExtend(catalog: Catalog): void
    {
        // Registration persists until the runtime is disposed; it is not undone on unmount.
        useMemo(() => runtime.registry.extend(catalog), [catalog]);
    }

    function applyProps<N extends object>(instance: N, props: unknown): N
    {
        if (!runtime.pixi.applyProps)
        {
            throw new CompatibilityError(
                `Pixi adapter "${runtime.manifests.pixi.id}" has no standalone applyProps.`,
                { code: 'CAPABILITY_MISSING', adapterIds: [runtime.manifests.pixi.id] },
            );
        }

        runtime.pixi.applyProps(instance as S['node'], props);

        return instance;
    }

    const components = new Map<string, ComponentType<any>>();

    function component(ctor: Constructor, name?: string): ComponentType<any>
    {
        const { name: type } = runtime.registry.define(ctor, name);
        let Component = components.get(type);

        if (!Component)
        {
            // React 18 strips `ref` from function component props: forward it to the host element.
            const Element = forwardRef((props: Record<string, unknown>, ref: ForwardedRef<unknown>) =>
                createElement(type, { ...props, ref }));

            Element.displayName = type;
            Component = Element;
            components.set(type, Component);
        }

        return Component;
    }

    const ContextBridgeProvider = ({ children }: { children?: ReactNode }) => <FiberProvider>{children}</FiberProvider>;

    function useContextBridge(): ComponentType<{ children?: ReactNode }>
    {
        // its-fine 1.x returns a bridge of the providers above the nearest fiber; it needs a FiberProvider to find it.
        let bridge: ComponentType<{ children?: ReactNode }>;

        try
        {
            bridge = useItsFineContextBridge() as ComponentType<{ children?: ReactNode }>;
        }
        catch (error)
        {
            // its-fine throws before reading any hook state when there is no provider, so rethrowing is safe.
            if (error instanceof Error && error.message.includes('FiberProvider'))
            {
                throw new Error(
                    'useContextBridge must be called below a <ContextBridgeProvider> (Application includes one).',
                    { cause: error },
                );
            }

            throw error;
        }

        return bridge;
    }

    function resolveResizeTo(resizeTo: unknown): HTMLElement | Window | null
    {
        if (resizeTo && typeof resizeTo === 'object' && 'current' in resizeTo)
        {
            return (resizeTo as RefObject<HTMLElement | null>).current ?? null;
        }

        return (resizeTo as HTMLElement | Window | null | undefined) ?? null;
    }

    type ImplProps = ApplicationProps<S> & { forwardedRef: ForwardedRef<ApplicationRef<S['app']>> };

    function ApplicationImpl(props: ImplProps)
    {
        // Rendering throws for a React 19 root option, so the parent tree's error handling reports it.
        rejectReact19Options(adapterId, props);

        const {
            children,
            className,
            resizeTo,
            forwardedRef,
            onInit: _onInit,
            onInitError: _onInitError,
            onRecoverableError: _onRecoverableError,
            identifierPrefix: _identifierPrefix,
            destroyOptions: _destroyOptions,
            rendererDestroyOptions: _rendererDestroyOptions,
            ...appOptions
        } = props as ImplProps & { destroyOptions?: unknown; rendererDestroyOptions?: unknown };
        const Bridge = useItsFineContextBridge();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const rootRef = useRef<InternalRoot<S> | null>(null);
        const latest = useRef(props);

        latest.current = props;

        useImperativeHandle(forwardedRef, () => ({
            getApplication: () => (rootRef.current?.record.status === 'ready' ? rootRef.current.record.app : null),
            getCanvas: () => canvasRef.current,
        }), []);

        // Root callbacks always read the latest props; destroy options come from the upstream channel names.
        const rootOptions = (): RootOptions<S> =>
        {
            const options: Record<string, unknown> = {
                identifierPrefix: latest.current.identifierPrefix,
                onInit: (app: S['app']) => latest.current.onInit?.(app),
                // An initialization failure is delivered here, never as an unhandled rejection.
                onInitError: (error: unknown) => (latest.current.onInitError ?? reportToConsole)(error),
                onRecoverableError: (error: unknown, info: RecoverableErrorInfoLike) =>
                    (latest.current.onRecoverableError ?? reportToConsole)(error, info),
            };

            for (const key of APPLICATION_DESTROY_KEYS)
            {
                options[key] = (latest.current as Record<string, unknown>)[key];
            }

            return options as RootOptions<S>;
        };

        useLayoutEffect(() =>
        {
            const { root } = getOrCreateRoot(canvasRef.current!, rootOptions());

            // A remount before a scheduled teardown has run (the StrictMode effect replay) cancels it.
            root.cancelScheduledUnmount();
            rootRef.current = root;
        }, []);

        // Teardown is tied to an insertion effect, whose cleanup runs only when the component really unmounts
        // (StrictMode replays layout and passive effects, not insertion effects). It is still deferred by one turn,
        // so a remount of the same canvas in the same turn cancels it.
        useInsertionEffect(() => () =>
        {
            const root = rootRef.current;

            if (root)
            {
                root.configure(rootOptions());
                root.scheduleUnmount();
            }
        }, []);

        useLayoutEffect(() =>
        {
            const root = rootRef.current!;

            root.configure(rootOptions());

            // Rejections (INIT_FAILED, ROOT_DISPOSED) are already reported through onInitError or are the
            // expected end of an unmounted request: they never escape as unhandled rejections.
            root.render(
                <Bridge>{children}</Bridge>,
                { ...appOptions, resizeTo: resolveResizeTo(resizeTo) } as unknown as S['options'],
            ).catch(() => undefined);
        });

        return <canvas ref={canvasRef} className={className} />;
    }

    // React 18 does not pass `ref` as a prop: forward it to the imperative handle.
    const Application = forwardRef((props: ApplicationProps<S>, ref: ForwardedRef<ApplicationRef<S['app']>>) => (
        // The FiberProvider lets ApplicationImpl capture every context of the parent tree for its scene root.
        <FiberProvider>
            <ApplicationImpl {...props} forwardedRef={ref} />
        </FiberProvider>
    ));

    Application.displayName = 'Application';

    return {
        Application: Application as unknown as ComponentType<ApplicationProps<S>>,
        createRoot,
        extend,
        useExtend,
        useApplication,
        useTick,
        applyProps: applyProps as ReactBindings<S>['applyProps'],
        component: component as ReactBindings<S>['component'],
        useContextBridge,
        ContextBridgeProvider,
    };
}
