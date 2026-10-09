/**
 * Fake adapters for core tests. They are deliberately not React or Pixi: a plain node tree, an application
 * with an asynchronous init that a test can hold or fail, a numeric ticker, and a framework whose bindings are
 * a small imperative API. Every scene operation is logged so tests can assert order and exactly-once rules.
 */
import { CompatibilityError, compose, FrameworkAdapter, SceneAdapter } from '../src/index.js';

import type {
    AdapterManifest,
    Bind,
    BindingFamily,
    Constructor,
    NodeContext,
    NodeDefinition,
    PropsFamily,
    RendererOptions,
    RootRecord,
    RootTarget,
    Runtime,
    SceneSession,
    SceneTypes,
    TickOptions,
} from '../src/index.js';

export class FakeNode
{
    children: FakeNode[] = [];
    parent: FakeNode | null = null;
    hidden = false;
    props: Record<string, unknown> = {};

    constructor(readonly options?: unknown)
    {}
}

export class FakeFilter
{
    constructor(readonly options?: unknown)
    {}
}

export class FakeApp
{
    readonly stage = new FakeNode();
    initialised = false;
    readonly listeners = new Set<(tick: number) => void>();
}

export interface FakePropsFamily extends PropsFamily
{
    readonly type: { label?: string };
}

export interface FakeSceneTypes extends SceneTypes
{
    readonly node: object;
    readonly app: FakeApp;
    readonly options: { width?: number };
    readonly appProps: { label?: string };
    readonly destroy: { reason?: string };
    readonly nodeDestroy: { reason: string };
    readonly tick: number;
    readonly props: FakePropsFamily;
}

export type SceneLogEntry =
    | { op: 'createSession'; target: RootTarget }
    | { op: 'init'; app: FakeApp; options: unknown }
    | { op: 'create'; node: object; name: string; context: NodeContext<FakeSceneTypes> }
    | { op: 'update'; node: object; next: unknown }
    | { op: 'append' | 'remove'; parent: object; child: object }
    | { op: 'insertBefore'; parent: object; child: object; before: object }
    | { op: 'destroyNode'; node: object; options: unknown }
    | { op: 'setHidden'; node: object; hidden: boolean }
    | { op: 'appDestroy'; app: FakeApp; options: unknown };

export interface InitControl
{
    /** Resolves the held init. */
    release(): void;
    /** Rejects the held init. */
    fail(error: unknown): void;
}

export const BASE_MANIFEST = Object.freeze({
    abi: { major: 1 as const, minor: 0 },
    packageVersion: '0.0.0-test',
    certification: 'test://fake',
});

export const SCENE_PROVIDES = Object.freeze({
    'scene.mutation': 1,
    'scene.visibility': 1,
    'scene.application': 1,
    'scene.ticker': 1,
});

export function manifest(overrides: Partial<AdapterManifest> & { id: string }): AdapterManifest
{
    return { ...BASE_MANIFEST, provides: {}, requires: {}, ...overrides };
}

export interface FakeSceneOptions
{
    manifest?: AdapterManifest;
    /** Node definitions get these capabilities. */
    nodeCapabilities?: Record<string, number>;
    /** Throws from `destroyNode` for nodes whose label matches. */
    failDestroyFor?: string;
    /** Throws from the application destroy. */
    failAppDestroy?: Error;
    /** Constructors `describe` refuses. */
    unsupported?: readonly Constructor[];
    /** Strips this prefix from element names. */
    prefix?: string;
}

export class FakeSession implements SceneSession<FakeSceneTypes>
{
    readonly app = new FakeApp();
    readonly containerAttach = { role: 'container', accepts: ['child'] };
    destroyed = 0;

    constructor(private readonly adapter: FakeSceneAdapter, readonly runtime: Runtime<FakeSceneTypes>)
    {}

    get container(): object
    {
        return this.app.stage;
    }

    async init(options: { width?: number }, signal: AbortSignal): Promise<void>
    {
        this.adapter.log.push({ op: 'init', app: this.app, options });
        signal.throwIfAborted();

        const held = this.adapter.heldInits.shift();

        await (held ? held.promise : Promise.resolve());
        this.app.initialised = true;
    }

    updateApplication(props: { label?: string }): void
    {
        Object.assign(this.app, { label: props.label });
    }

    create(definition: NodeDefinition, props: unknown, context: NodeContext<FakeSceneTypes>): object
    {
        const Ctor = definition.ctor as unknown as new (options: unknown) => FakeNode;
        const node = new Ctor(props);

        if (node instanceof FakeNode)
        {
            node.props = { ...(props as object) };
        }

        this.adapter.log.push({ op: 'create', node, name: definition.name, context });

        return node;
    }

    update(node: object, _previous: unknown, next: unknown): void
    {
        this.adapter.log.push({ op: 'update', node, next });
        (node as FakeNode).props = { ...(next as object) };
    }

    destroyNode(node: object, options: { reason: string } | undefined): void
    {
        this.adapter.log.push({ op: 'destroyNode', node, options });

        const label = (node as FakeNode).props?.label;

        if (label !== undefined && label === this.adapter.options.failDestroyFor)
        {
            throw new Error(`destroy failed for ${String(label)}`);
        }
    }

    append(parent: object, child: object): void
    {
        this.adapter.log.push({ op: 'append', parent, child });
        detach(child as FakeNode);
        (parent as FakeNode).children.push(child as FakeNode);
        (child as FakeNode).parent = parent as FakeNode;
    }

    insertBefore(parent: object, child: object, before: object): void
    {
        this.adapter.log.push({ op: 'insertBefore', parent, child, before });
        detach(child as FakeNode);

        const children = (parent as FakeNode).children;

        children.splice(children.indexOf(before as FakeNode), 0, child as FakeNode);
        (child as FakeNode).parent = parent as FakeNode;
    }

