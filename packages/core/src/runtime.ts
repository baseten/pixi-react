import { negotiate, type NegotiatedComposition, validateAdapterShape } from './abi.js';
import { CompatibilityError, TeardownError } from './errors.js';
import { acquireLeases, assertNotLeased, type LeaseHolder, releaseLeases } from './lease.js';
import { RuntimeRegistry } from './registry.js';
import { type NodeMeta, Root, type RuntimeInternals } from './root.js';

import type { FrameworkAdapter, SceneAdapter } from './adapters.js';
import type {
    CreateRootOptions,
    NodeInfo,
    RootRecord,
    RootTarget,
    Runtime,
    RuntimeStatus,
    SceneSession,
} from './contracts.js';
import type { AdapterManifest, BindingFamily, CapabilityMap, NodeDefinition, RendererOptions, SceneTypes } from './types.js';

const SESSION_METHODS = [
    'init',
    'updateApplication',
    'create',
    'update',
    'destroyNode',
    'append',
    'insertBefore',
    'remove',
    'setHidden',
    'publicInstance',
    'subscribe',
    'destroy',
] as const;

let runtimeCount = 0;

const noop = () => undefined;

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null;
}

function defaultReport(error: unknown): void
{
    console.error(error);
}

export interface RuntimeConfig<S extends SceneTypes>
{
    readonly scene: SceneAdapter<S>;
    readonly composition: NegotiatedComposition;
    readonly options?: RendererOptions;
}

class ComposedRuntime<S extends SceneTypes> implements Runtime<S>
{
    readonly id: symbol;
    readonly scene: SceneAdapter<S>;
    readonly registry: RuntimeRegistry<S>;
    readonly manifests: { readonly framework: AdapterManifest; readonly scene: AdapterManifest };
    readonly capabilities: CapabilityMap;

    #status: RuntimeStatus = 'active';
    #disposePromise: Promise<void> | undefined;
    #nextRootId = 0;
    readonly #byTarget = new Map<object, Root<S>>();
    readonly #roots = new Set<Root<S>>();
    readonly #nodes = new WeakMap<object, NodeMeta<S>>();
    readonly #disposeHooks = new Set<() => void | Promise<void>>();
    readonly #holder: LeaseHolder;
    readonly #internals: RuntimeInternals<S>;

