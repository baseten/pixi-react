/**
 * Public React 19 binding types, after `design/contract/react-19.d.ts`. They name React and core types only:
 * the scene's types arrive through `S`, so nothing here imports a scene library.
 */
import type { ComponentType, ReactNode, Ref, RefObject } from 'react';
import type {
    ApplicationState,
    BindingFamily,
    Catalog,
    Constructor,
    PropsOf,
    RootStatus,
    SceneTypes,
    TickOptions,
} from '@pixi-react-provisional/core';

/** What React passes to a root error callback. */
export interface RootErrorInfo
{
    componentStack?: string | null;
}

/** The three React 19 root error channels. Each defaults to `console.error`. */
export interface RootErrors
{
    onUncaughtError?: (error: unknown, info: RootErrorInfo) => void;
    onCaughtError?: (error: unknown, info: RootErrorInfo) => void;
    onRecoverableError?: (error: unknown, info: RootErrorInfo) => void;
}

export interface ApplicationRef<A>
{
    getApplication(): A | null;
    getCanvas(): HTMLCanvasElement | null;
}

/** A React root over one core root record. */
export interface Root<S extends SceneTypes>
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

/** Root options: the scene's application destroy options plus the React root callbacks. */
export type RootOptions<S extends SceneTypes> = Partial<S['destroy']> & RootErrors & {
    /** Runs once after a successful initialization, before the first child commit. */
    onInit?: (app: S['app']) => void;
    /** Runs once when initialization rejects. */
    onInitError?: (error: unknown) => void;
    /** `useId` prefix of the root; read when the root is created. */
    identifierPrefix?: string;
};

export type ApplicationProps<S extends SceneTypes> =
    Omit<Partial<S['options']> & Partial<S['appProps']>, 'resizeTo' | 'children' | 'className' | 'ref'>
    & RootOptions<S>
    & {
        children?: ReactNode;
        className?: string;
        resizeTo?: HTMLElement | Window | RefObject<HTMLElement | null> | null;
        ref?: Ref<ApplicationRef<S['app']>>;
    };

export type ElementProps<S extends SceneTypes, C extends Constructor> = PropsOf<S, C> & {
    ref?: Ref<InstanceType<C>>;
    children?: ReactNode;
};

/** The bindings a React 19 epoch returns from `bind(runtime)`. */
export interface ReactBindings<S extends SceneTypes>
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

export interface React19Family extends BindingFamily
{
    readonly type: ReactBindings<Extract<this['scene'], SceneTypes>>;
}
