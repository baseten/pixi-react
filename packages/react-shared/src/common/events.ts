/**
 * The baseline mapping of DOM event types to reconciler event priorities, shared by every adapter package. Scene
 * events are dispatched from DOM events, so the event being dispatched decides the priority of an update it causes.
 * Each package passes its own reconciler's priority constants.
 */

const DISCRETE_EVENTS = new Set(['click', 'contextmenu', 'dblclick', 'pointercancel', 'pointerdown', 'pointerup']);
const CONTINUOUS_EVENTS = new Set(['pointermove', 'pointerout', 'pointerover', 'pointerenter', 'pointerleave', 'wheel']);

/** The DOM event being dispatched, if any (scene events are dispatched from DOM events). */
export function currentEvent(): { type?: string; timeStamp?: number } | undefined
{
    const scope = (typeof self !== 'undefined' && self) || (typeof window !== 'undefined' && window) || undefined;

    return (scope as { event?: { type?: string; timeStamp?: number } } | undefined)?.event;
}

/** The priorities of one reconciler line, from its own `constants` module. */
export interface EventPriorityLevels
{
    readonly DiscreteEventPriority: number;
    readonly ContinuousEventPriority: number;
    readonly DefaultEventPriority: number;
}

/** The priority of an update caused by the DOM event being dispatched (default outside an event). */
export function currentEventPriority(levels: EventPriorityLevels): number
{
    const type = currentEvent()?.type;

    if (type && DISCRETE_EVENTS.has(type))
    {
        return levels.DiscreteEventPriority;
    }

    if (type && CONTINUOUS_EVENTS.has(type))
    {
        return levels.ContinuousEventPriority;
    }

    return levels.DefaultEventPriority;
}
