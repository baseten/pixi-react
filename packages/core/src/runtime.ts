import { ADAPTER_ROLES, isRecord, negotiate, type NegotiatedComposition, validateAdapterShape } from './abi.js';
import { CompatibilityError, CoreErrorCodes, TeardownError } from './errors.js';
import { acquireLeases, assertNotLeased, type LeaseHolder, releaseLeases } from './lease.js';
import { RuntimeRegistry } from './registry.js';
import { type NodeMeta, Root, type RuntimeInternals } from './root.js';

import type { PixiAdapter, ReactAdapter } from './adapters.js';
import type {
    CreateRootOptions,
    NodeInfo,
    PixiSession,
    RootRecord,
    RootTarget,
    Runtime,
    RuntimeStatus,
} from './contracts.js';
import type {
    AdapterManifest,
    CapabilityMap,
    NodeDefinition,
    PixiTypes,
    ReactBindingFamily,
    RegistryConflictPolicy,
    RendererOptions,
} from './types.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

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

function defaultReport(error: unknown): void
{
    console.error(error);
}

export interface RuntimeConfig<S extends PixiTypes>
{
    readonly pixi: PixiAdapter<S>;
    readonly composition: NegotiatedComposition;
    readonly options?: RendererOptions;
}

class ComposedRuntime<S extends PixiTypes> implements Runtime<S>
{
    readonly id: symbol;
    readonly pixi: PixiAdapter<S>;
    readonly registry: RuntimeRegistry<S>;
    readonly manifests: { readonly react: AdapterManifest; readonly pixi: AdapterManifest };
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

    constructor({ pixi, composition, options = {} }: RuntimeConfig<S>)
    {
        const label = `runtime ${++runtimeCount} (${composition.react.id} + ${composition.pixi.id})`;
        const adapterIds = Object.freeze([composition.react.id, composition.pixi.id]);
        const report = options.onUnhandledError ?? defaultReport;

        this.id = Symbol(label);
        this.pixi = pixi;
        this.manifests = Object.freeze({ react: composition.react, pixi: composition.pixi });
        this.capabilities = composition.capabilities;
        this.#holder = Object.freeze({ owner: this.id, description: label });
        this.registry = new RuntimeRegistry(pixi, {
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
            throw new TypeError(process.env.NODE_ENV !== 'production' ? 'createRoot() expects an HTMLElement or HTMLCanvasElement target.' : 'Invalid createRoot() target.');
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
            // Replacing the target's children must not detach a canvas another root owns, in any runtime.
            this.#assertNoOwnedCanvas(target);
        }

        acquireLeases(leased, this.#holder);

        let root: Root<S>;

        try
        {
            const session = this.pixi.createSession(this, canvas);

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
            throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `Cannot ${operation}: ${this.#holder.description} is ${this.#status}.` : '', {
                code: 'ROOT_DISPOSED',
                adapterIds: this.#internals?.adapterIds ?? [],
            });
        }
    }

    /** Throws `core.TARGET_LEASED` if a canvas below `target` belongs to a root of this or another runtime. */
    #assertNoOwnedCanvas(target: HTMLElement): void
    {
        const canvases = Array.from(target.querySelectorAll('canvas'));

        assertNotLeased(canvases, this.#holder);

        for (const canvas of canvases)
        {
            const owner = this.#byTarget.get(canvas);

            if (owner)
            {
                throw new CompatibilityError(
                    process.env.NODE_ENV !== 'production'
                        ? (`Cannot create a root for this element: it contains a canvas owned by root ${owner.id} of this `
                        + 'runtime, which replacing the element\'s children would detach. Unmount that root first, or render '
                        + 'into a different element.')
                        : '',
                    {
                        code: CoreErrorCodes.TARGET_LEASED,
                        adapterIds: this.#internals.adapterIds,
                        expected: { owner: 'none' },
                        actual: { owner: `root ${owner.id}` },
                    },
                );
            }
        }
    }

    #validateSession(session: PixiSession<S>): void
    {
        const id = this.manifests.pixi.id;

        if (!isRecord(session))
        {
            throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `Pixi adapter "${id}" returned no session from createSession().` : '', {
                code: 'ABI_MISMATCH',
                adapterIds: [id],
            });
        }

        for (const method of SESSION_METHODS)
        {
            if (typeof session[method] !== 'function')
            {
                throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `The session of Pixi adapter "${id}" does not implement ${method}().` : '', {
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

const REGISTRY_CONFLICT_POLICIES: readonly unknown[] = ['reject', 'replace'] satisfies RegistryConflictPolicy[];

/** Throws `core.INVALID_OPTION` for option values core does not accept, so a typo never changes behaviour. */
function validateOptions(options: RendererOptions, adapterIds: readonly string[]): void
{
    if (options.registryConflict === undefined)
    {
        return;
    }

    const policy: unknown = options.registryConflict;

    if (!REGISTRY_CONFLICT_POLICIES.includes(policy))
    {
        throw new CompatibilityError(
            process.env.NODE_ENV !== 'production'
                ? (`Unknown registryConflict policy ${typeof policy === 'string' ? `"${policy}"` : String(policy)}: `
                + 'expected \'reject\' or \'replace\'.')
                : '',
            {
                code: CoreErrorCodes.INVALID_OPTION,
                adapterIds,
                expected: { registryConflict: 'reject | replace' },
                actual: { registryConflict: String(policy) },
            },
        );
    }
}

/** Creates a runtime for an already negotiated composition. Prefer `compose`, which validates first. */
export function createRuntime<S extends PixiTypes>(config: RuntimeConfig<S>): Runtime<S>
{
    validateOptions(config.options ?? {}, [config.composition.react.id, config.composition.pixi.id]);

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
            process.env.NODE_ENV !== 'production' ? `Adapter "${manifest.id}" rejected the installed environment: ${error instanceof Error ? error.message : String(error)}` : '',
            { code: 'UNSUPPORTED_TUPLE', adapterIds: [manifest.id], cause: error },
        );
    }
}

export interface Adapters<S extends PixiTypes, F extends ReactBindingFamily>
{
    readonly react: ReactAdapter<F>;
    readonly pixi: PixiAdapter<S>;
}

/**
 * Validates an adapter pair (shape, ABI, capabilities, installed environment) before anything is allocated,
 * then creates a fresh runtime for it. Every call returns a new, isolated runtime.
 */
export function compose<S extends PixiTypes, F extends ReactBindingFamily>(
    adapters: Adapters<S, F>,
    options: RendererOptions = {},
): Runtime<S>
{
    if (!isRecord(adapters))
    {
        throw new TypeError('Expected { react, pixi } adapters.');
    }

    const [react, pixi] = ADAPTER_ROLES.map((role) => validateAdapterShape(adapters[role], role));
    const composition = negotiate(react, pixi, options.requiredCapabilities);

    checkEnvironment(adapters.react, react);
    checkEnvironment(adapters.pixi, pixi);

    return createRuntime({ pixi: adapters.pixi, composition, options });
}
