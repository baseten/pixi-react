import { CompatibilityError, CoreErrorCodes, TeardownError } from './errors.js';

import type {
    GenerationToken,
    NodeContext,
    RootHooks,
    RootRecord,
    RootStatus,
    RootTarget,
    Runtime,
    SceneBridge,
    SceneSession,
} from './contracts.js';
import type { RuntimeRegistry } from './registry.js';
import type { ApplicationState, CapabilityMap, NodeDefinition, SceneTypes, TickOptions } from './types.js';

/** Per-node ownership metadata. Lives in the runtime's WeakMap side table, never on the node. */
export interface NodeMeta<S extends SceneTypes>
{
    readonly root: Root<S>;
    readonly definition: NodeDefinition;
    /** The parent node or the session container; `null` while detached. */
    parent: object | null;
    readonly children: Set<object>;
    hidden: boolean;
    destroyed: boolean;
}

/** What a root needs from its runtime. Not part of the public API. */
export interface RuntimeInternals<S extends SceneTypes>
{
    readonly runtime: Runtime<S>;
    readonly registry: RuntimeRegistry<S>;
    readonly nodes: WeakMap<object, NodeMeta<S>>;
    readonly capabilities: CapabilityMap;
    readonly adapterIds: readonly string[];
    /** Definitions whose capabilities were already checked against `capabilities`. */
    readonly checked: WeakSet<NodeDefinition>;
    report(error: unknown): void;
    /** Removes the root from the runtime's maps and releases its target leases. */
    release(root: Root<S>): void;
    /** Runs `callback` after the current scheduled turn (StrictMode deferral). */
    scheduleTurn(callback: () => void): void;
}

interface QueuedTask
{
    run(): void;
    reject(error: unknown): void;
}

interface RunningTask
{
    reject(error: unknown): void;
}

const noop = () => undefined;

