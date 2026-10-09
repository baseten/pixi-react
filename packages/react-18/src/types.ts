/**
 * Public React 18 binding types. They name React and core types only: the Pixi adapter's types arrive through `S`,
 * so nothing here imports a scene library. They differ from the React 19 bindings where React 18 does: a root has
 * one error callback (`onRecoverableError`), and refs reach `Application` and `component(Ctor)` through
 * `forwardRef` rather than as a prop.
 *
 * These are the runtime binding types only. Global JSX tags for a React 18 composition are issue 11's entrypoint.
 */
import type { ComponentType, ReactNode, Ref, RefObject } from 'react';
import type {
    ApplicationState,
    Catalog,
    Constructor,
    PixiTypes,
    PropsOf,
    ReactBindingFamily,
    RootStatus,
    TickOptions,
} from '@pixi-react-provisional/core';

/** What React 18 passes to `onRecoverableError`. */
export interface RecoverableErrorInfo
{
    componentStack?: string | null;
    digest?: string | null;
}

/**
 * The one React 18 root error channel. It defaults to `console.error`. React 18 logs errors an error boundary
 * catches itself, and an uncaught render error unmounts the scene root and is rethrown, as in React DOM 18.
 * `onCaughtError` and `onUncaughtError` are React 19 options: a React 18 root rejects them with a
 * `CompatibilityError` (`CAPABILITY_MISSING`, capability `react.root-error-callbacks`).
 */
export interface RootErrors
{
    onRecoverableError?: (error: unknown, info: RecoverableErrorInfo) => void;
}

export interface ApplicationRef<A>
{
    getApplication(): A | null;
    getCanvas(): HTMLCanvasElement | null;
}

/** A React root over one core root record. */
export interface Root<S extends PixiTypes>
{
    readonly applicationState: ApplicationState<S['app']>;
    readonly status: RootStatus;
    /**
     * Initializes the application on the first call, then commits `children`. Resolves with the initialized app
     * after this request's own commit. Rejects with `INIT_FAILED` after a failed initialization and with
     * `ROOT_DISPOSED` when the root is unmounted before the request commits.
     */
    render(children: ReactNode, options?: S['options'] & Partial<S['appProps']>): Promise<S['app']>;
    /** Unmounts the tree and tears the root down. Idempotent: every call returns the same promise. */
    unmount(): Promise<void>;
}

/** Root options: the scene's application destroy options plus the React 18 root callbacks. */
export type RootOptions<S extends PixiTypes> = Partial<S['destroy']> & RootErrors & {
    /** Runs once after a successful initialization, before the first child commit. */
    onInit?: (app: S['app']) => void;
    /** Runs once when initialization rejects. */
    onInitError?: (error: unknown) => void;
    /** `useId` prefix of the root; read when the root is created. */
    identifierPrefix?: string;
};

export type ApplicationProps<S extends PixiTypes> =
    Omit<Partial<S['options']> & Partial<S['appProps']>, 'resizeTo' | 'children' | 'className' | 'ref'>
    & RootOptions<S>
    & {
        children?: ReactNode;
        className?: string;
        resizeTo?: HTMLElement | Window | RefObject<HTMLElement | null> | null;
        /** Forwarded with `forwardRef` (React 18 does not pass `ref` as a prop). */
        ref?: Ref<ApplicationRef<S['app']>>;
    };

export type ElementProps<S extends PixiTypes, C extends Constructor> = PropsOf<S, C> & {
    /** Forwarded with `forwardRef` to the scene node. React 18 calls a callback ref with `null` on detach. */
    ref?: Ref<InstanceType<C>>;
    children?: ReactNode;
};

/** The bindings `React18Adapter` returns from `bind(runtime)`. */
export interface ReactBindings<S extends PixiTypes>
{
    Application: ComponentType<ApplicationProps<S>>;
    createRoot(target: HTMLElement | HTMLCanvasElement, options?: RootOptions<S>): Root<S>;
    extend<C extends Catalog>(catalog: C): void;
    useExtend<C extends Catalog>(catalog: C): void;
    /** The nearest application of this runtime; throws outside one, or inside another runtime's tree. */
    useApplication(): ApplicationState<S['app']>;
    useTick<C = unknown>(options: ((tick: S['tick']) => void) | TickOptions<S['tick'], C>): void;
    applyProps<C extends Constructor>(instance: InstanceType<C>, props: PropsOf<S, C>): InstanceType<C>;
    /**
     * Registers `ctor` and returns a stable component for it. The type name is `name` when given, else the
     * constructor's `extend` key, else a per-runtime generated id; never `ctor.name`.
     */
    component<C extends Constructor>(ctor: C, name?: string): ComponentType<ElementProps<S, C>>;
    /**
     * Captures every context of the calling component's parent tree and returns a component that provides them
     * inside a separate root. Call it below an `Application` or a `ContextBridgeProvider`.
     */
    useContextBridge(): ComponentType<{ children?: ReactNode }>;
    /** Marks the part of a parent tree in which `useContextBridge` may be called. `Application` includes one. */
    ContextBridgeProvider: ComponentType<{ children?: ReactNode }>;
}

export interface React18Family extends ReactBindingFamily
{
    readonly type: ReactBindings<Extract<this['pixi'], PixiTypes>>;
}
