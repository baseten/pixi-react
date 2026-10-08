/** Normative ABI v1 proposal; declarations only, not an implemented package. */
export type Constructor = new (...args: never[]) => object;
export type Catalog = Readonly<Record<string, Constructor>>;
export interface PropsFamily { readonly constructorType: Constructor; readonly type: unknown }
export type PropsOf<S extends SceneTypes, C extends Constructor> =
    (S['props'] & { readonly constructorType: C })['type'];
export interface SceneTypes {
    readonly node: object;
    readonly app: object;
    readonly options: object;
    readonly appProps: object;
    readonly destroy: object;
    readonly tick: unknown;
    readonly props: PropsFamily;
}
export interface AdapterManifest {
    readonly abi: { readonly major: 1; readonly minor: number };
    readonly id: string;
    readonly packageVersion: string;
    readonly provides: Readonly<Record<string, number>>;
    readonly requires: Readonly<Record<string, number>>;
    readonly certification: string;
}
export interface NodeDefinition<I extends object, P> {
    readonly kind: string;
    create(props: P): I;
    update(instance: I, previous: P, next: P): void;
    destroy(instance: I): void;
}
export interface Registry<S extends SceneTypes> {
    extend<C extends Catalog>(catalog: C): void;
    register<I extends S['node'], P>(name: string, definition: NodeDefinition<I, P>): void;
    resolve(name: string): NodeDefinition<S['node'], unknown>;
}
export interface ApplicationState<A> {
    readonly app: A;
    readonly isInitialised: boolean;
    readonly isInitialising: boolean;
}
export interface TickOptions<T, Context = unknown> {
    callback: (this: Context, tick: T) => void;
    context?: Context;
    isEnabled?: boolean;
    priority?: number;
}
export interface SceneSession<S extends SceneTypes> {
    readonly app: S['app'];
    readonly container: S['node'];
    init(options: S['options'], signal: AbortSignal): Promise<void>;
    updateApplication(props: S['appProps']): void;
    create(type: string, props: unknown): S['node'];
    update(node: S['node'], previous: unknown, next: unknown): void;
    append(parent: S['node'], child: S['node']): void;
    insertBefore(parent: S['node'], child: S['node'], before: S['node']): void;
    remove(parent: S['node'], child: S['node']): void;
    setHidden(node: S['node'], hidden: boolean): void;
    publicInstance(node: S['node']): object;
    subscribe<C>(options: TickOptions<S['tick'], C>): () => void;
    destroy(options: S['destroy']): Promise<void>;
}
export interface Runtime<S extends SceneTypes> {
    readonly registry: Registry<S>;
    readonly scene: SceneAdapter<S>;
    readonly id: symbol;
    dispose(): Promise<void>;
}
export declare abstract class SceneAdapter<S extends SceneTypes> {
    abstract readonly manifest: AdapterManifest;
    abstract createSession(runtime: Runtime<S>, target: HTMLElement | HTMLCanvasElement): SceneSession<S>;
    abstract describe<C extends Constructor>(ctor: C): NodeDefinition<InstanceType<C>, PropsOf<S, C>>;
}
/** Open higher-kinded family: the framework substitutes the scene type into its API. */
export interface BindingFamily { readonly scene: SceneTypes; readonly type: unknown }
export type Bind<F extends BindingFamily, S extends SceneTypes> = (F & { readonly scene: S })['type'];
export declare abstract class FrameworkAdapter<F extends BindingFamily> {
    abstract readonly manifest: AdapterManifest;
    abstract bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<F, S>;
}
export interface RendererOptions { readonly requiredCapabilities?: Readonly<Record<string, number>> }
