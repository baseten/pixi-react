import type { ComponentType, ReactNode, Ref, RefObject } from 'react';
import type { AdapterManifest, ApplicationState, Bind, ReactBindingFamily, Catalog, Constructor, PropsOf, Runtime, PixiTypes, TickOptions } from './core.js';
import { ReactAdapter } from './core.js';
export interface RootErrors {
    onUncaughtError?: (error: unknown, info: { componentStack?: string | null }) => void;
    onCaughtError?: (error: unknown, info: { componentStack?: string | null }) => void;
    onRecoverableError?: (error: unknown, info: { componentStack?: string | null }) => void;
}
export interface ApplicationRef<A> { getApplication(): A | null; getCanvas(): HTMLCanvasElement | null }
export interface Root<S extends PixiTypes> {
    readonly applicationState: ApplicationState<S['app']>;
    readonly status: 'new' | 'initialising' | 'ready' | 'failed' | 'disposing' | 'disposed';
    render(children: ReactNode, options?: S['options']): Promise<S['app']>;
    unmount(): Promise<void>;
}
export type RootOptions<S extends PixiTypes> = S['destroy'] & RootErrors & {
    onInit?: (app: S['app']) => void;
    onInitError?: (error: unknown) => void;
    identifierPrefix?: string;
};
export type ApplicationProps<S extends PixiTypes> = Omit<S['appProps'], 'resizeTo'> & RootOptions<S> & {
    children?: ReactNode;
    className?: string;
    resizeTo?: HTMLElement | Window | RefObject<HTMLElement | null>;
    ref?: Ref<ApplicationRef<S['app']>>;
};
export type ElementProps<S extends PixiTypes, C extends Constructor> = PropsOf<S, C> & {
    ref?: Ref<InstanceType<C>>;
    children?: ReactNode;
};
export interface ReactBindings<S extends PixiTypes> {
    Application: ComponentType<ApplicationProps<S>>;
    createRoot(target: HTMLElement | HTMLCanvasElement, options?: RootOptions<S>): Root<S>;
    extend<C extends Catalog>(catalog: C): void;
    useExtend<C extends Catalog>(catalog: C): void;
    useApplication(): ApplicationState<S['app']>;
    useTick<C = unknown>(options: ((tick: S['tick']) => void) | TickOptions<S['tick'], C>): void;
    applyProps<C extends Constructor>(instance: InstanceType<C>, props: PropsOf<S, C>): InstanceType<C>;
    /**
     * Local component route preserves selected scene props without global JSX augmentation.
     * The registered type name is `name` when given, else a WeakMap-assigned unique id; never `ctor.name`.
     */
    component<C extends Constructor>(ctor: C, name?: string): ComponentType<ElementProps<S, C>>;
    /** Called inside the parent React tree; wraps a separate reconciler root. */
    useContextBridge(): ComponentType<{ children?: ReactNode }>;
}
export interface React19Family extends ReactBindingFamily { readonly type: ReactBindings<Extract<this['pixi'], PixiTypes>> }
export declare class React19Adapter extends ReactAdapter<React19Family> {
    readonly manifest: AdapterManifest;
    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<React19Family, S>;
}
