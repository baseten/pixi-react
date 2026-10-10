/**
 * Normative ABI v1 proposal; declarations only, not an implemented package.
 * Core types never mirror react-reconciler (or any React adapter) host-config/root signatures.
 */
export type Constructor = new (...args: never[]) => object;
export type Catalog = Readonly<Record<string, Constructor>>;
export interface PropsFamily { readonly constructorType: unknown; readonly type: unknown }
export type PropsOf<S extends PixiTypes, C extends Constructor> =
    (S['props'] & { readonly constructorType: C })['type'];
export interface PixiTypes {
    readonly node: object;
    readonly app: object;
    readonly options: object;
    readonly appProps: object;
    readonly destroy: object;
    /** Options forwarded to the session when it destroys one node. */
    readonly nodeDestroy: unknown;
    readonly tick: unknown;
    readonly props: PropsFamily;
}
export interface AdapterManifest {
    readonly abi: { readonly major: 1; readonly minor: number };
    readonly id: string;
    readonly packageVersion: string;
    readonly provides: Readonly<Record<string, number>>;
    readonly requires: Readonly<Record<string, number>>;
    readonly verification: string;
}
/** ABI-owned codes; adapters may add codes in their own dotted namespace. */
export type BuiltinCompatibilityErrorCode =
    | 'ABI_MISMATCH' | 'CAPABILITY_MISSING' | 'UNSUPPORTED_TUPLE'
    | 'UNKNOWN_ELEMENT' | 'UNSUPPORTED_NODE' | 'REGISTRY_CONFLICT'
    | 'ROOT_DISPOSED' | 'INIT_FAILED';
export type CompatibilityErrorCode = BuiltinCompatibilityErrorCode | `${string}.${string}`;
/** Named diagnostic values: protocol versions are numbers, package versions/ranges are strings. */
export type CompatibilityErrorValues = Readonly<Record<string, string | number | boolean | null>>;
export interface CompatibilityErrorDetails {
    readonly code: CompatibilityErrorCode;
    /** Manifest IDs of the adapters involved, not package-version objects. */
    readonly adapterIds: readonly string[];
    readonly capability?: string;
    readonly expected?: CompatibilityErrorValues;
    readonly actual?: CompatibilityErrorValues;
    readonly cause?: unknown;
}
/** One shared Error class for core and adapters; message is human-readable, code is stable. */
export declare class CompatibilityError extends Error implements CompatibilityErrorDetails {
    constructor(message: string, details: CompatibilityErrorDetails);
    readonly name: 'CompatibilityError';
    readonly code: CompatibilityErrorCode;
    readonly adapterIds: readonly string[];
    readonly capability?: string;
    readonly expected?: CompatibilityErrorValues;
    readonly actual?: CompatibilityErrorValues;
    readonly cause?: unknown;
}
/** How a node joins a parent. Open strings, e.g. role 'child' | 'filter' | 'particle'; the scene interprets them. */
export interface AttachRule {
    readonly role: string;
    /** Roles accepted as children; empty for a leaf. Checked before any mutation. */
    readonly accepts: readonly string[];
}
/**
 * Descriptive metadata only: no create/update/destroy. The PixiSession is the single owner of
 * node construction, update and destruction.
 */
export interface NodeDefinition<C extends Constructor = Constructor> {
    /** Normalized catalog name. From component(Ctor): the explicit name, else a WeakMap-assigned id; never Ctor.name. */
    readonly name: string;
    readonly ctor: C;
    /** Pixi capability IDs and protocol versions this node needs; validated before first construction. */
    readonly capabilities: Readonly<Record<string, number>>;
    readonly attach: AttachRule;
}
export interface Registry<S extends PixiTypes> {
    extend<C extends Catalog>(catalog: C): void;
    register<C extends new (...args: never[]) => S['node']>(definition: NodeDefinition<C>): void;
    /** Throws CompatibilityError (UNKNOWN_ELEMENT) in every build, never a dev-only invariant. */
    resolve(name: string): NodeDefinition;
    /** Stable type name for component(Ctor): `name` when given, else a per-runtime WeakMap-assigned unique id. */
    nameOf(ctor: Constructor, name?: string): string;
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
/** Context handed to every node construction. */
export interface NodeContext<S extends PixiTypes> {
    readonly app: S['app'];
    readonly runtime: Runtime<S>;
}
export interface PixiSession<S extends PixiTypes> {
    readonly app: S['app'];
    readonly container: S['node'];
    init(options: S['options'], signal: AbortSignal): Promise<void>;
    updateApplication(props: S['appProps']): void;
    /** Sole construction path; per-node state goes in a WeakMap side table keyed by the node. */
    create(definition: NodeDefinition, props: unknown, context: NodeContext<S>): S['node'];
    update(node: S['node'], previous: unknown, next: unknown): void;
    /** Sole node destruction path; called exactly once for renderer-owned nodes. */
    destroyNode(node: S['node'], options: S['nodeDestroy']): void;
    append(parent: S['node'], child: S['node']): void;
    insertBefore(parent: S['node'], child: S['node'], before: S['node']): void;
    remove(parent: S['node'], child: S['node']): void;
    setHidden(node: S['node'], hidden: boolean): void;
    publicInstance(node: S['node']): object;
    subscribe<C>(options: TickOptions<S['tick'], C>): () => void;
    destroy(options: S['destroy']): Promise<void>;
}
export interface Runtime<S extends PixiTypes> {
    readonly registry: Registry<S>;
    readonly pixi: PixiAdapter<S>;
    readonly id: symbol;
    dispose(): Promise<void>;
}
export declare abstract class PixiAdapter<S extends PixiTypes> {
    abstract readonly manifest: AdapterManifest;
    abstract createSession(runtime: Runtime<S>, target: HTMLElement | HTMLCanvasElement): PixiSession<S>;
    /** Pure metadata lookup; constructs nothing. Throws CompatibilityError (UNSUPPORTED_NODE) in every build. */
    abstract describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}
/** Open higher-kinded family: the React adapter substitutes the Pixi types into its API. */
export interface ReactBindingFamily { readonly pixi: unknown; readonly type: unknown }
export type Bind<F extends ReactBindingFamily, S extends PixiTypes> = (F & { readonly pixi: S })['type'];
export declare abstract class ReactAdapter<F extends ReactBindingFamily> {
    /** Type-only witness; concrete implementations use declare, emitting no field. */
    readonly bindingFamily: F;
    abstract readonly manifest: AdapterManifest;
    abstract bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<F, S>;
}
export interface RendererOptions { readonly requiredCapabilities?: Readonly<Record<string, number>> }
