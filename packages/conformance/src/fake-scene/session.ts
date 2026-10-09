import { SceneJournal } from '../journal';
import {
    FakeApplication,
    type FakeApplicationOptions,
    type FakeContainer,
    FakeGraphics,
    type FakeNodeDestroyOptions,
    FakePoint,
    FakeText,
} from './nodes';

import type { Constructor, TickOptionsLike } from '../binding';

/**
 * Faults a negative control can inject. Each one reproduces a real regression class; the conformance suite
 * must fail when one is switched on.
 */
export interface FakeSceneFaults
{
    /** Removing an event prop leaves the old handler attached. */
    skipEventCleanup?: boolean;
    /** Removed nodes are destroyed twice. */
    doubleDestroy?: boolean;
    /** Unsubscribing a tick listener leaves it on the ticker. */
    skipTickerCleanup?: boolean;
}

/** Descriptive node metadata, after the contract's `NodeDefinition` (construction is the session's job). */
export interface FakeNodeDefinition
{
    readonly name: string;
    readonly ctor: Constructor;
}

export interface FakeSceneSessionOptions
{
    journal?: SceneJournal;
    faults?: FakeSceneFaults;
    /** Records the kind of a constructed node in the journal (`custom` when omitted). */
    kindOf?: (ctor: Constructor) => string;
    /** Wraps the application's initialization, so a test can hold or fail it. */
    interceptInit?: (init: () => Promise<void>) => Promise<void>;
}

type Props = Record<string, unknown>;

const RESERVED = new Set(['children', 'key', 'ref']);
const EVENT_PROP = /^on[A-Z]/;

/** `onPointerTap` → `pointertap`. */
export function sceneEventName(prop: string): string
{
    return prop.slice(2).toLowerCase();
}

interface NodeState
{
    /** Values captured right after construction, before any prop was applied. Keyed by (dashed) prop name. */
    readonly initial: Map<string, unknown>;
    readonly handlers: Map<string, (event: unknown) => void>;
    hidden: boolean;
    /** The latest committed `visible` prop (or the initial value), restored when unhidden. */
    committedVisible: boolean;
    destroyed: boolean;
}

/** Per-node state lives in a side table, never on the node (contract implementation rule 3). */
const nodeStates = new WeakMap<object, NodeState>();

function stateOf(node: object): NodeState
{
    let state = nodeStates.get(node);

    if (!state)
    {
        state = {
            initial: new Map(),
            handlers: new Map(),
            hidden: false,
            committedVisible: (node as FakeContainer).visible ?? true,
            destroyed: false,
        };
        nodeStates.set(node, state);
    }

    return state;
}

function readPath(target: any, path: readonly string[]): unknown
{
    return path.reduce((value, key) => value?.[key], target);
}

function capture(node: object, key: string): unknown
{
    const { initial } = stateOf(node);

    if (!initial.has(key))
    {
        const value = readPath(node, key.split('-'));

        initial.set(key, value instanceof FakePoint ? new FakePoint(value.x, value.y) : value);
    }

    return initial.get(key);
}

function assign(node: any, key: string, value: unknown): void
{
    const path = key.split('-');
    const field = path.pop()!;
    const target = readPath(node, path) as any;

    if (!target)
    {
        return;
    }

    const current = target[field];

    if (current instanceof FakePoint)
    {
        if (typeof value === 'number')
        {
            current.set(value);
        }
        else if (value && typeof value === 'object')
        {
            current.copyFrom(value as { x: number; y: number });
        }

        return;
    }

    if (field === 'style' && node instanceof FakeText)
    {
        node.style = { ...(capture(node, 'style') as FakeText['style']), ...(value as object) };

        return;
    }

    target[field] = value;
}

/**
 * Applies a prop diff to a fake node: plain, dashed (`position-x`) and point props, event handlers, the
 * graphics `draw` callback, and removal (restores the node's captured initial value). Used by the session's
 * `update` and by `applyProps`.
 */
export function applyFakeProps(node: object, previous: Props, next: Props, faults: FakeSceneFaults = {}): void
{
    const state = stateOf(node);
    const removed = Object.keys(previous).filter((key) => !RESERVED.has(key) && !(key in next));
    const changed = Object.keys(next).filter((key) => !RESERVED.has(key) && previous[key] !== next[key]);

    for (const key of removed)
    {
        if (EVENT_PROP.test(key))
        {
            if (!faults.skipEventCleanup)
            {
                state.handlers.delete(sceneEventName(key));
            }
        }
        else if (key !== 'draw')
        {
            setProp(node, key, capture(node, key));
        }
    }

    // Parent point props first, so a dashed child prop is applied after its parent.
    const ordered = [...changed].sort((a, b) => a.split('-').length - b.split('-').length);

    for (const key of ordered)
    {
        const value = next[key];

        if (EVENT_PROP.test(key))
        {
            if (typeof value === 'function')
            {
                state.handlers.set(sceneEventName(key), value as (event: unknown) => void);
            }
            else
            {
                state.handlers.delete(sceneEventName(key));
            }
        }
        else if (key === 'draw')
        {
            if (typeof value === 'function' && node instanceof FakeGraphics)
            {
                node.drawCount += 1;
                value(node);
            }
        }
        else
        {
            capture(node, key);
            setProp(node, key, value);

            // A changed parent point prop re-applies its unchanged dashed children.
            for (const child of Object.keys(next))
            {
                if (child.startsWith(`${key}-`) && !changed.includes(child))
                {
                    setProp(node, child, next[child]);
                }
            }
        }
    }
}

