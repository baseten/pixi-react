import type { ComponentType, ReactNode, Ref, RefObject } from 'react';
import type { AdapterManifest, ApplicationState, BindingFamily, Catalog, Constructor, PropsOf, Runtime, SceneTypes, TickOptions } from './core.js';
import { FrameworkAdapter } from './core.js';
export interface RootErrors {
    onUncaughtError?: (error: unknown, info: { componentStack?: string | null }) => void;
    onCaughtError?: (error: unknown, info: { componentStack?: string | null }) => void;
    onRecoverableError?: (error: unknown, info: { componentStack?: string | null }) => void;
}
export interface ApplicationRef<A> { getApplication(): A | null; getCanvas(): HTMLCanvasElement | null }
export interface Root<S extends SceneTypes> {
    readonly applicationState: ApplicationState<S['app']>;
    readonly status: 'new' | 'initialising' | 'ready' | 'failed' | 'disposing' | 'disposed';
    render(children: ReactNode, options?: S['options']): Promise<S['app']>;
    unmount(): Promise<void>;
}
export type RootOptions<S extends SceneTypes> = S['destroy'] & RootErrors & {
    onInit?: (app: S['app']) => void;
    onInitError?: (error: unknown) => void;
    identifierPrefix?: string;
};
export type ApplicationProps<S extends SceneTypes> = Omit<S['appProps'], 'resizeTo'> & RootOptions<S> & {
    children?: ReactNode;
    className?: string;
    resizeTo?: HTMLElement | Window | RefObject<HTMLElement | null>;
    ref?: Ref<ApplicationRef<S['app']>>;
};
export type ElementProps<S extends SceneTypes, C extends Constructor> = PropsOf<S, C> & {
    ref?: Ref<InstanceType<C>>;
    children?: ReactNode;
};
export interface ReactBindings<S extends SceneTypes> {
    Application: ComponentType<ApplicationProps<S>>;
    createRoot(target: HTMLElement | HTMLCanvasElement, options?: RootOptions<S>): Root<S>;
    extend<C extends Catalog>(catalog: C): void;
    useExtend<C extends Catalog>(catalog: C): void;
    useApplication(): ApplicationState<S['app']>;
    useTick<C = unknown>(options: ((tick: S['tick']) => void) | TickOptions<S['tick'], C>): void;
    applyProps<C extends Constructor>(instance: InstanceType<C>, props: PropsOf<S, C>): InstanceType<C>;
    /** Local component route preserves selected scene props without global JSX augmentation. */
    component<C extends Constructor>(ctor: C): ComponentType<ElementProps<S, C>>;
    /** Called inside the parent React tree; wraps a separate reconciler root. */
    useContextBridge(): ComponentType<{ children?: ReactNode }>;
}
export interface React19Family extends BindingFamily { readonly type: ReactBindings<Extract<this['scene'], SceneTypes>> }
export declare class React19Adapter extends FrameworkAdapter<React19Family> {
    readonly manifest: AdapterManifest;
    bind<S extends SceneTypes>(runtime: Runtime<S>): ReactBindings<S>;
}
