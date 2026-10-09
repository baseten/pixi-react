/**
 * Node behaviour for one loaded Pixi module: classification into node definitions, construction, props, events,
 * visibility, Graphics `draw`, tree operations per node kind, and destruction. Every per-node fact lives in a
 * module-level `WeakMap` side table keyed by the node; nothing is written onto Pixi objects except the Pixi
 * properties the props themselves name.
 */
import { BuiltinMatcher, type BuiltinName, classChain } from './builtins.js';
import { isPixiEventProp, isReactEventProp, PIXI_TO_REACT_EVENT_PROP_NAMES, REACT_TO_PIXI_EVENT_PROP_NAMES } from './events.js';
import { isAtLeast, parseVersion, PIXI8_BOUNDARIES } from './version.js';
import { CompatibilityError, type Constructor, type NodeDefinition } from '@pixi-react-provisional/core';

import type { ParticleContainerLike, ParticleLike, PixiBinding } from './pixi.js';

/** Manifest ID of the adapter; errors name it. */
export const ADAPTER_ID = 'pixi-8';

/** Capability IDs the adapter provides (protocol version 1 each). */
export const CAPABILITIES = Object.freeze({
    mutation: 'pixi.mutation',
    visibility: 'pixi.visibility',
    application: 'pixi.application',
    ticker: 'pixi.ticker',
    globals: 'pixi.globals',
    filter: 'pixi8.filter',
    particle: 'pixi8.particle',
    renderLayer: 'pixi8.render-layer',
    domContainer: 'pixi8.dom-container',
} as const);

/** Attach roles. A parent's definition lists the roles it accepts; core checks them before any mutation. */
export const ROLES = Object.freeze({ child: 'child', filter: 'filter', particle: 'particle' } as const);

export type NodeKind = 'container' | 'filter' | 'particle';

type Props = Record<string, unknown>;

/** Any class, for prototype-chain walks. */
type ClassLike = abstract new (...args: any[]) => unknown;

const RESERVED = new Set(['children', 'key', 'ref']);

/** Marks a captured value that came from the props (through the constructor), so it is not an initial value. */
const FROM_PROPS = Symbol('from-props');
/** No default could be determined. */
const NO_DEFAULT = Symbol('no-default');

/** Defaults of the Pixi 8.5+ `Particle` fields (its constructor needs a texture, so no default instance is built). */
const PARTICLE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0,
    anchorY: 0,
    rotation: 0,
    tint: 0xffffff,
    alpha: 1,
});

/** Defaults of the base `Filter` fields (the base class needs shader arguments). */
const FILTER_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
    enabled: true,
    padding: 0,
    antialias: 'off',
    blendMode: 'normal',
});

interface NodeState
{
    readonly kind: NodeKind;
    readonly ctor: ClassLike;
    /** Keys passed to the constructor as options, with their values. */
    readonly options: Readonly<Props>;
    /** Values captured before a prop first changed them; `FROM_PROPS` when the constructor took the prop's value. */
    readonly initial: Map<string, unknown>;
    hidden: boolean;
    /** The latest committed value of the visibility prop (`visible`, `enabled` or `alpha`), if a prop set it. */
    committedVisibility?: { value: unknown };
    /** The value to restore on unhide when no prop controls visibility. */
    restoreVisibility?: unknown;
    /** Filters the renderer attached to this node, in order. */
    filters?: object[];
    /** The node a renderer-attached filter belongs to. */
    filterParent?: object | null;
    /** The ParticleContainer a particle belongs to. */
    particleParent?: ParticleContainerLike | null;
    destroyed: boolean;
}

const states = new WeakMap<object, NodeState>();
const warned = new Set<string>();

/** Forgets which warnings were shown. For tests only; not exported from the package. */
export function resetWarnings(): void
{
    warned.clear();
}

function warnOnce(key: string, message: string): void
{
    if (!warned.has(key))
    {
        warned.add(key);

        console.warn(`[pixi-8] ${message}`);
    }
}