    constructor({ scene, composition, options = {} }: RuntimeConfig<S>)
    {
        const label = `runtime ${++runtimeCount} (${composition.framework.id} + ${composition.scene.id})`;
        const adapterIds = Object.freeze([composition.framework.id, composition.scene.id]);
        const report = options.onUnhandledError ?? defaultReport;

        this.id = Symbol(label);
        this.scene = scene;
        this.manifests = Object.freeze({ framework: composition.framework, scene: composition.scene });
        this.capabilities = composition.capabilities;
        this.#holder = Object.freeze({ owner: this.id, description: label });
        this.registry = new RuntimeRegistry(scene, {
            policy: options.registryConflict ?? 'reject',
            adapterIds,
            assertActive: () => this.#assertActive('register constructors'),
        });
        this.#internals = {
            runtime: this,
            registry: this.registry,
            nodes: this.#nodes,
            capabilities: this.capabilities,
            adapterIds,
            checked: new WeakSet<NodeDefinition>(),
            report,
            release: (root) => this.#release(root),
            scheduleTurn: (callback) => queueMicrotask(callback),
        };
    }

    get status(): RuntimeStatus
    {
        return this.#status;
    }

    roots(): readonly RootRecord<S>[]
    {
        return [...this.#roots];
    }

    rootFor(target: RootTarget): RootRecord<S> | undefined
    {
        return this.#byTarget.get(target);
    }

    createRoot(target: RootTarget, options: CreateRootOptions<S> = {}): RootRecord<S>
    {
        this.#assertActive('create a root');

        if (!isRecord(target) || typeof (target as { nodeName?: unknown }).nodeName !== 'string')
        {
            throw new TypeError('createRoot() expects an HTMLElement or HTMLCanvasElement target.');
        }

        const existing = this.#byTarget.get(target);

        if (existing)
        {
            if (existing.isTornDown)
            {
                throw existing.disposedError(
                    'await its unmount() before creating a new root for the same target',
                );
            }

            if (options.hooks)
            {
                existing.setHooks(options.hooks);
            }

            return existing;
        }

        const isCanvas = target.nodeName.toUpperCase() === 'CANVAS';
        const canvas = (isCanvas ? target : target.ownerDocument.createElement('canvas')) as HTMLCanvasElement;
        const leased: object[] = isCanvas ? [target] : [target, canvas];

        if (!isCanvas)
        {
            // Replacing the target's children must not detach a canvas another runtime owns.
            assertNotLeased(Array.from(target.querySelectorAll('canvas')), this.#holder);
        }

        acquireLeases(leased, this.#holder);

        let root: Root<S>;

        try
        {
            const session = this.scene.createSession(this, canvas);

            this.#validateSession(session);
            root = new Root(this.#internals, ++this.#nextRootId, target, canvas, session, leased);
        }
        catch (error)
        {
            releaseLeases(leased, this.#holder);
            throw error;
        }

        if (!isCanvas)
        {
            // Baseline behaviour: a root created for an element replaces the element's children with its canvas.
            target.replaceChildren(canvas);
        }

        this.#roots.add(root);
        this.#byTarget.set(target, root);
        this.#byTarget.set(canvas, root);

        if (options.hooks)
        {
            root.setHooks(options.hooks);
        }

        return root;
    }

    nodeInfo(node: object): NodeInfo<S> | undefined
    {
        const meta = this.#nodes.get(node);

        if (!meta)
        {
            return undefined;
        }

        return Object.freeze({
            root: meta.root,
            definition: meta.definition,
            parent: meta.parent,
            hidden: meta.hidden,
            destroyed: meta.destroyed,
        });
    }

    onDispose(cleanup: () => void | Promise<void>): () => void
    {
        this.#assertActive('register runtime cleanup');

        const entry = () => cleanup();

        this.#disposeHooks.add(entry);

        return () =>
        {
            this.#disposeHooks.delete(entry);
        };
    }

    dispose(): Promise<void>
    {
        if (!this.#disposePromise)
        {
            this.#status = 'disposing';
            this.#disposePromise = this.#teardown();
            this.#disposePromise.catch(noop);
        }

        return this.#disposePromise;
    }

    async #teardown(): Promise<void>
    {
        const errors: unknown[] = [];
        // One bounded pass over a snapshot: no root can be added once disposing started.
        const snapshot = [...this.#roots];
        const results = await Promise.allSettled(snapshot.map((root) => root.dispose()));

        for (const result of results)
        {
            if (result.status === 'rejected')
            {
                errors.push(result.reason);
            }
        }

        for (const cleanup of [...this.#disposeHooks].reverse())
        {
            try
            {
                await cleanup();
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        this.#disposeHooks.clear();
        this.#status = 'disposed';

        if (errors.length)
        {
            throw new TeardownError(errors, `Disposing ${this.#holder.description} did not complete cleanly`);
        }
    }

    #assertActive(operation: string): void
    {
        if (this.#status !== 'active')
        {
            throw new CompatibilityError(`Cannot ${operation}: ${this.#holder.description} is ${this.#status}.`, {
                code: 'ROOT_DISPOSED',
                adapterIds: this.#internals?.adapterIds ?? [],
            });
        }
    }

    #validateSession(session: SceneSession<S>): void
    {
        const id = this.manifests.scene.id;

        if (!isRecord(session))
        {
            throw new CompatibilityError(`Scene adapter "${id}" returned no session from createSession().`, {
                code: 'ABI_MISMATCH',
                adapterIds: [id],
            });
        }

        for (const method of SESSION_METHODS)
        {
            if (typeof session[method] !== 'function')
            {
                throw new CompatibilityError(`The session of scene adapter "${id}" does not implement ${method}().`, {
                    code: 'ABI_MISMATCH',
                    adapterIds: [id],
                    expected: { [method]: 'function' },
                    actual: { [method]: typeof session[method] },
                });
            }
        }
    }

    #release(root: Root<S>): void
    {
        this.#roots.delete(root);

        for (const key of [root.target, root.canvas])
        {
            if (this.#byTarget.get(key) === root)
            {
                this.#byTarget.delete(key);
            }
        }

        releaseLeases(root.leased, this.#holder);
    }
}

/** Creates a runtime for an already negotiated composition. Prefer `compose`, which validates first. */
export function createRuntime<S extends SceneTypes>(config: RuntimeConfig<S>): Runtime<S>
{
    return new ComposedRuntime(config);
}

function checkEnvironment(adapter: { checkEnvironment?: unknown }, manifest: AdapterManifest): void
{
    if (typeof adapter.checkEnvironment !== 'function')
    {
        return;
    }

    try
    {
        adapter.checkEnvironment();
    }
    catch (error)
    {
        if (error instanceof CompatibilityError)
        {
            throw error;
        }

        throw new CompatibilityError(
            `Adapter "${manifest.id}" rejected the installed environment: ${error instanceof Error ? error.message : String(error)}`,
            { code: 'UNSUPPORTED_TUPLE', adapterIds: [manifest.id], cause: error },
        );
    }
}

export interface Adapters<S extends SceneTypes, F extends BindingFamily>
{
    readonly framework: FrameworkAdapter<F>;
    readonly scene: SceneAdapter<S>;
}

/**
 * Validates an adapter pair (shape, ABI, capabilities, installed environment) before anything is allocated,
 * then creates a fresh runtime for it. Every call returns a new, isolated runtime.
 */
export function compose<S extends SceneTypes, F extends BindingFamily>(
    adapters: Adapters<S, F>,
    options: RendererOptions = {},
): Runtime<S>
{
    if (!isRecord(adapters))
    {
        throw new TypeError('Expected { framework, scene } adapters.');
    }

    const framework = validateAdapterShape(adapters.framework, 'framework');
    const scene = validateAdapterShape(adapters.scene, 'scene');
    const composition = negotiate(framework, scene, options.requiredCapabilities);

    checkEnvironment(adapters.framework, framework);
    checkEnvironment(adapters.scene, scene);

    return createRuntime({ scene: adapters.scene, composition, options });
}
