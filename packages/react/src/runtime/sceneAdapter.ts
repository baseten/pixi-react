/**
 * The default facade's scene adapter: `Pixi8Adapter` plus two facade-side parity shims (D4). Neither changes the
 * adapter's defaults; a `createRenderer` composition that uses `Pixi8Adapter` directly gets the modular behaviour.
 *
 * 1. **Event props reach the constructor.** Upstream passed every React event prop to the constructor under its own
 *    name and its Pixi name (`onPointerTap` and `onpointertap`). `Pixi8Adapter` omits event props from constructor
 *    options; the shim adds them back.
 * 2. **Unsupported constructors are dropped silently.** Upstream's `extend` accepted any constructor, and a node that
 *    was neither a Container nor a Filter was constructed but never attached. `Pixi8Adapter` rejects such
 *    constructors (`UNSUPPORTED_NODE`); the facade registers them as "dropped" nodes instead: constructed and given
 *    their props as upstream did, never attached, hidden or reordered, and destroyed with `destroy()` on removal.
 */
import { ReactToPixiEventPropNames } from '../constants/EventPropNames';

import type { Constructor, NodeContext, NodeDefinition, RootTarget, Runtime, SceneSession } from '@pixi-react-provisional/core';
import type { Pixi8AdapterBase, Pixi8AdapterConstructor, Pixi8Types } from '@pixi-react-provisional/pixi-8';

type Props = Record<string, unknown>;

/** The attach rule of a dropped node: core attaches it like a child, and it accepts no children. */
export const DROPPED_NODE_ATTACH = Object.freeze({ role: 'child', accepts: Object.freeze([] as string[]) });

/** The facade's scene adapter instance type. */
export interface FacadeSceneAdapter extends Pixi8AdapterBase
{
    /** Constructors `extend` registered although Pixi8Adapter does not support them as scene nodes. */
    readonly droppedConstructors: WeakSet<object>;
}

const PIXI_EVENT_NAMES = new Set<string>(Object.values(ReactToPixiEventPropNames));

function isRecord(value: unknown): value is Props
{
    return typeof value === 'object' && value !== null;
}

/** Upstream's event constructor options: each React event prop under its React name and its Pixi name. */
function eventOptions(props: unknown): Props | undefined
{
    let events: Props | undefined;

    if (!isRecord(props))
    {
        return undefined;
    }

    for (const [key, value] of Object.entries(props))
    {
        if (Object.prototype.hasOwnProperty.call(ReactToPixiEventPropNames, key))
        {
            events ??= {};
            events[key] = value;
            events[ReactToPixiEventPropNames[key as keyof typeof ReactToPixiEventPropNames]] = value;
        }
    }

    return events;
}

/**
 * Constructor options of a dropped node: upstream's rule (props without React-owned keys, Pixi event names and
 * `draw`, plus the event options) minus dashed props, which the repaired path never passes to a constructor either.
 */
function droppedConstructorOptions(props: unknown): Props
{
    const options: Props = {};

    if (isRecord(props))
    {
        for (const [key, value] of Object.entries(props))
        {
            if (key !== 'children' && key !== 'key' && key !== 'ref' && key !== 'draw' && !key.includes('-')
                && !PIXI_EVENT_NAMES.has(key))
            {
                options[key] = value;
            }
        }
    }

    return { ...options, ...eventOptions(props) };
}

/**
 * A definition whose constructor also receives the event options. The wrapper returns the real instance, so the
 * node is exactly what `new Ctor(options)` builds; it inherits from `Ctor`, so the adapter's default lookup (which
 * walks the constructor's prototype chain) still finds the same built-in ancestor.
 */
function withEventOptions(definition: NodeDefinition, props: unknown): NodeDefinition
{
    const events = eventOptions(props);

    if (!events)
    {
        return definition;
    }

    const Ctor = definition.ctor as unknown as new (options: Props) => object;

    function FacadeConstructor(options: Props): object
    {
        return new Ctor({ ...options, ...events });
    }

    Object.setPrototypeOf(FacadeConstructor, Ctor);
    FacadeConstructor.prototype = Ctor.prototype;

    return { ...definition, ctor: FacadeConstructor as unknown as Constructor };
}

/** Installs the shims on one session. The session is the adapter's own object; only these methods are replaced. */
function patchSession(session: SceneSession<Pixi8Types>, dropped: WeakSet<object>): SceneSession<Pixi8Types>
{
    const droppedNodes = new WeakSet<object>();
    const create = session.create.bind(session);
    const update = session.update.bind(session);
    const append = session.append.bind(session);
    const insertBefore = session.insertBefore.bind(session);
    const remove = session.remove.bind(session);
    const setHidden = session.setHidden.bind(session);
    const destroyNode = session.destroyNode.bind(session);

    Object.assign(session, {
        create(definition: NodeDefinition, props: unknown, context: NodeContext<Pixi8Types>): object
        {
            if (!dropped.has(definition.ctor))
            {
                return create(withEventOptions(definition, props), props, context);
            }

            const Ctor = definition.ctor as unknown as new (options: Props) => object;
            const node = new Ctor(droppedConstructorOptions(props));

            droppedNodes.add(node);
            // Upstream applied the props of every created instance, attached or not.
            update(node, {}, props);

            return node;
        },
        append(parent: object, child: object): void
        {
            if (!droppedNodes.has(child))
            {
                append(parent, child);
            }
        },
        insertBefore(parent: object, child: object, before: object): void
        {
            if (droppedNodes.has(child))
            {
                return;
            }

            if (droppedNodes.has(before))
            {
                // The dropped sibling is not in the scene: keep the child where the scene has it, or append it.
                append(parent, child);

                return;
            }

            insertBefore(parent, child, before);
        },
        remove(parent: object, child: object): void
        {
            if (!droppedNodes.has(child))
            {
                remove(parent, child);
            }
        },
        setHidden(node: object, hidden: boolean): void
        {
            if (!droppedNodes.has(node))
            {
                setHidden(node, hidden);
            }
        },
        destroyNode(node: object, options: Pixi8Types['nodeDestroy'] | undefined): void
        {
            if (!droppedNodes.has(node))
            {
                destroyNode(node, options);

                return;
            }

            // Upstream's removeChild called destroy() without options on every removed instance.
            droppedNodes.delete(node);
            (node as { destroy?: () => void }).destroy?.();
        },
    });

    return session;
}

/** Creates the facade's scene adapter over the `Pixi8Adapter` class bound to one loaded pixi.js module. */
export function createFacadeSceneAdapter(Pixi8Adapter: Pixi8AdapterConstructor): FacadeSceneAdapter
{
    class FacadePixi8Adapter extends Pixi8Adapter implements FacadeSceneAdapter
    {
        readonly droppedConstructors = new WeakSet<object>();

        createSession(runtime: Runtime<Pixi8Types>, target: RootTarget): SceneSession<Pixi8Types>
        {
            return patchSession(super.createSession(runtime, target), this.droppedConstructors);
        }
    }

    return new FacadePixi8Adapter();
}