function isObject(value: unknown): value is object
{
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T>
{
    return isObject(value) && typeof (value as { then?: unknown }).then === 'function';
}

/** The scene bridge of one root: ownership checks, attach rules, deferred destruction. */
class RootSceneBridge<S extends SceneTypes> implements SceneBridge<S>
{
    private readonly pending: object[] = [];

    constructor(private readonly root: Root<S>)
    {}

    private get session(): SceneSession<S>
    {
        return this.root.session;
    }

    private get nodes(): WeakMap<object, NodeMeta<S>>
    {
        return this.root.internals.nodes;
    }

    private unsupported(message: string, extra: { capability?: string; expected?: Record<string, string | number | boolean | null>; actual?: Record<string, string | number | boolean | null> } = {}): CompatibilityError
    {
        return new CompatibilityError(message, { code: 'UNSUPPORTED_NODE', adapterIds: this.root.internals.adapterIds, ...extra });
    }

    /** Metadata of a live node owned by this root, or a thrown `UNSUPPORTED_NODE`. */
    private owned(node: unknown, role: string): NodeMeta<S>
    {
        const meta = isObject(node) ? this.nodes.get(node) : undefined;

        if (!meta)
        {
            throw this.unsupported(`The ${role} is not a node owned by this runtime.`);
        }

        if (meta.root !== this.root)
        {
            throw this.unsupported(`The ${role} belongs to root ${meta.root.id}, not root ${this.root.id}.`);
        }

        if (meta.destroyed)
        {
            throw this.unsupported(`The ${role} "${meta.definition.name}" was already destroyed.`);
        }

        return meta;
    }

    /** Metadata of a parent, or `null` for the session container. */
    private parentMeta(parent: unknown): NodeMeta<S> | null
    {
        return parent === this.session.container ? null : this.owned(parent, 'parent');
    }

    private resolveDefinition(type: string | NodeDefinition): NodeDefinition
    {
        const { registry, checked, capabilities } = this.root.internals;
        const definition = typeof type === 'string' ? registry.resolve(type) : type;

        if (typeof type !== 'string' && (!isObject(type) || registry.resolve(type.name) !== type))
        {
            throw new CompatibilityError('Node definitions must come from this runtime\'s registry.', {
                code: 'UNKNOWN_ELEMENT',
                adapterIds: this.root.internals.adapterIds,
            });
        }

        if (!checked.has(definition))
        {
            for (const [capability, version] of Object.entries(definition.capabilities))
            {
                if (capabilities[capability] !== version)
                {
                    throw this.unsupported(
                        `"${definition.name}" needs scene capability "${capability}" version ${version}, which the `
                        + 'composed adapters do not provide.',
                        { capability, expected: { [capability]: version }, actual: { [capability]: capabilities[capability] ?? null } },
                    );
                }
            }

            checked.add(definition);
        }

        return definition;
    }

    create(type: string | NodeDefinition, props: unknown): S['node']
    {
        this.root.assertReady('create a node');

        const definition = this.resolveDefinition(type);
        const context: NodeContext<S> = { app: this.session.app, runtime: this.root.runtime, root: this.root };
        const node: unknown = this.session.create(definition, props, context);

        if (!isObject(node))
        {
            throw this.unsupported(`The scene session returned a non-object for "${definition.name}".`);
        }

        if (this.nodes.has(node))
        {
            throw this.unsupported(`The scene session returned a node that is already owned, for "${definition.name}".`);
        }

        this.nodes.set(node, {
            root: this.root,
            definition,
            parent: null,
            children: new Set(),
            hidden: false,
            destroyed: false,
        });
        this.root.live.add(node);

        return node as S['node'];
    }

    update(node: S['node'], previous: unknown, next: unknown): void
    {
        this.root.assertMutable('update a node');
        this.owned(node, 'node');
        this.session.update(node, previous, next);
    }

    private checkAttach(parent: object, parentMeta: NodeMeta<S> | null, child: object, childMeta: NodeMeta<S>): void
    {
        const rule = parentMeta ? parentMeta.definition.attach : this.session.containerAttach;
        const role = childMeta.definition.attach.role;

        if (rule && !rule.accepts.includes(role))
        {
            const parentName = parentMeta ? `"${parentMeta.definition.name}"` : 'the root container';

            throw this.unsupported(
                `${parentName} does not accept "${childMeta.definition.name}" (role "${role}") as a child.`,
                { expected: { roles: rule.accepts.join(',') }, actual: { role } },
            );
        }

        // Inserting an ancestor below its own descendant would create a cycle.
        for (let current: object | null = parent; current; current = this.nodes.get(current)?.parent ?? null)
        {
            if (current === child)
            {
                throw this.unsupported(`"${childMeta.definition.name}" cannot be inserted below itself.`);
            }
        }
    }

    private link(parent: object, parentMeta: NodeMeta<S> | null, child: object, childMeta: NodeMeta<S>): void
    {
        if (childMeta.parent)
        {
            this.nodes.get(childMeta.parent)?.children.delete(child);
        }

        childMeta.parent = parent;
        parentMeta?.children.add(child);

        // A node moved back into the tree before the flush is no longer pending destruction.
        const index = this.pending.indexOf(child);

        if (index !== -1)
        {
            this.pending.splice(index, 1);
        }
    }

    append(parent: S['node'], child: S['node']): void
    {
        this.root.assertMutable('append a node');

        const parentMeta = this.parentMeta(parent);
        const childMeta = this.owned(child, 'child');

        this.checkAttach(parent, parentMeta, child, childMeta);
        this.session.append(parent, child);
        this.link(parent, parentMeta, child, childMeta);
    }

    insertBefore(parent: S['node'], child: S['node'], before: S['node']): void
    {
        this.root.assertMutable('insert a node');

        const parentMeta = this.parentMeta(parent);
        const childMeta = this.owned(child, 'child');
        const beforeMeta = this.owned(before, 'reference node');

        if (beforeMeta.parent !== parent)
        {
            throw this.unsupported(`The reference node "${beforeMeta.definition.name}" is not a child of this parent.`);
        }

        this.checkAttach(parent, parentMeta, child, childMeta);
        this.session.insertBefore(parent, child, before);
        this.link(parent, parentMeta, child, childMeta);
    }

    remove(parent: S['node'], child: S['node']): void
    {
        this.root.assertMutable('remove a node');

        const parentMeta = this.parentMeta(parent);
        const childMeta = this.owned(child, 'child');

        if (childMeta.parent !== parent)
        {
            throw this.unsupported(`"${childMeta.definition.name}" is not a child of this parent.`);
        }

        this.session.remove(parent, child);
        childMeta.parent = null;
        parentMeta?.children.delete(child);
        this.pending.push(child);
    }

    flush(): void
    {
        const options = this.root.nodeDestroyOptions();
        const errors: unknown[] = [];

        for (const node of this.pending.splice(0))
        {
            const meta = this.nodes.get(node);

            if (meta && !meta.destroyed && meta.parent === null)
            {
                this.destroySubtree(node, options, errors);
            }
        }

        this.throwAll(errors, 'Destroying removed nodes failed');
    }

    destroy(node: S['node']): void
    {
        const meta = this.owned(node, 'node');

        if (meta.parent !== null)
        {
            throw this.unsupported(`"${meta.definition.name}" is still attached; remove it before destroying it.`);
        }

        const errors: unknown[] = [];

        this.destroySubtree(node, this.root.nodeDestroyOptions(), errors);
        this.throwAll(errors, 'Destroying a node failed');
    }

    /** Teardown only: destroys every node the root still owns, top-level subtrees first-children-first. */
    sweep(): void
    {
        const options = this.root.nodeDestroyOptions();
        const errors: unknown[] = [];
        const live = this.root.live;
        const tops = [...live].filter((node) =>
        {
            const parent = this.nodes.get(node)?.parent ?? null;

            return parent === null || !live.has(parent);
        });

        for (const node of tops)
        {
            this.destroySubtree(node, options, errors);
        }

        this.throwAll(errors, 'Destroying the remaining nodes failed');
    }

    /** Children first; each node is marked before its destroy call, so it is destroyed at most once. */
    private destroySubtree(node: object, options: S['nodeDestroy'] | undefined, errors: unknown[]): void
    {
        const meta = this.nodes.get(node);

        if (!meta || meta.destroyed)
        {
            return;
        }

        for (const child of [...meta.children])
        {
            this.destroySubtree(child, options, errors);
        }

        meta.destroyed = true;
        this.root.live.delete(node);

        try
        {
            this.session.destroyNode(node, options);
        }
        catch (error)
        {
            errors.push(error);
        }
    }

    private throwAll(errors: unknown[], message: string): void
    {
        if (errors.length === 1)
        {
            throw errors[0];
        }

        if (errors.length > 1)
        {
            throw new TeardownError(errors, message);
        }
    }

    setHidden(node: S['node'], hidden: boolean): void
    {
        this.root.assertMutable('change node visibility');

        const meta = this.owned(node, 'node');

        this.session.setHidden(node, hidden);
        meta.hidden = hidden;
    }

    publicInstance(node: S['node']): object
    {
        this.owned(node, 'node');

        return this.session.publicInstance(node);
    }

    subscribe<C>(options: TickOptions<S['tick'], C>): () => void
    {
        this.root.assertReady('subscribe to the ticker');

        const unsubscribe = this.session.subscribe(options);
        const subscriptions = this.root.subscriptions;
        let active = true;
        const release = () =>
        {
            if (!active)
            {
                return;
            }

            active = false;
            subscriptions.delete(release);
            unsubscribe();
        };

        subscriptions.add(release);

        return release;
    }

    updateApplication(props: S['appProps']): void
    {
        this.root.assertReady('update the application');
        this.session.updateApplication(props);
    }
}

/** Core's root record: one target, one session, one lifecycle. */
export class Root<S extends SceneTypes> implements RootRecord<S>
{
    readonly scene: SceneBridge<S>;
    /** Every node this root constructed and has not destroyed. */
    readonly live = new Set<object>();
    readonly subscriptions = new Set<() => void>();

    private _status: RootStatus = 'new';
    private _generation = 0;
    private _failure: unknown = undefined;
    private hooks: RootHooks<S> = {};
    private readonly controller = new AbortController();
    private initPromise: Promise<S['app']> | undefined;
    private initSucceeded = false;
    private readonly queue: QueuedTask[] = [];
    /** Scheduled tasks that started and returned a promise that has not settled yet. */
    private readonly running = new Set<RunningTask>();
    private readonly teardownHooks = new Set<() => void | Promise<void>>();
    private teardownPromise: Promise<void> | undefined;
    private teardownOptions: S['destroy'] | undefined;
    private deferred = false;
    private stateCache: { status: RootStatus; value: ApplicationState<S['app']> } | undefined;

    constructor(
        readonly internals: RuntimeInternals<S>,
        readonly id: number,
        readonly target: RootTarget,
        readonly canvas: HTMLCanvasElement,
        readonly session: SceneSession<S>,
        /** DOM objects leased to the runtime for this root. */
        readonly leased: readonly object[],
    )
    {
        this.scene = new RootSceneBridge(this);
    }

    get runtime(): Runtime<S>
    {
        return this.internals.runtime;
    }

    get status(): RootStatus
    {
        return this._status;
    }

    get generation(): number
    {
        return this._generation;
    }

    get failure(): unknown
    {
        return this._failure;
    }

    get signal(): AbortSignal
    {
        return this.controller.signal;
    }

    get app(): S['app']
    {
        return this.session.app;
    }

    get applicationState(): ApplicationState<S['app']>
    {
        if (this.stateCache?.status !== this._status)
        {
            this.stateCache = {
                status: this._status,
                value: Object.freeze({
                    app: this.session.app,
                    isInitialised: this._status === 'ready',
                    isInitialising: this._status === 'initialising',
                }),
            };
        }

        return this.stateCache.value;
    }

    get isTornDown(): boolean
    {
        return this._status === 'disposing' || this._status === 'disposed';
    }

    setHooks(hooks: RootHooks<S>): void
    {
        this.hooks = { ...hooks };
    }

    initialise(options: S['options']): Promise<S['app']>
    {
        if (!this.initPromise)
        {
            this.initPromise = this.isTornDown
                ? Promise.reject(this.disposedError('cannot initialize'))
                : this.runInit(options);
            this.initPromise.catch(noop);
        }

        return this.initPromise;
    }

    schedule<T>(task: (app: S['app']) => T | PromiseLike<T>): Promise<T>
    {
        return new Promise<T>((resolve, reject) =>
        {
            const blocked = this.blockedError();

            if (blocked)
            {
                reject(blocked);

                return;
            }

            const run = () =>
            {
                let result: T | PromiseLike<T>;

                try
                {
                    result = task(this.session.app);
                }
                catch (error)
                {
                    reject(error);

                    return;
                }

                if (!isThenable(result))
                {
                    resolve(result);

                    return;
                }

                // The task is still running: keep it tracked until it settles, so teardown can reject it. Its
                // promise never resolves after disposal started, and never stays pending past it.
                const entry: RunningTask = { reject };

                this.running.add(entry);
                Promise.resolve(result).then(
                    (value) =>
                    {
                        if (this.running.delete(entry))
                        {
                            resolve(value);
                        }
                    },
                    (error: unknown) =>
                    {
                        if (this.running.delete(entry))
                        {
                            reject(error);
                        }
                    },
                );
            };

            if (this._status === 'ready' && this.queue.length === 0)
            {
                run();
            }
            else
            {
                this.queue.push({ run, reject });
            }
        });
    }

    token(): GenerationToken
    {
        const generation = this._generation;
        const isCurrent = () => this._generation === generation && !this.isTornDown && !this.deferred;

        return Object.freeze({
            generation,
            get current(): boolean
            {
                return isCurrent();
            },
        });
    }

    onTeardown(hook: () => void | Promise<void>): () => void
    {
        const entry = () => hook();

        this.teardownHooks.add(entry);

        return () =>
        {
            this.teardownHooks.delete(entry);
        };
    }

    deferDispose(options?: S['destroy']): void
    {
        if (this.teardownPromise)
        {
            return;
        }

        if (options !== undefined)
        {
            this.teardownOptions = options;
        }

        if (this.deferred)
        {
            return;
        }

        this.deferred = true;
        this._generation += 1;
        this.internals.scheduleTurn(() =>
        {
            if (this.deferred)
            {
                this.dispose().catch((error: unknown) => this.internals.report(error));
            }
        });
    }

    cancelDeferredDispose(): boolean
    {
        if (!this.deferred)
        {
            return false;
        }

        this.deferred = false;
        this._generation += 1;

        return true;
    }

    dispose(options?: S['destroy']): Promise<void>
    {
        if (this.teardownPromise)
        {
            return this.teardownPromise;
        }

        if (options !== undefined)
        {
            this.teardownOptions = options;
        }

        const wasInitialising = this._status === 'initialising';
        const disposed = this.disposedError('the root is tearing down');

        this.deferred = false;
        this._status = 'disposing';
        this._generation += 1;
        this.controller.abort(disposed);
        this.rejectQueue(disposed);
        this.rejectRunning(this.disposedError('a scheduled task was still running when teardown started'));
        this.teardownPromise = this.teardown(wasInitialising);
        this.teardownPromise.catch(noop);

        return this.teardownPromise;
    }

    /** Node destroy options for nodes destroyed now: the root's teardown options while it tears down. */
    nodeDestroyOptions(): S['nodeDestroy'] | undefined
    {
        return this._status === 'disposing'
            ? this.session.nodeDestroyOptions?.(this.teardownOptions)
            : undefined;
    }

    /** Throws unless the root may perform `operation`, which needs an initialized application. */
    assertReady(operation: string): void
    {
        if (this._status === 'ready')
        {
            return;
        }

        throw this.blockedError() ?? new CompatibilityError(
            `Cannot ${operation}: the root's application is not initialized yet (status "${this._status}").`,
            { code: CoreErrorCodes.ROOT_NOT_READY, adapterIds: this.internals.adapterIds, actual: { status: this._status } },
        );
    }

    /** Throws unless the root may still mutate its scene (ready, or tearing down). */
    assertMutable(operation: string): void
    {
        if (this._status === 'ready' || this._status === 'disposing')
        {
            return;
        }

        this.assertReady(operation);
    }

    disposedError(reason: string, cause?: unknown): CompatibilityError
    {
        return new CompatibilityError(`Root ${this.id} is ${this._status === 'disposed' ? 'disposed' : 'disposing'}: ${reason}.`, {
            code: 'ROOT_DISPOSED',
            adapterIds: this.internals.adapterIds,
            ...(cause === undefined ? {} : { cause }),
        });
    }

    private blockedError(): CompatibilityError | undefined
    {
        if (this.isTornDown)
        {
            return this.disposedError('no further work is accepted');
        }

        if (this._status === 'failed')
        {
            return this.initFailedError();
        }

        return undefined;
    }

    private initFailedError(): CompatibilityError
    {
        const cause = this._failure;
        const detail = cause instanceof Error ? cause.message : String(cause);

        return new CompatibilityError(
            `Root ${this.id} failed to initialize (${detail}). It is not retried: unmount it and create a new root.`,
            { code: 'INIT_FAILED', adapterIds: this.internals.adapterIds, cause },
        );
    }

    private async runInit(options: S['options']): Promise<S['app']>
    {
        this._status = 'initialising';

        try
        {
            await this.session.init(options, this.controller.signal);
        }
        catch (error)
        {
            if (this._status !== 'initialising')
            {
                throw this.disposedError('initialization was abandoned', error);
            }

            this._status = 'failed';
            this._failure = error;
            this.callHook(() => this.hooks.onInitError?.(error));

            const failure = this.initFailedError();

            this.rejectQueue(failure);
            throw failure;
        }

        this.initSucceeded = true;

        if (this._status !== 'initialising')
        {
            // Unmounted while the non-cancellable initialization was pending: no onInit, no late commits.
            throw this.disposedError('initialization finished after unmount');
        }

        this._status = 'ready';
        this.callHook(() => this.hooks.onInit?.(this.session.app));
        this.flushQueue();

        return this.session.app;
    }

    private callHook(hook: () => void): void
    {
        try
        {
            hook();
        }
        catch (error)
        {
            // A throwing callback does not change ownership or rerun initialization.
            this.internals.report(error);
        }
    }

    private flushQueue(): void
    {
        while (this._status === 'ready' && this.queue.length)
        {
            this.queue.shift()!.run();
        }
    }

    private rejectQueue(error: unknown): void
    {
        for (const task of this.queue.splice(0))
        {
            task.reject(error);
        }
    }

    private rejectRunning(error: unknown): void
    {
        const running = [...this.running];

        this.running.clear();

        for (const task of running)
        {
            task.reject(error);
        }
    }

    private async teardown(wasInitialising: boolean): Promise<void>
    {
        const errors: unknown[] = [];

        if (wasInitialising)
        {
            // Initialization cannot be cancelled: wait for it before destroying what it allocated.
            await this.initPromise?.catch(noop);
        }

        for (const hook of [...this.teardownHooks].reverse())
        {
            try
            {
                await hook();
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        this.teardownHooks.clear();

        const bridge = this.scene as RootSceneBridge<S>;

        for (const step of [() => bridge.flush(), () => bridge.sweep()])
        {
            try
            {
                step();
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        for (const unsubscribe of [...this.subscriptions])
        {
            try
            {
                unsubscribe();
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        if (this.initSucceeded)
        {
            try
            {
                await this.session.destroy(this.teardownOptions);
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        try
        {
            this.internals.release(this);
        }
        catch (error)
        {
            errors.push(error);
        }

        this._status = 'disposed';

        if (errors.length)
        {
            throw new TeardownError(errors, `Teardown of root ${this.id} did not complete cleanly`);
        }
    }
}

