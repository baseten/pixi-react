/**
 * Scene-neutral ABI 1 types. Nothing here names React, a reconciler, its-fine or Pixi: a scene adapter supplies
 * its own types through `SceneTypes`, and a framework adapter substitutes them into its `BindingFamily`.
 */

/** Any constructor a catalog can hold. `never[]` parameters accept constructors with any argument list. */
export type Constructor = new (...args: never[]) => object;

export type Catalog = Readonly<Record<string, Constructor>>;

/** Capability IDs (namespaced strings such as `scene.mutation`) mapped to integer protocol versions. */
export type CapabilityMap = Readonly<Record<string, number>>;

/** Higher-kinded constructor-to-props mapping, supplied by the scene adapter. */
export interface PropsFamily
{
    readonly constructorType: unknown;
    readonly type: unknown;
}

export type PropsOf<S extends SceneTypes, C extends Constructor> =
    (S['props'] & { readonly constructorType: C })['type'];

/** The types one scene adapter works with. */
export interface SceneTypes
{
    readonly node: object;
    readonly app: object;
    /** Options for initializing the application. */
    readonly options: object;
    /** Mutable application props applied after initialization. */
    readonly appProps: object;
    /** Options for destroying the application. */
    readonly destroy: object;
    /** Options forwarded to the session when it destroys one node. */
    readonly nodeDestroy: unknown;
    /** What a ticker subscription receives. */
    readonly tick: unknown;
    readonly props: PropsFamily;
}

/** How a node joins a parent. Open strings, e.g. role `child`, `filter` or `particle`; the scene interprets them. */
export interface AttachRule
{
    readonly role: string;
    /** Roles accepted as children; empty for a leaf. Checked before any mutation. */
    readonly accepts: readonly string[];
}

/**
 * Descriptive metadata only: no create/update/destroy. The `SceneSession` is the single owner of node
 * construction, update and destruction.
 */
export interface NodeDefinition<C extends Constructor = Constructor>
{
    /** Normalized catalog name. From `component(Ctor)`: the explicit name, else a WeakMap-assigned id; never `Ctor.name`. */
    readonly name: string;
    readonly ctor: C;
    /** Scene capability IDs and protocol versions this node needs; validated before its first construction. */
    readonly capabilities: CapabilityMap;
    readonly attach: AttachRule;
}

export interface ApplicationState<A>
{
    readonly app: A;
    readonly isInitialised: boolean;
    readonly isInitialising: boolean;
}

export interface TickOptions<T, Context = unknown>
{
    callback: (this: Context, tick: T) => void;
    context?: Context;
    isEnabled?: boolean;
    priority?: number;
}

/**
 * Open higher-kinded family: the framework substitutes the scene type into its API. A family declares
 * `readonly type: MyBindings<this['scene']>`. `scene` is constrained to `SceneTypes` (the ABI sketch had
 * `unknown`) so that `this['scene']` needs no `Extract` and an adapter's generic `bind` type-checks without casts.
 */
export interface BindingFamily
{
    readonly scene: SceneTypes;
    readonly type: unknown;
}

export type Bind<F extends BindingFamily, S extends SceneTypes> = (F & { readonly scene: S })['type'];

/** The ABI protocol version an adapter implements. Independent of npm package versions. */
export interface AbiVersion
{
    readonly major: 1;
    readonly minor: number;
}

export interface AdapterManifest
{
    readonly abi: AbiVersion;
    /** Stable adapter ID, e.g. `pixi-8` or `community.inspector`. Not restricted to a known set. */
    readonly id: string;
    readonly packageVersion: string;
    readonly provides: CapabilityMap;
    readonly requires: CapabilityMap;
    /** Pointer to the exact tested tuple/feature record this adapter is certified against. */
    readonly certification: string;
}

/** Registry conflict policy. `reject` is the contract; `replace` is upstream `extend` behaviour (D4). */
export type RegistryConflictPolicy = 'reject' | 'replace';

export interface RendererOptions
{
    /** Capabilities the consumer needs from the composed pair; validated before anything is allocated. */
    readonly requiredCapabilities?: CapabilityMap;
    /**
     * What `extend`/`register` do when a name is already bound to a different constructor. Defaults to
     * `reject` (`REGISTRY_CONFLICT`). The default facade selects `replace` for upstream parity (D4).
     */
    readonly registryConflict?: RegistryConflictPolicy;
    /**
     * Receives errors that have no caller to reject: a throwing `onInit`/`onInitError` hook or a deferred
     * teardown that failed. Defaults to `console.error`.
     */
    readonly onUnhandledError?: (error: unknown) => void;
}
