/**
 * Node behaviour for one loaded pixi.js 7 module: classification into node definitions, construction (positional Pixi 7
 * constructors, `construct.ts`), props, events, visibility, Graphics `draw`, tree operations per node kind, and
 * destruction. Every per-node fact lives in a module-level `WeakMap` side table keyed by the node; nothing is written
 * onto Pixi objects except the Pixi properties the props themselves name.
 *
 * This follows the Pixi 8 adapter's `nodes.ts`; the differences are Pixi 7's: positional constructors, no `Particle`
 * (Pixi 7's `ParticleContainer` holds Sprites as ordinary children), `BitmapText` managing its own children, Mesh
 * classes taking children, and Pixi 7's filter fields.
 */
import { classChain, type ConstructorSignature, type PositionalBuiltin, signatureOf } from './construct.js';
import { isPixiEventProp, isReactEventProp, PIXI_TO_REACT_EVENT_PROP_NAMES, REACT_TO_PIXI_EVENT_PROP_NAMES } from './events.js';
import { CompatibilityError, type Constructor, type NodeDefinition } from '@pixi-react-provisional/core';

import type { PixiBinding } from './pixi.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** Manifest ID of the adapter; errors name it. */
export const ADAPTER_ID = 'pixi-7';

/**
 * Capability IDs the adapter provides (protocol version 1 each). The `pixi.*` protocol capabilities are shared with
 * the Pixi 8 adapter; `pixi7.*` are this adapter's node features. The Pixi 8 node capabilities (`pixi8.filter`,
 * `pixi8.particle`, `pixi8.render-layer`, `pixi8.dom-container`) are never provided: Pixi 7 has no `Particle`,
 * `RenderLayer` or `DOMContainer`, and a composition that requires one fails before anything is allocated.
 */
export const CAPABILITIES = Object.freeze({
    mutation: 'pixi.mutation',
    visibility: 'pixi.visibility',
    application: 'pixi.application',
    ticker: 'pixi.ticker',
    globals: 'pixi.globals',
    filter: 'pixi7.filter',
    particleContainer: 'pixi7.particle-container',
} as const);

/** The Pixi 8 capabilities this adapter never provides, and why; recorded in the manifest and the README. */
export const PIXI8_ONLY_CAPABILITIES = Object.freeze({
    'pixi8.filter': 'Pixi 8 filter attachment; Pixi 7 filters attach through pixi7.filter',
    'pixi8.particle': 'Pixi 8.5 Particle and ParticleContainer.addParticle; Pixi 7\'s ParticleContainer holds Sprites (pixi7.particle-container)',
    'pixi8.render-layer': 'RenderLayer (Pixi 8.7)',
    'pixi8.dom-container': 'DOMContainer (Pixi 8.9)',
} as const);

/**
 * Attach roles. A parent's definition lists the roles it accepts; core checks them before any mutation. Sprites (and
 * every Sprite subclass, which in Pixi 7 includes `Text` and `HTMLText`) play `sprite`, so a Pixi 7 ParticleContainer
 * can accept only them.
 */
export const ROLES = Object.freeze({ child: 'child', sprite: 'sprite', filter: 'filter' } as const);

export type NodeKind = 'container' | 'filter';

type Props = Record<string, unknown>;

/** Any class, for prototype-chain walks. */
type ClassLike = abstract new (...args: any[]) => unknown;

const RESERVED = new Set(['children', 'key', 'ref']);

/**
 * Pixi 8 property names that Pixi 7 calls something else. Assigning one would only create an unused property, so the
 * adapter warns once with the Pixi 7 name (the value is still assigned, as any unknown prop is).
 */
const RENAMED_IN_PIXI_8: Readonly<Record<string, string>> = Object.freeze({
    label: 'name',
});

/** Marks a captured value that came from the props (through the constructor), so it is not an initial value. */
const FROM_PROPS = Symbol('from-props');
/** No default could be determined. */
const NO_DEFAULT = Symbol('no-default');

