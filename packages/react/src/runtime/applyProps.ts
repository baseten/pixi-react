import { ReactToPixiEventPropNames } from '../constants/EventPropNames';
import { isDiffSet } from '../helpers/isDiffSet';
import { type Change } from '../typedefs/Change';
import { type DiffSet } from '../typedefs/DiffSet';
import { type HostConfig } from '../typedefs/HostConfig';

import type { MaybeInstance } from '../helpers/applyProps';
import type { FacadeRuntime } from './composition';

/** Upstream's marker value for a removed prop in a diff set. */
const REMOVED = '__defaultremove';

/** Upstream's dashed-key step: descends into a non-nullish value, otherwise stays on the current target. */
function targetKeyReducer(target: unknown, key: string): unknown
{
    const value = target !== null && typeof target === 'object' ? (target as Record<string, unknown>)[key] : undefined;

    return value === undefined || value === null ? target : value;
}

/**
 * Resolves the object and key a removed prop is reset on, as upstream did: a dashed prop whose final value has no
 * `set` method is reset on its parent object (`scale-x` resets `x` on the `scale` point).
 */
function resolveRemovalTarget(instance: object, key: string, keys: readonly string[]): [target: unknown, name: string]
{
    if (!keys.length)
    {
        return [instance, key];
    }

    const resolved = keys.reduce(targetKeyReducer, instance as unknown);

    if (resolved && typeof (resolved as { set?: unknown }).set === 'function')
    {
        return [instance, key];
    }

    return [keys.slice(0, -1).reduce(targetKeyReducer, instance as unknown), keys[keys.length - 1]];
}

/**
 * Converts the deprecated diff-set form (`{ changes: [key, value, isEvent, keys][] }`) into plain props.
 * A removed prop takes the value of a blank instance of the same class, as upstream did; when the class cannot be
 * constructed without arguments, the prop keeps its value (upstream threw there: an approved failure-path repair).
 * Dashed props are resolved to their nested target first, so a removed prop whose target is not a Container (such as
 * `scale-x`) becomes 0, as upstream's. Removed event handlers become `null`.
 */
function diffSetToProps(runtime: FacadeRuntime, instance: object, changes: readonly Change[], blanks: WeakMap<object, object | null>)
{
    const props: Record<string, unknown> = {};

    for (const [key, value, isEvent, keys] of changes)
    {
        if (value !== REMOVED)
        {
            props[key] = value;
        }
        else if (isEvent || Object.prototype.hasOwnProperty.call(ReactToPixiEventPropNames, key))
        {
            props[key] = null;
        }
        else
        {
            const [target, name] = resolveRemovalTarget(instance, key, keys);

            if (!(target instanceof runtime.pixi.Container))
            {
                props[key] = 0;
                continue;
            }

            const Ctor = target.constructor as new () => object;
            let blank = blanks.get(Ctor);

            if (blank === undefined)
            {
                try
                {
                    blank = new Ctor();
                }
                catch
                {
                    blank = null;
                }

                blanks.set(Ctor, blank);
            }

            if (blank)
            {
                props[key] = (blank as Record<string, unknown>)[name];
            }
        }
    }

    return props;
}

/** Creates the facade's standalone `applyProps`, which applies props through the Pixi 8 adapter. */
export function createApplyProps(runtime: FacadeRuntime)
{
    const blanks = new WeakMap<object, object | null>();

    /** Apply properties to Pixi.js instance. */
    return function applyProps(
        instance: MaybeInstance,
        data: HostConfig['props'] | DiffSet,
    ): MaybeInstance
    {
        const props = isDiffSet(data) ? diffSetToProps(runtime, instance, data.changes, blanks) : data;

        runtime.scene.applyProps(instance, props);

        return instance;
    };
}