function setProp(node: object, key: string, value: unknown): void
{
    const state = stateOf(node);

    if (key === 'visible')
    {
        state.committedVisible = value as boolean;

        if (state.hidden)
        {
            return;
        }
    }

    assign(node, key, value);
}

/** Calls the node's handler for `type` the way a scene event system would: only for interactive nodes. */
export function dispatchFakeEvent(node: object, type: string, event: unknown = { type }): void
{
    const mode = (node as FakeContainer).eventMode;

    if (mode !== 'static' && mode !== 'dynamic')
    {
        return;
    }

    stateOf(node).handlers.get(type)?.(event);
}

/**
 * A fake implementation of the contract's `SceneSession`: the single owner of node construction and
 * destruction for one application. Its operations are journaled so scenarios can assert them.
 */
export class FakeSceneSession
{
    readonly app = new FakeApplication();
    readonly journal: SceneJournal;
    readonly faults: FakeSceneFaults;
    private readonly kindOf: (ctor: Constructor) => string;
    private readonly interceptInit?: (init: () => Promise<void>) => Promise<void>;

    constructor(options: FakeSceneSessionOptions = {})
    {
        this.journal = options.journal ?? new SceneJournal();
        this.faults = options.faults ?? {};
        this.kindOf = options.kindOf ?? (() => 'custom');
        this.interceptInit = options.interceptInit;
    }

    get container(): FakeContainer
    {
        return this.app.stage;
    }

    async init(options: FakeApplicationOptions, signal?: AbortSignal): Promise<void>
    {
        this.journal.record({ op: 'app.init', app: this.app, options });

        try
        {
            signal?.throwIfAborted();
            const run = () => this.app.init(options);

            await (this.interceptInit ? this.interceptInit(run) : run());
            this.journal.record({ op: 'app.init.settled', app: this.app });
        }
        catch (error)
        {
            this.journal.record({ op: 'app.init.settled', app: this.app, error });
            throw error;
        }
    }

    /** Applies mutable application options after initialization. */
    updateApplication(props: { resizeTo?: HTMLElement | null }): void
    {
        if ('resizeTo' in props && this.app.resizeTo !== (props.resizeTo ?? null))
        {
            this.app.resizeTo = props.resizeTo ?? null;
        }
    }

    /** The only construction path. The constructor receives the props (minus reserved keys) as options. */
    create(definition: FakeNodeDefinition, props: Props): FakeContainer
    {
        const options: Props = {};

        for (const [key, value] of Object.entries(props))
        {
            if (!RESERVED.has(key))
            {
                options[key] = value;
            }
        }

        const node = new definition.ctor(options) as FakeContainer;

        this.journal.record({ op: 'construct', kind: this.kindOf(definition.ctor), node, args: [options] });
        stateOf(node);
        applyFakeProps(node, {}, props, this.faults);

        return node;
    }

    update(node: object, previous: Props, next: Props): void
    {
        applyFakeProps(node, previous, next, this.faults);
    }

    /** The only destruction path; destroys a node at most once (twice under the `doubleDestroy` fault). */
    destroyNode(node: FakeContainer, options: FakeNodeDestroyOptions = {}): void
    {
        const state = stateOf(node);

        if (state.destroyed)
        {
            return;
        }

        state.destroyed = true;
        // Descendants are destroyed individually by the session, never by the node's own recursion.
        const nodeOptions = { ...options, children: false };
        const times = this.faults.doubleDestroy ? 2 : 1;

        for (let i = 0; i < times; i++)
        {
            this.journal.record({ op: 'destroy', node, options: nodeOptions });
            node.destroy(nodeOptions);
        }
    }

    /** Destroys a detached subtree, children first, each node exactly once. */
    destroySubtree(node: FakeContainer, options: FakeNodeDestroyOptions = {}): void
    {
        for (const child of [...node.children])
        {
            this.destroySubtree(child, options);
        }

        this.destroyNode(node, options);
    }

    append(parent: FakeContainer, child: FakeContainer): void
    {
        parent.addChild(child);
    }

    insertBefore(parent: FakeContainer, child: FakeContainer, before: FakeContainer): void
    {
        if (child.parent === parent)
        {
            parent.removeChild(child);
        }

        parent.addChild(child, parent.children.indexOf(before));
    }

    /** Detaches only; the caller destroys the subtree after commit. */
    remove(parent: FakeContainer, child: FakeContainer): void
    {
        parent.removeChild(child);
    }

    setHidden(node: FakeContainer, hidden: boolean): void
    {
        const state = stateOf(node);

        state.hidden = hidden;
        node.visible = hidden ? false : state.committedVisible;
    }

    subscribe(options: TickOptionsLike): () => void
    {
        const { callback, context, isEnabled = true, priority = 0 } = options;

        if (!isEnabled)
        {
            return () => undefined;
        }

        this.app.ticker.add(callback, context, priority);
        let subscribed = true;

        return () =>
        {
            if (subscribed && !this.faults.skipTickerCleanup)
            {
                subscribed = false;
                this.app.ticker.remove(callback, context);
            }
        };
    }

    destroy(rendererOptions?: unknown, options?: FakeNodeDestroyOptions): void
    {
        this.journal.record({ op: 'app.destroy', app: this.app, args: [rendererOptions, options] });
        this.app.destroy(rendererOptions, options);
    }
}
