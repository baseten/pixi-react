/**
 * Public ABI 1 interfaces implemented by core (registry, runtime, roots) and by scene adapters (sessions).
 * Core types never mirror a framework's renderer signatures: a framework adapter translates between its own
 * renderer (for example a reconciler host config) and this protocol.
 */
import type { SceneAdapter } from './adapters.js';
import type {
    AdapterManifest,
    ApplicationState,
    AttachRule,
    CapabilityMap,
    Catalog,
    Constructor,
    NodeDefinition,
    SceneTypes,
    TickOptions,
} from './types.js';

export interface Registry<S extends SceneTypes>
{
    /** Registers raw constructors under their catalog keys. Same name + same constructor is idempotent. */
    extend<C extends Catalog>(catalog: C): void;
    /** The advanced descriptor route. Throws `REGISTRY_CONFLICT` (or replaces, under the `replace` policy). */
    register<C extends new (...args: never[]) => S['node']>(definition: NodeDefinition<C>): void;
    /** Throws `CompatibilityError` (`UNKNOWN_ELEMENT`) in every build, never a dev-only invariant. */
    resolve(name: string): NodeDefinition;
    /** Stable type name for `component(Ctor)`: `name` when given, else a per-runtime WeakMap-assigned unique id. */
    nameOf(ctor: Constructor, name?: string): string;
    /**
     * Registers `ctor` under `nameOf(ctor, name)` and returns its definition: the route behind a framework's
     * `component(Ctor, name?)`. An explicit name bound to another constructor always throws `REGISTRY_CONFLICT`.
     */
    define<C extends Constructor>(ctor: C, name?: string): NodeDefinition<C>;
    has(name: string): boolean;
}

/** Context handed to every node construction. A node never reaches for a global application. */
export interface NodeContext<S extends SceneTypes>
{
    readonly app: S['app'];
    readonly runtime: Runtime<S>;
    readonly root: RootRecord<S>;
}

/**
 * One application's lifecycle and scene bridge, implemented by a scene adapter. It is the single owner of node
 * construction and destruction. Core calls it only through a root's `SceneBridge`, which records ownership
 * in a WeakMap side table and guarantees each node is destroyed at most once.
 */
export interface SceneSession<S extends SceneTypes>
{
    readonly app: S['app'];
    /** The root display node children of the root are appended to. */
    readonly container: S['node'];
    /** Which child roles the container accepts. Without it, the container accepts every role. */
    readonly containerAttach?: AttachRule;
    init(options: S['options'], signal: AbortSignal): Promise<void>;
    updateApplication(props: S['appProps']): void;
    /** Sole construction path; per-node state goes in a WeakMap side table keyed by the node. */
    create(definition: NodeDefinition, props: unknown, context: NodeContext<S>): S['node'];
    update(node: S['node'], previous: unknown, next: unknown): void;
    /** Sole node destruction path; called exactly once per renderer-owned node. `undefined` means the scene default. */
    destroyNode(node: S['node'], options: S['nodeDestroy'] | undefined): void;
    append(parent: S['node'], child: S['node']): void;
    insertBefore(parent: S['node'], child: S['node'], before: S['node']): void;
    /** Detaches only; core destroys the subtree after the commit. */
    remove(parent: S['node'], child: S['node']): void;
    setHidden(node: S['node'], hidden: boolean): void;
    publicInstance(node: S['node']): object;
    subscribe<C>(options: TickOptions<S['tick'], C>): () => void;
    /** Node destroy options implied by the root's application destroy options, used for nodes torn down with it. */
    nodeDestroyOptions?(options: S['destroy'] | undefined): S['nodeDestroy'] | undefined;
    destroy(options: S['destroy'] | undefined): Promise<void> | void;
}

export type RootStatus = 'new' | 'initialising' | 'ready' | 'failed' | 'disposing' | 'disposed';

export type RootTarget = HTMLElement | HTMLCanvasElement;

/** Callbacks a framework adapter attaches to a root. They are replaced, not chained, by `setHooks`. */
export interface RootHooks<S extends SceneTypes>
{
    /** Runs once after a successful initialization, before any queued work is committed. */
    onInit?: (app: S['app']) => void;
    /** Runs once when the initialization rejects, with the scene's original error. */
    onInitError?: (error: unknown) => void;
}

/** A snapshot of one root's generation. `current` turns false once the root defers or begins teardown. */
export interface GenerationToken
{
    readonly generation: number;
    readonly current: boolean;
}