/** Defaults of the base `Filter` fields (the base class needs shader arguments). `blendMode` is `BLEND_MODES.NORMAL`. */
const FILTER_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
    enabled: true,
    padding: 0,
    autoFit: true,
    blendMode: 0,
});

interface NodeState
{
    readonly kind: NodeKind;
    readonly ctor: ClassLike;
    /** Props the constructor consumed (the options object, or the positional arguments by prop name), with their values. */
    readonly options: Readonly<Props>;
    /** Props passed positionally that an update cannot apply (`construct.ts`). */
    readonly constructorOnly: ReadonlySet<string>;
    /** Values captured before a prop first changed them; `FROM_PROPS` when the constructor took the prop's value. */
    readonly initial: Map<string, unknown>;
    hidden: boolean;
    /** The latest committed value of the visibility prop (`visible` or `enabled`), if a prop set it. */
    committedVisibility?: { value: unknown };
    /** The value to restore on unhide when no prop controls visibility. */
    restoreVisibility?: unknown;
    /** Filters the renderer attached to this node, in order. */
    filters?: object[];
    /** The node a renderer-attached filter belongs to. */
    filterParent?: object | null;
    /** The renderer's children of this node in JSX order, every kind together (filters are not Pixi children). */
    jsxChildren?: object[];
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

        console.warn(`[pixi-7] ${message}`);
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

/** Built-ins whose constructors need no arguments: a blank instance supplies kind defaults. */
const SAFE_DEFAULT_BUILTINS = ['Container', 'Graphics', 'Sprite', 'Text', 'ParticleContainer', 'AlphaFilter', 'BlurFilter', 'ColorMatrixFilter', 'FXAAFilter', 'NoiseFilter'] as const;

/** The node behaviour bound to one Pixi module and one set of enabled capabilities. */
export class PixiNodes
{
    /** Per default class: its blank instance, or `null` when constructing it without arguments threw. */
    private readonly defaultInstances = new Map<ClassLike, object | null>();
    /** Per node class: the built-in whose blank instance supplies kind defaults, or `null` when there is none. */
    private readonly defaultClasses = new WeakMap<ClassLike, ClassLike | null>();
    private readonly safeDefaults: ReadonlySet<unknown>;

    constructor(readonly pixi: PixiBinding, private readonly enabled: (capability: string) => boolean)
    {
        this.safeDefaults = new Set(SAFE_DEFAULT_BUILTINS.map((name) => pixi[name]));
    }

    // ---------------------------------------------------------------- definitions

