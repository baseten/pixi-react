/**
 * The React-side bindings shared by every React 19 epoch: roots, `Application`, hooks, `component`, the context
 * bridge. They are generic over the Pixi types: nothing here knows a Pixi adapter's node or application types, and every
 * scene operation goes through core (the runtime registry and the root's `PixiBridge`).
 */
import { FiberProvider, useContextBridge as useItsFineContextBridge } from 'its-fine';
import {
    type ComponentType,
    createContext,
    createElement,
    type ReactNode,
    type RefObject,
    useContext,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
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

import type { EpochRenderer, EpochRoot, EpochRootCallbacks, HostContainer, RootErrorInfoLike } from './host.js';
import type { ApplicationProps, ReactBindings, Root, RootErrors, RootOptions } from './types.js';

/** A hook returning a component that forwards the parent tree's Activity visibility (React 19.2+). */
export type ParentActivityBridge = () => ComponentType<{ children?: ReactNode }>;

export interface BindingsConfig<S extends PixiTypes>
{
    readonly adapterId: string;
    readonly renderer: EpochRenderer<S>;
    readonly useParentActivity?: ParentActivityBridge;
}

/** What a scene root provides to its tree. `token` is the runtime's identity, checked by the hooks. */
interface RootContextValue
{
    readonly token: symbol;
    readonly record: RootRecord<PixiTypes>;
    readonly state: ApplicationState<unknown>;
}

/**
 * One context per loaded package copy, shared by every runtime it binds. A value carries its runtime token, so a hook
 * of one runtime rejects the provider of another instead of returning a foreign application.
 */
const RootContext = createContext<RootContextValue | null>(null);

RootContext.displayName = 'PixiReactRootContext';

/** React keys of root and Application options; every other root option is a scene destroy option. */
const ROOT_OPTION_KEYS = new Set([
    'onInit',
    'onInitError',
    'onUncaughtError',
    'onCaughtError',
    'onRecoverableError',
    'identifierPrefix',
]);

/**
 * The Application props that carry the scene's destroy options. These are the upstream channel names
 * (`destroyOptions`, `rendererDestroyOptions`); `createRoot` takes the scene's destroy options as its own keys.
 */
const APPLICATION_DESTROY_KEYS = ['destroyOptions', 'rendererDestroyOptions'] as const;

const ERROR_CHANNELS = ['onUncaughtError', 'onCaughtError', 'onRecoverableError'] as const;

/** The default root error channel: console reporting, as in the baseline. */
function reportToConsole(error: unknown): void
{
    console.error(error);
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
    const { renderer, useParentActivity } = config;
    const roots = new WeakMap<RootRecord<S>, InternalRoot<S>>();

    function getOrCreateRoot(target: RootTarget, options: RootOptions<S>): { root: InternalRoot<S>; existed: boolean }
    {
        // Core maps the target and its canvas to one root record, and rejects targets another runtime owns.
        const record = runtime.createRoot(target);
        const existing = roots.get(record);

        if (existing)
        {
            existing.configure(options);

            return { root: existing, existed: true };
        }

        let current = splitRootOptions<S>(options);
        const channel = (key: keyof RootErrors) => (error: unknown, info: RootErrorInfoLike) =>
        {
            const callback = current.root[key];

            if (callback)
            {
                callback(error, info);
            }
            else
            {
                reportToConsole(error);
            }
        };
        const callbacks: EpochRootCallbacks = {
            onUncaughtError: channel('onUncaughtError'),
            onCaughtError: channel('onCaughtError'),
            onRecoverableError: channel('onRecoverableError'),
        };
        const container: HostContainer<S> = { runtime, record };
        const epochRoot: EpochRoot = renderer.createRoot(container, callbacks, current.root.identifierPrefix ?? '');

        record.setHooks({
            onInit: (app) => current.root.onInit?.(app),
            onInitError: (error) => current.root.onInitError?.(error),
        });
        // Core runs this first when the root tears down, so nodes removed here get the root's destroy options.
        record.onTeardown(() => epochRoot.unmountSync());

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
                    epochRoot.update(
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
                { code: 'react-19.FOREIGN_RUNTIME', adapterIds: [config.adapterId] },
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
            // React 19 passes `ref` as a prop, so it reaches the host element unchanged.
            const Element = (props: Record<string, unknown>) => createElement(type, props);

            Element.displayName = type;
            Component = Element;
            components.set(type, Component);
        }

        return Component;
    }

    const ContextBridgeProvider = ({ children }: { children?: ReactNode }) => <FiberProvider>{children}</FiberProvider>;

    function useContextBridge(): ComponentType<{ children?: ReactNode }>
    {
        try
        {
            return useItsFineContextBridge();
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
    }

    function resolveResizeTo(resizeTo: unknown): HTMLElement | Window | null
    {
        if (resizeTo && typeof resizeTo === 'object' && 'current' in resizeTo)
        {
            return (resizeTo as RefObject<HTMLElement | null>).current ?? null;
        }

        return (resizeTo as HTMLElement | Window | null | undefined) ?? null;
    }

    // Returns `children` itself, never `<>{children}</>`: React unwraps only one unkeyed fragment at the top of a child
    // list, so a wrapper fragment here would take that unwrap and a keyed child would remount whenever the
    // Application's children became (or stopped being) a fragment around it. Upstream places the children directly
    // in a provider; the React 19.2+ Activity bridge places them directly in `<Activity>` (issue 51).
    const PassThrough = ({ children }: { children?: ReactNode }) => children;
    const useNoActivity = () => PassThrough;
    const useActivity = useParentActivity ?? useNoActivity;

    function ApplicationImpl(props: ApplicationProps<S>)
    {
        const {
            children,
            className,
            resizeTo,
            ref,
            onInit: _onInit,
            onInitError: _onInitError,
            onUncaughtError: _onUncaughtError,
            onCaughtError: _onCaughtError,
            onRecoverableError: _onRecoverableError,
            identifierPrefix: _identifierPrefix,
            destroyOptions: _destroyOptions,
            rendererDestroyOptions: _rendererDestroyOptions,
            ...appOptions
        } = props as ApplicationProps<S> & { destroyOptions?: unknown; rendererDestroyOptions?: unknown };
        const Bridge = useItsFineContextBridge();
        const Activity = useActivity();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const rootRef = useRef<InternalRoot<S> | null>(null);
        const latest = useRef(props);

        latest.current = props;

        useImperativeHandle(ref, () => ({
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
            };

            for (const key of ERROR_CHANNELS)
            {
                options[key] = (error: unknown, info: RootErrorInfoLike) =>
                    (latest.current[key] ?? reportToConsole)(error, info);
            }

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

        // Teardown is tied to an insertion effect: React disconnects layout and passive effects when an
        // <Activity> hides the Application (and replays them under StrictMode), but runs an insertion effect's
        // cleanup only when the component really unmounts. Hiding therefore keeps the scene and its state; the
        // teardown is still deferred by one turn, so a remount in the same turn cancels it.
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
                <Bridge><Activity>{children}</Activity></Bridge>,
                { ...appOptions, resizeTo: resolveResizeTo(resizeTo) } as unknown as S['options'],
            ).catch(() => undefined);
        });

        return <canvas ref={canvasRef} className={className} />;
    }

    function Application(props: ApplicationProps<S>)
    {
        // The FiberProvider lets ApplicationImpl capture every context of the parent tree for its scene root.
        return (
            <FiberProvider>
                <ApplicationImpl {...props} />
            </FiberProvider>
        );
    }

    return {
        Application,
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
