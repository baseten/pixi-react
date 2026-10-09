import { ReactToPixiEventPropNames } from '../constants/EventPropNames';
import { isDiffSet } from '../helpers/isDiffSet';
import { type Change } from '../typedefs/Change';
import { type DiffSet } from '../typedefs/DiffSet';
import { type HostConfig } from '../typedefs/HostConfig';

import type { MaybeInstance } from '../helpers/applyProps';
import type { FacadeRuntime } from './composition';

/** Upstream's marker value for a removed prop in a diff set. */
const REMOVED = '__defaultremove';

function readPath(target: unknown, path: readonly string[]): unknown
{
    return path.reduce<unknown>((value, key) => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), target);
}

/**
 * Converts the deprecated diff-set form (`{ changes: [key, value, isEvent, keys][] }`) into plain props.
 * A removed prop takes the value of a blank instance of the same class, as upstream did; when the class cannot be
 * constructed without arguments, the prop keeps its value (upstream threw there: an approved failure-path repair).
 * Removed props on a non-Container become 0 and removed event handlers become `null`, as upstream's.
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
        else if (instance instanceof runtime.pixi.Container)
        {
            const Ctor = instance.constructor as new () => object;
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
                props[key] = readPath(blank, keys.length ? keys : [key]);
            }
        }
        else
        {
            props[key] = 0;
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