    /**
     * Pure metadata: which attach role the constructor plays and what it needs. Throws `UNSUPPORTED_NODE` in every
     * build for constructors that are not Pixi 7 scene nodes (textures, geometries, plain classes, classes of another
     * pixi.js copy such as Pixi 8) and for nodes whose capability this adapter does not provide.
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
                    process.env.NODE_ENV !== 'production'
                        ? (`"${name}" is a Pixi 7 ${label}, but capability "${capability}" is not provided: this adapter's options `
                        + 'withhold it.')
                        : '',
                    { capability, actual: { [capability]: null } },
                );
            }

            return { [capability]: 1 };
        };

        if (isSubclass(ctor, pixi.Filter))
        {
            return define(ROLES.filter, [], gated(CAPABILITIES.filter, 'Filter'));
        }

        if (isSubclass(ctor, pixi.Container))
        {
            if (isSubclass(ctor, pixi.ParticleContainer))
            {
                // Pixi 7's ParticleContainer renders only its children's Sprite textures and transforms, and its
                // `render` ignores filters: anything but a Sprite would fail at render time, so core rejects it first.
                return define(ROLES.child, [ROLES.sprite], gated(CAPABILITIES.particleContainer, 'ParticleContainer'));
            }

            if (isSubclass(ctor, pixi.BitmapText))
            {
                // BitmapText adds and removes its own glyph meshes as children on every text change, which would
                // displace React children and break core's child indices. Filters are the node's own list.
                return define(ROLES.child, [ROLES.filter], {});
            }

            const role = isSubclass(ctor, pixi.Sprite) ? ROLES.sprite : ROLES.child;

            return define(role, [ROLES.child, ROLES.sprite, ROLES.filter], {});
        }

        const named = typeof ctor === 'function' && (ctor as { name?: unknown }).name;

        throw unsupported(
            process.env.NODE_ENV !== 'production'
                ? (`"${name}" is not a renderable Pixi 7 scene node. Elements must be subclasses of the Container or Filter of the `
                + `pixi.js ${pixi.VERSION} this adapter is bound to; resources such as Texture or GraphicsGeometry are passed as `
                + 'props. Pixi 8-only classes (Particle, RenderLayer, DOMContainer, SplitText, GraphicsContext) do not exist in '
                + 'Pixi 7, and a class from another pixi.js copy (for example Pixi 8) is not a Pixi 7 node'
                + `${named ? ` (constructor ${String(named)})` : ''}.`)
                : '',
        );
    }

    private kindOfRole(role: string): NodeKind
    {
        return role === ROLES.filter ? 'filter' : 'container';
    }

    private kindOfInstance(node: object): NodeKind
    {
        return node instanceof this.pixi.Filter ? 'filter' : 'container';
    }

    /** The node's state, created on first use for nodes the session did not construct (the stage, `applyProps`). */
    private stateOf(node: object): NodeState
    {
        let state = states.get(node);

        if (!state)
        {
            state = this.newState(node, this.kindOfInstance(node), node.constructor as ClassLike, {}, new Set());
        }

        return state;
    }

    private newState(node: object, kind: NodeKind, ctor: ClassLike, options: Props, constructorOnly: ReadonlySet<string>): NodeState
    {
        const state: NodeState = { kind, ctor, options, constructorOnly, initial: new Map(), hidden: false, destroyed: false };

        states.set(node, state);

        return state;
    }

    // ---------------------------------------------------------------- construction and props

    /** The positional signature of a class (`construct.ts`), or `undefined` when it takes the options object. */
    signatureOf(ctor: unknown): ConstructorSignature | undefined
    {
        return signatureOf(ctor, this.pixi as unknown as Readonly<Record<PositionalBuiltin, unknown>>);
    }