/** Scene operations of one root. Every node it touches must be owned by this root. */
export interface SceneBridge<S extends SceneTypes>
{
    /** Resolves `type` through the runtime registry and constructs the node through the session. */
    create(type: string | NodeDefinition, props: unknown): S['node'];
    update(node: S['node'], previous: unknown, next: unknown): void;
    /** Appends (or moves) `child`. Throws `UNSUPPORTED_NODE` before mutation when the attach rules reject it. */
    append(parent: S['node'], child: S['node']): void;
    insertBefore(parent: S['node'], child: S['node'], before: S['node']): void;
    /** Detaches `child` and queues its subtree for destruction at the next `flush`. Re-inserting it first cancels that. */
    remove(parent: S['node'], child: S['node']): void;
    /** Destroys every subtree removed since the last flush, children first, each node exactly once. */
    flush(): void;
    /** Destroys a detached subtree now (for nodes that were created but never attached). */
    destroy(node: S['node']): void;
    setHidden(node: S['node'], hidden: boolean): void;
    publicInstance(node: S['node']): object;
    /** Subscribes to the root's ticker. The returned cleanup is idempotent; teardown releases leftovers. */
    subscribe<C>(options: TickOptions<S['tick'], C>): () => void;
    updateApplication(props: S['appProps']): void;
}

/** Core's record of one root: target ownership, lifecycle state machine and scene bridge. */
export interface RootRecord<S extends SceneTypes>
{
    readonly id: number;
    readonly runtime: Runtime<S>;
    readonly target: RootTarget;
    readonly canvas: HTMLCanvasElement;
    readonly session: SceneSession<S>;
    readonly status: RootStatus;
    readonly generation: number;
    readonly app: S['app'];
    /** Stable for a given status, so a framework can pass it to a context provider. */
    readonly applicationState: ApplicationState<S['app']>;
    /** The initialization error once `status` is `failed`. */
    readonly failure: unknown;
    /** Aborted when the root starts tearing down. */
    readonly signal: AbortSignal;
    readonly scene: SceneBridge<S>;
    setHooks(hooks: RootHooks<S>): void;
    /**
     * Starts initialization on the first call; every call returns the same promise. Options of later calls
     * are ignored. Rejects with `INIT_FAILED` or `ROOT_DISPOSED`; the promise is pre-handled so an ignored
     * rejection is never reported as unhandled.
     */
    initialise(options: S['options']): Promise<S['app']>;
    /**
     * Runs `task` once the root is ready, after `onInit`, in call order. Rejects with `ROOT_DISPOSED` once
     * teardown starts and with `INIT_FAILED` after a failed initialization.
     */
    schedule<T>(task: (app: S['app']) => T | PromiseLike<T>): Promise<T>;
    token(): GenerationToken;
    /** Registers framework cleanup that runs (in reverse order) when the root tears down, before node and app cleanup. */
    onTeardown(hook: () => void | Promise<void>): () => void;
    /** Defers teardown by one scheduled turn so a StrictMode remount can cancel it. */
    deferDispose(options?: S['destroy']): void;
    /** Cancels a deferred teardown; returns whether one was pending. */
    cancelDeferredDispose(): boolean;
    /** Idempotent: every call returns the same promise. Rejects with `TeardownError` listing every failed step. */
    dispose(options?: S['destroy']): Promise<void>;
}

/** What core knows about a node it owns. A node with no entry is not owned by the runtime. */
export interface NodeInfo<S extends SceneTypes>
{
    readonly root: RootRecord<S>;
    readonly definition: NodeDefinition;
    readonly parent: S['node'] | null;
    readonly hidden: boolean;
    readonly destroyed: boolean;
}

export type RuntimeStatus = 'active' | 'disposing' | 'disposed';

export interface CreateRootOptions<S extends SceneTypes>
{
    readonly hooks?: RootHooks<S>;
}

/** One composed runtime: catalog, roots, node metadata and pending cleanup. Nothing is shared between runtimes. */
export interface Runtime<S extends SceneTypes>
{
    readonly id: symbol;
    readonly scene: SceneAdapter<S>;
    readonly registry: Registry<S>;
    readonly manifests: { readonly framework: AdapterManifest; readonly scene: AdapterManifest };
    /** Every capability either adapter provides, after negotiation. */
    readonly capabilities: CapabilityMap;
    readonly status: RuntimeStatus;
    /** A snapshot of the live roots. */
    roots(): readonly RootRecord<S>[];
    /**
     * Returns the root that owns `target` (as its target or canvas), creating it otherwise. An HTMLElement target
     * gets a new canvas that replaces its children. Throws `core.TARGET_LEASED` when another runtime owns it.
     */
    createRoot(target: RootTarget, options?: CreateRootOptions<S>): RootRecord<S>;
    rootFor(target: RootTarget): RootRecord<S> | undefined;
    nodeInfo(node: object): NodeInfo<S> | undefined;
    /** Registers runtime-level cleanup that runs after every root has torn down. */
    onDispose(cleanup: () => void | Promise<void>): () => void;
    /** Freezes new work, snapshots the roots, tears each down and aggregates failures. Idempotent. */
    dispose(): Promise<void>;
}