function isObjectLike(value: unknown): value is Record<string, any>
{
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isPointLike(value: unknown): value is { x: number; y: number }
{
    return isObjectLike(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isPlainObject(value: unknown): value is Props
{
    if (!isObjectLike(value) || typeof value === 'function')
    {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

function isSubclass(ctor: unknown, base: unknown): boolean
{
    return typeof ctor === 'function' && typeof base === 'function'
        && (ctor === base || ctor.prototype instanceof base);
}

function readPath(target: unknown, path: readonly string[]): unknown
{
    return path.reduce<unknown>((value, key) => (isObjectLike(value) ? value[key] : undefined), target);
}

/** Whether `key` is a getter-only accessor or a non-writable data property anywhere on the prototype chain. */
function isReadOnly(target: object, key: string): boolean
{
    for (let current: object | null = target; current; current = Object.getPrototypeOf(current))
    {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);

        if (descriptor)
        {
            return 'value' in descriptor ? descriptor.writable === false : descriptor.set === undefined;
        }
    }

    return false;
}

/** Whether the value the constructor left equals the option it was given (by value for points and plain objects). */
function matchesOption(current: unknown, option: unknown): boolean
{
    if (Object.is(current, option))
    {
        return true;
    }

    if (isPointLike(current) && isPointLike(option))
    {
        return current.x === option.x && current.y === option.y;
    }

    if (isObjectLike(current) && isPlainObject(option))
    {
        return Object.keys(option).every((key) => matchesOption(current[key], option[key]));
    }

    return false;
}

/** Splits `position-x` into its path; props are applied parents first. */
function pathOf(key: string): string[]
{
    return key.split('-');
}

function unsupported(message: string, extra: { capability?: string; actual?: Record<string, string | number | boolean | null> } = {}): CompatibilityError
{
    return new CompatibilityError(message, { code: 'UNSUPPORTED_NODE', adapterIds: [ADAPTER_ID], ...extra });
}

/** Detected optional features of a loaded Pixi module. */
export interface PixiFeatures
{
    readonly particles: boolean;
    readonly renderLayer: boolean;
    readonly domContainer: boolean;
    /** `removeParticles(begin, end)` takes an end index (8.10+); before, the second argument was a count. */
    readonly removeParticlesEndIndex: boolean;
}

/**
 * The optional features of the installed Pixi, from its `VERSION`. They are not detected from the module's exports:
 * reading `Particle` or `RenderLayer` would keep those classes (and everything they import) in every application
 * bundle, registered or not. An unparseable version has none of them, and `checkEnvironment` rejects it anyway.
 */
export function detectFeatures(pixi: { readonly VERSION: string }): PixiFeatures
{
    const version = parseVersion(pixi.VERSION);
    const since = (boundary: string) => (version ? isAtLeast(version, boundary) : false);

    return Object.freeze({
        particles: since(PIXI8_BOUNDARIES.particles),
        renderLayer: since(PIXI8_BOUNDARIES.renderLayer),
        domContainer: since(PIXI8_BOUNDARIES.domContainer),
        removeParticlesEndIndex: version ? isAtLeast(version, PIXI8_BOUNDARIES.removeParticlesEndIndex) : true,
    });
}

/** Built-ins whose constructors need no arguments, recognized by signature: a blank instance supplies kind defaults. */
const SAFE_DEFAULT_BUILTINS: readonly BuiltinName[] = ['Sprite', 'TilingSprite', 'AlphaFilter', 'BlurFilter', 'ColorMatrixFilter', 'NoiseFilter'];

/** The node behaviour bound to one Pixi module and one set of enabled capabilities. */
export class PixiNodes
{
    readonly features: PixiFeatures;
    /** Recognizes the built-ins the adapter does not import (see `builtins.ts`). */
    readonly builtins: BuiltinMatcher;
    /** Per default class: its blank instance, or `null` when constructing it without arguments threw. */
    private readonly defaultInstances = new Map<ClassLike, object | null>();
    /** Per node class: the built-in whose blank instance supplies kind defaults, or `null` when there is none. */
    private readonly defaultClasses = new WeakMap<ClassLike, ClassLike | null>();

    constructor(readonly pixi: PixiBinding, private readonly enabled: (capability: string) => boolean)
    {
        this.features = detectFeatures(pixi);
        this.builtins = new BuiltinMatcher(pixi);
    }

    // ---------------------------------------------------------------- definitions

    /**
     * Pure metadata: which attach role the constructor plays and what it needs. Throws `UNSUPPORTED_NODE` in every
     * build for constructors that are not scene nodes (textures, contexts, plain classes) and for nodes whose
     * capability the installed Pixi or this adapter does not provide.
     */
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        const { pixi } = this;
        const define = (role: string, accepts: string[], capabilities: Record<string, number>): NodeDefinition<C> =>
            ({ name, ctor, capabilities: { [CAPABILITIES.mutation]: 1, ...capabilities }, attach: { role, accepts } });
        const gated = (capability: string, label: string) =>
        {
            if (!this.enabled(capability))
            {
                throw unsupported(
                    `"${name}" is a Pixi ${label}, but capability "${capability}" is not provided: pixi.js ${pixi.VERSION} `
                    + 'or this adapter\'s options do not support it.',
                    { capability, actual: { [capability]: null } },
                );
            }

            return { [capability]: 1 };
        };

        const { builtins } = this;

        if (isSubclass(ctor, pixi.Filter))
        {
            return define(ROLES.filter, [], gated(CAPABILITIES.filter, 'Filter'));
        }

        if (isSubclass(ctor, pixi.Container))
        {
            if (builtins.is(ctor, 'ParticleContainer'))
            {
                return define(ROLES.child, [ROLES.particle, ROLES.filter], gated(CAPABILITIES.particle, 'ParticleContainer'));
            }

            if (builtins.is(ctor, 'RenderLayer'))
            {
                // Layer membership is imperative (`layer.attach(node)` through a ref); JSX children are rejected by core.
                return define(ROLES.child, [], gated(CAPABILITIES.renderLayer, 'RenderLayer'));
            }

            if (builtins.is(ctor, 'DOMContainer'))
            {
                return define(ROLES.child, [], gated(CAPABILITIES.domContainer, 'DOMContainer'));
            }

            if (builtins.is(ctor, 'AbstractSplitText'))
            {
                // The node generates its own line, word and character children from `text` and rebuilds them on every
                // text or style change, re-adding the lines at the end. React children would be displaced from their
                // JSX order and core's child indices would no longer match. Filters are the node's own list and survive.
                return define(ROLES.child, [ROLES.filter], {});
            }

            if (builtins.is(ctor, 'Mesh'))
            {
                // Mesh, MeshPlane, MeshRope, MeshSimple and PerspectiveMesh set `allowChildren = false`: Pixi deprecates
                // `addChild` on them. Their own geometry and texture are props, and filters are the node's own list.
                return define(ROLES.child, [ROLES.filter], {});
            }

            return define(ROLES.child, [ROLES.child, ROLES.filter], {});
        }

        if (builtins.is(ctor, 'Particle'))
        {
            return define(ROLES.particle, [], gated(CAPABILITIES.particle, 'Particle'));
        }

        throw unsupported(
            `"${name}" is not a renderable Pixi 8 scene node. Elements must be Container subclasses, Filters or (with `
            + `"${CAPABILITIES.particle}") Particles; resources such as Texture or GraphicsContext are passed as props.`,
        );
    }

    private kindOfRole(role: string): NodeKind
    {
        if (role === ROLES.filter)
        {
            return 'filter';
        }

        return role === ROLES.particle ? 'particle' : 'container';
    }

    private kindOfInstance(node: object): NodeKind
    {
        if (this.builtins.is(node.constructor, 'Particle'))
        {
            return 'particle';
        }

        return node instanceof this.pixi.Filter ? 'filter' : 'container';
    }

    /** The node's state, created on first use for nodes the session did not construct (the stage, `applyProps`). */
    private stateOf(node: object): NodeState
    {
        let state = states.get(node);

        if (!state)
        {
            state = this.newState(node, this.kindOfInstance(node), node.constructor as ClassLike, {});
        }

        return state;
    }

    private newState(node: object, kind: NodeKind, ctor: ClassLike, options: Props): NodeState
    {
        const state: NodeState = { kind, ctor, options, initial: new Map(), hidden: false, destroyed: false };

        states.set(node, state);

        return state;
    }

    // ---------------------------------------------------------------- construction and props

    /**
     * The only construction path. The constructor receives one options object: the props minus React-owned
     * keys, event handlers, `draw` and dashed props (which are applied afterwards, so they reach nested fields).
     */
    create(definition: NodeDefinition, props: unknown): object
    {
        const input = (isObjectLike(props) ? props : {}) as Props;
        const options: Props = {};

        for (const [key, value] of Object.entries(input))
        {
            if (!RESERVED.has(key) && key !== 'draw' && !key.includes('-') && !isReactEventProp(key) && !isPixiEventProp(key))
            {
                options[key] = value;
            }
        }

        const Ctor = definition.ctor as unknown as new (options: Props) => object;
        const node = new Ctor(options);

        if (!isObjectLike(node))
        {
            throw unsupported(`The constructor of "${definition.name}" did not return an object.`);
        }

        this.newState(node, this.kindOfRole(definition.attach.role), definition.ctor, options);

        try
        {
            this.applyChanges(node, {}, input);
        }
        catch (error)
        {
            // The node never reached core: destroy it here so a failed construction leaks nothing.
            try
            {
                this.destroyNode(node, undefined);
            }
            catch
            {
                // The prop error is the one to report.
            }

            throw error;
        }

        return node;
    }

    /** Applies the difference between two committed prop objects. */
    applyChanges(node: object, previousProps: unknown, nextProps: unknown): void
    {
        const previous = (isObjectLike(previousProps) ? previousProps : {}) as Props;
        const next = (isObjectLike(nextProps) ? nextProps : {}) as Props;
        const state = this.stateOf(node);
        const has = (props: Props, key: string) => Object.prototype.hasOwnProperty.call(props, key);
        const removed = Object.keys(previous).filter((key) => !RESERVED.has(key) && !has(next, key));
        const changed = Object.keys(next).filter((key) => !RESERVED.has(key) && (!has(previous, key) || !Object.is(previous[key], next[key])));
        const touched: string[] = [];
        const reapply = new Set<string>();

        const removedKeys = new Set(removed);

        for (const key of removed)
        {
            const path = pathOf(key);

            // A dashed child removed together with one of its ancestors is covered by that ancestor's restoration;
            // restoring it separately would overwrite the ancestor's captured value with a class default.
            if (path.slice(1).some((_, i) => removedKeys.has(path.slice(0, i + 1).join('-'))))
            {
                continue;
            }

            if (isReactEventProp(key))
            {
                this.setHandler(node, key, null);
            }
            else if (key !== 'draw' && !isPixiEventProp(key))
            {
                const [parent] = pathOf(key);

                if (parent !== key && has(next, parent))
                {
                    // The parent prop still holds the whole value: re-applying it resets this nested field.
                    reapply.add(parent);
                }
                else
                {
                    this.restore(node, state, key);

                    if (key === this.visibilityKey(state))
                    {
                        // The prop no longer controls visibility. While hidden, the restored value is what unhide
                        // brings back; after that, a hide/unhide cycle restores whatever the node holds at hide time.
                        if (state.hidden)
                        {
                            state.restoreVisibility = state.committedVisibility?.value;
                        }

                        state.committedVisibility = undefined;
                    }

                    touched.push(key);
                }
            }
        }

        // Parents before their dashed children, so `position` then `position-x`.
        const ordered = changed
            .filter((key) => key !== 'draw')
            .sort((a, b) => pathOf(a).length - pathOf(b).length);

        // Capture every initial value before this change set writes any of them.
        for (const key of ordered)
        {
            if (!isReactEventProp(key) && !isPixiEventProp(key))
            {
                this.capture(node, state, key, next);
            }
        }

        for (const key of ordered)
        {
            const value = next[key];

            if (isReactEventProp(key))
            {
                this.setHandler(node, key, value);
            }
            else if (isPixiEventProp(key))
            {
                warnOnce(`event:${key}`, `Event props use PascalCase: instead of \`${key}\`, use \`${PIXI_TO_REACT_EVENT_PROP_NAMES[key]}\`.`);
            }
            else
            {
                this.setProp(node, state, key, value);
                touched.push(key);
            }
        }

        for (const parent of reapply)
        {
            if (!changed.includes(parent))
            {
                this.setProp(node, state, parent, next[parent]);
                touched.push(parent);
            }
        }

        // A changed or reset parent prop re-applies its unchanged dashed children.
        for (const parent of touched)
        {
            for (const key of Object.keys(next))
            {
                if (key.startsWith(`${parent}-`) && !changed.includes(key))
                {
                    this.setProp(node, state, key, next[key]);
                }
            }
        }

        if (changed.includes('draw'))
        {
            this.draw(node, next.draw);
        }
    }

    private setHandler(node: object, key: string, handler: unknown): void
    {
        (node as Props)[REACT_TO_PIXI_EVENT_PROP_NAMES[key]] = typeof handler === 'function' ? handler : null;
    }

    private draw(node: object, callback: unknown): void
    {
        if (typeof callback !== 'function')
        {
            return;
        }

        if (node instanceof this.pixi.Graphics)
        {
            callback(node);
        }
        else
        {
            warnOnce(`draw:${String(node.constructor?.name)}`, 'The `draw` prop is only valid on Graphics nodes; it was ignored.');
        }
    }

    /**
     * Records the value a prop is about to replace. A value the constructor took from the props is not an initial
     * value (`FROM_PROPS`), and neither is a nested field whose parent is itself a prop: both restore the kind default.
     */
    private capture(node: object, state: NodeState, key: string, next: Props): void
    {
        if (state.initial.has(key))
        {
            return;
        }

        const path = pathOf(key);
        // While hidden by React, the node holds the hidden value; the value to keep is the one from before the hide.
        const current = state.hidden && key === this.visibilityKey(state) ? state.restoreVisibility : readPath(node, path);
        const own = (props: Readonly<Props>, name: string) => Object.prototype.hasOwnProperty.call(props, name);
        const fromProps = path.length > 1
            ? own(state.options, path[0]) || own(next, path[0])
            : own(state.options, key) && matchesOption(current, state.options[key]);

        state.initial.set(key, fromProps ? FROM_PROPS : this.snapshot(current));
    }

    /** Copies values that Pixi mutates in place, so a captured value stays the value it was. */
    private snapshot(value: unknown): unknown
    {
        if (value instanceof this.pixi.TextStyle)
        {
            return value.clone();
        }

        if (value instanceof this.pixi.ObservablePoint || value instanceof this.pixi.Point)
        {
            return { x: value.x, y: value.y };
        }

        return value;
    }

    /** Restores a removed prop to the captured initial value, else the kind default; never constructs the node's class. */
    private restore(node: object, state: NodeState, key: string): void
    {
        const captured = state.initial.has(key) ? state.initial.get(key) : FROM_PROPS;
        const value = captured === FROM_PROPS ? this.kindDefault(node, state, key) : captured;

        if (value === NO_DEFAULT)
        {
            warnOnce(`restore:${key}`, `Removing the \`${key}\` prop could not restore a default value; the current value was kept.`);

            return;
        }

        this.setProp(node, state, key, this.snapshot(value));
    }

    private kindDefault(node: object, state: NodeState, key: string): unknown
    {
        const path = pathOf(key);

        if (state.kind === 'particle')
        {
            return path.length === 1 && key in PARTICLE_DEFAULTS ? PARTICLE_DEFAULTS[key] : NO_DEFAULT;
        }

        const instance = this.defaultInstance(node, state.ctor);

        if (instance)
        {
            // A signature-only custom class (see defaultInstance) may throw from its accessors on a blank instance.
            try
            {
                const parent = readPath(instance, path.slice(0, -1));

                if (isObjectLike(parent) && path[path.length - 1] in parent)
                {
                    return parent[path[path.length - 1]];
                }
            }
            catch
            {
                // No kind default from this instance.
            }
        }

        if (state.kind === 'filter' && path.length === 1 && key in FILTER_DEFAULTS)
        {
            return FILTER_DEFAULTS[key];
        }

        return NO_DEFAULT;
    }

    /** A cached blank instance of the nearest built-in ancestor whose constructor needs no arguments. */
    private defaultInstance(node: object, ctor: ClassLike): object | undefined
    {
        const source = this.defaultClass(node, ctor);

        if (!source)
        {
            return undefined;
        }

        let instance = this.defaultInstances.get(source);

        if (instance === undefined)
        {
            // Only built-ins are constructed, but a custom class declaring a whole built-in signature without
            // extending it is recognized as that built-in (see builtins.ts). If its constructor needs arguments, it
            // has no kind defaults rather than breaking prop removal.
            try
            {
                instance = new (source as new () => object)();
            }
            catch
            {
                instance = null;
            }
            this.defaultInstances.set(source, instance);
        }

        return instance ?? undefined;
    }

    /**
     * The nearest ancestor of `ctor` (itself included) whose constructor needs no arguments: `Container`, `Graphics`,
     * `Text`, or a built-in in `SAFE_DEFAULT_BUILTINS`. Only built-ins qualify, so a custom class is never constructed.
     * `Text` shares its signature with `BitmapText` and `HTMLText` (all three extend `AbstractText` directly), so it is
     * told apart by the render pipe its instances use.
     */
    private defaultClass(node: object, ctor: ClassLike): ClassLike | null
    {
        let source = this.defaultClasses.get(ctor);

        if (source === undefined)
        {
            const { builtins, pixi } = this;
            const safe = new Set<unknown>([pixi.Container, pixi.Graphics, ...SAFE_DEFAULT_BUILTINS.map((name) => builtins.builtinOf(ctor, name))]);

            if ((node as { renderPipeId?: unknown }).renderPipeId === 'text')
            {
                safe.add(builtins.childOf(ctor, 'AbstractText'));
            }

            source = null;
            for (const current of classChain(ctor))
            {
                if (safe.has(current))
                {
                    source = current as ClassLike;
                    break;
                }
            }

            this.defaultClasses.set(ctor, source);
        }

        return source;
    }

    private visibilityKey(state: NodeState): string
    {
        if (state.kind === 'filter')
        {
            return 'enabled';
        }

        return state.kind === 'particle' ? 'alpha' : 'visible';
    }

    private setProp(node: object, state: NodeState, key: string, value: unknown): void
    {
        if (key === this.visibilityKey(state))
        {
            state.committedVisibility = { value };

            if (state.hidden)
            {
                return;
            }
        }

        const path = pathOf(key);
        const field = path.pop()!;
        const target = readPath(node, path);

        if (!isObjectLike(target))
        {
            warnOnce(`path:${key}`, `The dashed prop \`${key}\` names a missing field; it was ignored.`);

            return;
        }

        if (isReadOnly(target, field))
        {
            return;
        }

        target[field] = value;
    }

    /** React visibility (Suspense, Activity) layered over the user's committed `visible`/`enabled`/`alpha`. */
    setHidden(node: object, hidden: boolean): void
    {
        const state = this.stateOf(node);
        const key = this.visibilityKey(state);
        const target = node as Props;

        if (hidden === state.hidden)
        {
            return;
        }

        if (hidden)
        {
            state.restoreVisibility = target[key];
            state.hidden = true;
            target[key] = state.kind === 'particle' ? 0 : false;
        }
        else
        {
            state.hidden = false;
            target[key] = state.committedVisibility ? state.committedVisibility.value : state.restoreVisibility;
        }
    }

    // ---------------------------------------------------------------- tree

    private kindOf(node: object): NodeKind
    {
        return this.stateOf(node).kind;
    }

    append(parent: object, child: object): void
    {
        switch (this.kindOf(child))
        {
            case 'filter':
                this.attachFilter(parent, child, null);
                break;
            case 'particle':
                this.attachParticle(parent as ParticleContainerLike, child as ParticleLike, null);
                break;
            default:
                (parent as InstanceType<PixiBinding['Container']>).addChild(child as InstanceType<PixiBinding['Container']>);
        }
    }

    insertBefore(parent: object, child: object, before: object): void
    {
        switch (this.kindOf(child))
        {
            case 'filter':
                this.attachFilter(parent, child, before);
                break;
            case 'particle':
                this.attachParticle(parent as ParticleContainerLike, child as ParticleLike, before as ParticleLike);
                break;
            default:
            {
                const container = parent as InstanceType<PixiBinding['Container']>;
                const node = child as InstanceType<PixiBinding['Container']>;

                if (node.parent === container)
                {
                    container.removeChild(node);
                }

                container.addChildAt(node, container.getChildIndex(before as InstanceType<PixiBinding['Container']>));
            }
        }
    }

    /** Detaches only; destruction comes later, through `destroyNode`. */
    remove(parent: object, child: object): void
    {
        switch (this.kindOf(child))
        {
            case 'filter':
                this.detachFilter(child);
                break;
            case 'particle':
                this.detachParticle(child as ParticleLike);
                break;
            default:
                (parent as InstanceType<PixiBinding['Container']>).removeChild(child as InstanceType<PixiBinding['Container']>);
        }
    }

    /** Filters keep their JSX order in the parent's `filters`; reordering looks up the parent's list. */
    private attachFilter(parent: object, filter: object, before: object | null): void
    {
        const filterState = this.stateOf(filter);

        if (filterState.filterParent && filterState.filterParent !== parent)
        {
            this.detachFilter(filter);
        }

        const parentState = this.stateOf(parent);
        const list = (parentState.filters ??= []);
        const existing = list.indexOf(filter);

        if (existing !== -1)
        {
            list.splice(existing, 1);
        }

        const index = before ? list.indexOf(before) : -1;

        if (index === -1)
        {
            list.push(filter);
        }
        else
        {
            list.splice(index, 0, filter);
        }

        filterState.filterParent = parent;
        (parent as Props).filters = [...list];
    }

    private detachFilter(filter: object): void
    {
        const filterState = this.stateOf(filter);
        const parent = filterState.filterParent;

        filterState.filterParent = null;

        if (!parent)
        {
            return;
        }

        const list = this.stateOf(parent).filters ?? [];
        const index = list.indexOf(filter);

        if (index !== -1)
        {
            list.splice(index, 1);
        }

        if (!(parent as { destroyed?: boolean }).destroyed)
        {
            (parent as Props).filters = list.length ? [...list] : null;
        }
    }

    /** Particles join a ParticleContainer through addParticle/addParticleAt, never addChild. */
    private attachParticle(parent: ParticleContainerLike, particle: ParticleLike, before: ParticleLike | null): void
    {
        const state = this.stateOf(particle);

        if (state.particleParent)
        {
            this.detachParticle(particle);
        }

        const index = before ? parent.particleChildren.indexOf(before) : -1;

        if (index === -1)
        {
            parent.addParticle(particle);
        }
        else
        {
            parent.addParticleAt(particle, index);
        }

        state.particleParent = parent;
    }

    private detachParticle(particle: ParticleLike): void
    {
        const state = this.stateOf(particle);
        const parent = state.particleParent;

        state.particleParent = null;

        if (!parent)
        {
            return;
        }

        const index = parent.particleChildren.indexOf(particle);

        if (index !== -1)
        {
            this.removeParticleRange(parent, index, index + 1);
        }
    }

    /**
     * Removes the particles in `[begin, end)` with explicit indices on every supported version. Before 8.10,
     * `removeParticles(begin, end)` passed `end` to `splice` as a delete count, and omitting it removed nothing;
     * from 8.10 `end` is an end index and omitting it removes to the end. Never call it without both indices.
     */
    removeParticleRange(container: ParticleContainerLike, begin: number, end: number): ParticleLike[]
    {
        const length = container.particleChildren.length;
        const from = Math.max(0, Math.min(begin, length));
        const to = Math.max(from, Math.min(end, length));

        if (to === from)
        {
            return [];
        }

        return container.removeParticles(from, this.features.removeParticlesEndIndex ? to : to - from);
    }

    // ---------------------------------------------------------------- destruction

    /**
     * The only destruction path. Containers get the destroy options unchanged (their own `children: true` then also
     * destroys children the renderer does not own; the renderer destroys its own children first). Filters are
     * destroyed without options, because `Filter.destroy(true)` would destroy shared GPU programs. Particles have no
     * `destroy`: they are detached, and their texture is destroyed only when the options ask for it.
     */
    destroyNode(node: object, options: unknown): void
    {
        const state = this.stateOf(node);

        if (state.destroyed)
        {
            return;
        }

        state.destroyed = true;

        switch (state.kind)
        {
            case 'filter':
                this.detachFilter(node);
                (node as { destroy(): void }).destroy();
                break;
            case 'particle':
            {
                this.detachParticle(node as ParticleLike);

                const flags = options as { texture?: boolean; textureSource?: boolean } | boolean | undefined;

                if (flags === true || (isObjectLike(flags) && flags.texture))
                {
                    (node as ParticleLike).texture?.destroy(flags === true || Boolean(flags.textureSource));
                }
                break;
            }
            default:
                (node as { destroy(options?: unknown): void }).destroy(options);
        }
    }

    /** Whether `destroyNode` already ran for `node`. */
    isDestroyed(node: object): boolean
    {
        return states.get(node)?.destroyed ?? false;
    }
}