    /**
     * The only construction path. A class with a positional signature receives those props as its arguments, and the
     * other props are applied afterwards. Any other class receives one options object: the props minus React-owned
     * keys, event handlers, `draw` and dashed props, which are all applied afterwards.
     */
    create(definition: NodeDefinition, props: unknown): object
    {
        const input = (isObjectLike(props) ? props : {}) as Props;
        const signature = this.signatureOf(definition.ctor);
        const options: Props = {};
        const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
        let node: unknown;

        if (signature)
        {
            const positional = signature.args.map(({ prop }) => (has(prop) ? input[prop] : undefined));

            for (const { prop } of signature.args)
            {
                if (has(prop))
                {
                    options[prop] = input[prop];
                }
            }

            // Trailing `undefined` arguments are dropped, so Pixi's own defaults apply exactly as in `new Sprite()`.
            while (positional.length && positional[positional.length - 1] === undefined)
            {
                positional.pop();
            }

            node = new (definition.ctor as unknown as new (...args: unknown[]) => object)(...positional);
        }
        else
        {
            for (const [key, value] of Object.entries(input))
            {
                if (!RESERVED.has(key) && key !== 'draw' && !key.includes('-') && !isReactEventProp(key) && !isPixiEventProp(key))
                {
                    options[key] = value;
                }
            }

            node = new (definition.ctor as unknown as new (options: Props) => object)(options);
        }

        if (!isObjectLike(node))
        {
            throw unsupported(process.env.NODE_ENV !== 'production' ? `The constructor of "${definition.name}" did not return an object.` : '');
        }

        const constructorOnly = new Set((signature?.args ?? []).filter((arg) => arg.update === 'constructor').map((arg) => arg.prop));

        this.newState(node, this.kindOfRole(definition.attach.role), definition.ctor, options, constructorOnly);

        try
        {
            // Positional arguments were consumed by the constructor: they are not assigned again on mount.
            const rest = signature ? Object.fromEntries(Object.entries(input).filter(([key]) => !Object.prototype.hasOwnProperty.call(options, key))) : input;

            this.applyChanges(node, {}, rest);
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
            else if (state.constructorOnly.has(key))
            {
                // Development-only: production builds drop the warning and its text (issue 58).
                if (process.env.NODE_ENV !== 'production')
                {
                    warnOnce(`constructor:${key}`, `\`${key}\` is a Pixi 7 constructor argument of this node; removing it has no effect `
                        + 'until the node is created again (change its `key`).');
                }
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
            if (!isReactEventProp(key) && !isPixiEventProp(key) && !state.constructorOnly.has(key))
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
                // Development-only: production builds drop the warning and its text (issue 58).
                if (process.env.NODE_ENV !== 'production')
                {
                    warnOnce(`event:${key}`, `Event props use PascalCase: instead of \`${key}\`, use \`${PIXI_TO_REACT_EVENT_PROP_NAMES[key]}\`.`);
                }
            }
            else if (state.constructorOnly.has(key))
            {
                // Development-only: production builds drop the warning and its text (issue 58).
                if (process.env.NODE_ENV !== 'production')
                {
                    warnOnce(`constructor:${key}`, `\`${key}\` is a Pixi 7 constructor argument of this node; changing it has no effect `
                        + 'until the node is created again (change its `key`).');
                }
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

    /** `draw` receives the Graphics node, whose Pixi 7 API is imperative (`beginFill`, `drawRect`, `endFill`). */
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
        // Development-only: production builds drop the warning and its text (issue 58).
        else if (process.env.NODE_ENV !== 'production')
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
        const value = captured === FROM_PROPS ? this.kindDefault(state, key) : captured;

        if (value === NO_DEFAULT)
        {
            // Development-only: production builds drop the warning and its text (issue 58).
            if (process.env.NODE_ENV !== 'production')
            {
                warnOnce(`restore:${key}`, `Removing the \`${key}\` prop could not restore a default value; the current value was kept.`);
            }

            return;
        }

        this.setProp(node, state, key, this.snapshot(value));
    }

    private kindDefault(state: NodeState, key: string): unknown
    {
        const path = pathOf(key);
        const instance = this.defaultInstance(state.ctor);

        if (instance)
        {
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
    private defaultInstance(ctor: ClassLike): object | undefined
    {
        const source = this.defaultClass(ctor);

        if (!source)
        {
            return undefined;
        }

        let instance = this.defaultInstances.get(source);

        if (instance === undefined)
        {
            // Only built-ins are constructed. If one cannot be constructed here (Text needs a canvas, for example, which
            // Node lacks), it supplies no kind defaults rather than breaking prop removal.
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
     * The nearest ancestor of `ctor` (itself included) among the built-ins whose constructors need no arguments
     * (`SAFE_DEFAULT_BUILTINS`). Only built-ins qualify, so a custom class is never constructed.
     */
    private defaultClass(ctor: ClassLike): ClassLike | null
    {
        let source = this.defaultClasses.get(ctor);

        if (source === undefined)
        {
            source = null;
            for (const current of classChain(ctor))
            {
                if (this.safeDefaults.has(current))
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
        return state.kind === 'filter' ? 'enabled' : 'visible';
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
            // Development-only: production builds drop the warning and its text (issue 58).
            if (process.env.NODE_ENV !== 'production')
            {
                warnOnce(`path:${key}`, `The dashed prop \`${key}\` names a missing field; it was ignored.`);
            }

            return;
        }

        if (isReadOnly(target, field))
        {
            return;
        }

        // Development-only: production builds drop the warning and its text (issue 58).
        if (process.env.NODE_ENV !== 'production' && !path.length && Object.prototype.hasOwnProperty.call(RENAMED_IN_PIXI_8, field) && !(field in target))
        {
            warnOnce(`renamed:${field}`, `\`${field}\` is a Pixi 8 property; Pixi 7 calls it \`${RENAMED_IN_PIXI_8[field]}\`.`);
        }

        target[field] = value;
    }

    /** React visibility (Suspense, Activity) layered over the user's committed `visible`/`enabled`. */
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
            target[key] = false;
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
        this.placeInOrder(parent, child, null);

        if (this.kindOf(child) === 'filter')
        {
            this.attachFilter(parent, child, null);
        }
        else
        {
            (parent as InstanceType<PixiBinding['Container']>).addChild(child as InstanceType<PixiBinding['Container']>);
        }
    }

    /**
     * `before` may be a sibling of another kind (a filter before a display node, or the reverse), which is not in the
     * child's own list: the child goes before the next sibling of its own kind in JSX order, or last.
     */
    insertBefore(parent: object, child: object, before: object): void
    {
        const next = this.placeInOrder(parent, child, before);

        if (this.kindOf(child) === 'filter')
        {
            this.attachFilter(parent, child, next);

            return;
        }

        const container = parent as InstanceType<PixiBinding['Container']>;
        const node = child as InstanceType<PixiBinding['Container']>;

        if (node.parent === container)
        {
            container.removeChild(node);
        }

        if (next)
        {
            container.addChildAt(node, container.getChildIndex(next as InstanceType<PixiBinding['Container']>));
        }
        else
        {
            container.addChild(node);
        }
    }

    /** Detaches only; destruction comes later, through `destroyNode`. */
    remove(parent: object, child: object): void
    {
        const order = this.stateOf(parent).jsxChildren ?? [];
        const index = order.indexOf(child);

        if (index !== -1)
        {
            order.splice(index, 1);
        }

        if (this.kindOf(child) === 'filter')
        {
            this.detachFilter(child);
        }
        else
        {
            (parent as InstanceType<PixiBinding['Container']>).removeChild(child as InstanceType<PixiBinding['Container']>);
        }
    }

    /**
     * Records `child` before `before` (or last) in the parent's JSX order, and returns the sibling of the child's kind
     * that now follows it, or null.
     */
    private placeInOrder(parent: object, child: object, before: object | null): object | null
    {
        const order = (this.stateOf(parent).jsxChildren ??= []);
        const existing = order.indexOf(child);

        if (existing !== -1)
        {
            order.splice(existing, 1);
        }

        const index = before ? order.indexOf(before) : -1;

        if (index === -1)
        {
            order.push(child);

            return null;
        }

        order.splice(index, 0, child);

        const kind = this.kindOf(child);

        return order.find((sibling, at) => at > index && this.kindOf(sibling) === kind) ?? null;
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

    // ---------------------------------------------------------------- destruction

    /**
     * The only destruction path. Display objects get the destroy options unchanged (Pixi 7's `IDestroyOptions`:
     * `children`, `texture`, `baseTexture`; their own `children: true` then also destroys children the renderer does not
     * own; the renderer destroys its own children first). Filters are destroyed without options (Pixi 7's
     * `Filter.destroy` takes none).
     */
    destroyNode(node: object, options: unknown): void
    {
        const state = this.stateOf(node);

        if (state.destroyed)
        {
            return;
        }

        state.destroyed = true;

        if (state.kind === 'filter')
        {
            this.detachFilter(node);
            (node as { destroy(): void }).destroy();
        }
        else
        {
            (node as { destroy(options?: unknown): void }).destroy(options);
        }
    }

    /** Whether `destroyNode` already ran for `node`. */
    isDestroyed(node: object): boolean
    {
        return states.get(node)?.destroyed ?? false;
    }
}