    remove(parent: object, child: object): void
    {
        this.adapter.log.push({ op: 'remove', parent, child });
        detach(child as FakeNode);
    }

    setHidden(node: object, hidden: boolean): void
    {
        this.adapter.log.push({ op: 'setHidden', node, hidden });
        (node as FakeNode).hidden = hidden;
    }

    publicInstance(node: object): object
    {
        return node;
    }

    subscribe<C>(options: TickOptions<number, C>): () => void
    {
        const listener = (tick: number) => options.callback.call(options.context as C, tick);

        this.app.listeners.add(listener);

        return () => this.app.listeners.delete(listener);
    }

    nodeDestroyOptions(options: { reason?: string } | undefined): { reason: string } | undefined
    {
        return options?.reason ? { reason: options.reason } : undefined;
    }

    destroy(options: { reason?: string } | undefined): void
    {
        this.destroyed += 1;
        this.adapter.log.push({ op: 'appDestroy', app: this.app, options });

        if (this.adapter.options.failAppDestroy)
        {
            throw this.adapter.options.failAppDestroy;
        }
    }
}

/** A scene adapter over plain fake nodes. */
export class FakeSceneAdapter extends SceneAdapter<FakeSceneTypes>
{
    readonly manifest: AdapterManifest;
    readonly log: SceneLogEntry[] = [];
    readonly sessions: FakeSession[] = [];
    /** Inits wait for the next control pushed here (FIFO); without one they resolve after a microtask. */
    readonly heldInits: Array<{ promise: Promise<void> } & InitControl> = [];

    constructor(readonly options: FakeSceneOptions = {})
    {
        super();
        this.manifest = options.manifest ?? manifest({ id: 'test.scene', provides: SCENE_PROVIDES });
    }

    /** The next session's init waits until the returned control releases or fails it. */
    holdNextInit(): InitControl
    {
        let release!: () => void;
        let fail!: (error: unknown) => void;
        const promise = new Promise<void>((resolve, reject) =>
        {
            release = resolve;
            fail = reject;
        });

        this.heldInits.push({ promise, release, fail });

        return { release, fail };
    }

    normalizeName(name: string): string
    {
        const prefix = this.options.prefix;

        return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
    }

    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        if (this.options.unsupported?.includes(ctor))
        {
            throw new CompatibilityError(`"${name}" is not a supported scene node.`, {
                code: 'UNSUPPORTED_NODE',
                adapterIds: [this.manifest.id],
            });
        }

        const isFilter = (ctor as unknown) === FakeFilter || ctor.prototype instanceof FakeFilter;

        return {
            name,
            ctor,
            capabilities: this.options.nodeCapabilities ?? { 'scene.mutation': 1 },
            attach: isFilter ? { role: 'filter', accepts: [] } : { role: 'child', accepts: ['child', 'filter'] },
        };
    }

    createSession(runtime: Runtime<FakeSceneTypes>, target: RootTarget): SceneSession<FakeSceneTypes>
    {
        this.log.push({ op: 'createSession', target });

        const session = new FakeSession(this, runtime);

        this.sessions.push(session);

        return session;
    }

    applyProps(node: object, props: unknown): void
    {
        Object.assign((node as FakeNode).props, props);
    }
}

function detach(node: FakeNode): void
{
    if (node.parent)
    {
        node.parent.children.splice(node.parent.children.indexOf(node), 1);
        node.parent = null;
    }
}

/** The fake framework's bindings: an imperative API with no React types. */
export interface FakeBindings<S extends SceneTypes>
{
    readonly kind: 'fake-framework';
    createRoot(target: RootTarget): RootRecord<S>;
    extend(catalog: Record<string, Constructor>): void;
    component(ctor: Constructor, name?: string): string;
    app(root: RootRecord<S>): S['app'];
}

export interface FakeFamily extends BindingFamily
{
    readonly type: FakeBindings<this['scene']>;
}

export class FakeFrameworkAdapter extends FrameworkAdapter<FakeFamily>
{
    readonly manifest: AdapterManifest;
    readonly bound: Runtime<SceneTypes>[] = [];

    constructor(overrides: Partial<AdapterManifest> = {}, private readonly failBind?: Error)
    {
        super();
        this.manifest = manifest({ id: 'test.framework', requires: { 'scene.mutation': 1 }, ...overrides });
    }

    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<FakeFamily, S>
    {
        if (this.failBind)
        {
            throw this.failBind;
        }

        this.bound.push(runtime as unknown as Runtime<SceneTypes>);

        return {
            kind: 'fake-framework',
            createRoot: (target) => runtime.createRoot(target),
            extend: (catalog) => runtime.registry.extend(catalog),
            component: (ctor, name) => runtime.registry.define(ctor, name).name,
            app: (root) => root.app,
        };
    }
}

export function composeFake(scene = new FakeSceneAdapter(), options: RendererOptions = {}): Runtime<FakeSceneTypes>
{
    return compose({ framework: new FakeFrameworkAdapter(), scene }, options);
}

export function canvasElement(): HTMLCanvasElement
{
    return document.createElement('canvas');
}

export function hostElement(): HTMLElement
{
    const element = document.createElement('div');

    document.body.appendChild(element);

    return element;
}

/** A root whose app is initialized and ready. */
export async function readyRoot(runtime: Runtime<FakeSceneTypes>, target: RootTarget = canvasElement()): Promise<RootRecord<FakeSceneTypes>>
{
    const root = runtime.createRoot(target);

    await root.initialise({ width: 10 });

    return root;
}
