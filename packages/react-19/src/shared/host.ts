/**
 * The host operations every React 19 epoch shares. They translate reconciler calls into core's scene protocol:
 * names resolve through the runtime registry, and every node is created, mutated, hidden and destroyed through
 * the owning root's `SceneBridge`. No scene library is called directly.
 *
 * This is not a host config. Each epoch builds its own config object, typed against its own pinned reconciler
 * declaration, from these functions plus its epoch-specific keys; no config is shared between epochs or cast to
 * another epoch's type.
 */
import { createContext, type ReactNode } from 'react';
import { CompatibilityError, type RootRecord, type Runtime, type SceneTypes } from '@pixi-react-provisional/core';

export type HostProps = Record<string, unknown>;

/** The reconciler container of one root. */
export interface HostContainer<S extends SceneTypes>
{
    readonly record: RootRecord<S>;
}

export interface RootErrorInfoLike
{
    componentStack?: string | null;
}

/** The three root error channels, as React calls them. */
export interface EpochRootCallbacks
{
    onUncaughtError(error: unknown, info: RootErrorInfoLike): void;
    onCaughtError(error: unknown, info: RootErrorInfoLike): void;
    onRecoverableError(error: unknown, info: RootErrorInfoLike): void;
}

/** A reconciler root, as the shared bindings see it. Each epoch implements it over its own reconciler. */
export interface EpochRoot
{
    /** Schedules `element` at the current update priority; `callback` runs once the update has committed. */
    update(element: ReactNode, callback: () => void): void;
    /** Renders `null` synchronously and flushes, so every node is removed before the call returns. */
    unmountSync(): void;
}

/** What an epoch hands the shared bindings. */
export interface EpochRenderer<S extends SceneTypes>
{
    createRoot(container: HostContainer<S>, callbacks: EpochRootCallbacks, identifierPrefix: string): EpochRoot;
}

/** Event priorities of the epoch's reconciler, from its own `constants` module. */
export interface EventPriorities
{
    readonly NoEventPriority: number;
    readonly DiscreteEventPriority: number;
    readonly ContinuousEventPriority: number;
    readonly DefaultEventPriority: number;
}

const DISCRETE_EVENTS = new Set(['click', 'contextmenu', 'dblclick', 'pointercancel', 'pointerdown', 'pointerup']);
const CONTINUOUS_EVENTS = new Set(['pointermove', 'pointerout', 'pointerover', 'pointerenter', 'pointerleave', 'wheel']);

/** The DOM event being dispatched, if any (scene events are dispatched from DOM events). */
export function currentEvent(): { type?: string; timeStamp?: number } | undefined
{
    const scope = (typeof self !== 'undefined' && self) || (typeof window !== 'undefined' && window) || undefined;

    return (scope as { event?: { type?: string; timeStamp?: number } } | undefined)?.event;
}

/** The update-priority hooks (19.0+ shape), with the baseline mapping of DOM event types to priorities. */
export function createPriorityHost(priorities: EventPriorities)
{
    let current = priorities.NoEventPriority;

    return {
        getCurrentUpdatePriority: (): number => current,
        setCurrentUpdatePriority(priority: number): void
        {
            current = priority;
        },
        resolveUpdatePriority(): number
        {
            if (current !== priorities.NoEventPriority)
            {
                return current;
            }

            const type = currentEvent()?.type;

            if (type && DISCRETE_EVENTS.has(type))
            {
                return priorities.DiscreteEventPriority;
            }

            if (type && CONTINUOUS_EVENTS.has(type))
            {
                return priorities.ContinuousEventPriority;
            }

            return priorities.DefaultEventPriority;
        },
    };
}

/** `HostTransitionContext` of this subpath's reconciler (read by form-status hooks). */
export const HostTransitionContext = createContext<null>(null);

/** The static renderer keys every epoch's config starts from. */
export const STATIC_HOST_KEYS = Object.freeze({
    isPrimaryRenderer: false,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    // Upstream parity: no act() warnings from the scene renderer.
    warnsIfNotActing: false,
    noTimeout: -1,
    NotPendingTransition: null,
    HostTransitionContext,
} as const);

export const scheduleTimeout = (handler: () => void, timeout?: number): unknown => setTimeout(handler, timeout);
export const cancelTimeout = (handle: never): void => clearTimeout(handle);

/** Thrown for a raw string child: the scene has no text nodes. */
export function rawTextError(text: string): Error
{
    return new Error(
        `Raw text "${text}" cannot be rendered in the scene. Use a text component (for example <pixiText text="…" />).`,
    );
}

/**
 * A React feature this epoch's reconciler can reach but the renderer does not support (fragment refs,
 * ViewTransition). Raised with the built-in `CAPABILITY_MISSING` code and the missing capability's ID.
 */
export function unsupportedFeature(adapterId: string, capability: string, feature: string): CompatibilityError
{
    return new CompatibilityError(
        `${feature} is not supported by the ${adapterId} renderer: the scene provides no "${capability}" capability.`,
        { code: 'CAPABILITY_MISSING', adapterIds: [adapterId], capability, expected: { [capability]: 1 }, actual: { [capability]: null } },
    );
}

/** The single host context: the scene has no context-dependent node creation. */
const ROOT_HOST_CONTEXT = Object.freeze({});

/**
 * The mutation-mode operations shared by every epoch, bound to one runtime. Each forwards to the owning root's
 * scene bridge, which checks ownership and attach rules before mutating and destroys removed subtrees after the
 * commit, each node exactly once.
 */
export function createMutationHost<S extends SceneTypes>(runtime: Runtime<S>)
{
    type Node = S['node'];
    type Container = HostContainer<S>;

    const recordOf = (node: Node): RootRecord<S> =>
    {
        const info = runtime.nodeInfo(node);

        if (!info)
        {
            throw new Error('The node is not owned by this renderer runtime.');
        }

        return info.root;
    };

    return {
        createInstance: (type: string, props: HostProps, container: Container): Node =>
            container.record.scene.create(type, props),
        createTextInstance(text: string): never
        {
            throw rawTextError(text);
        },
        appendInitialChild: (parent: Node, child: Node): void => recordOf(parent).scene.append(parent, child),
        finalizeInitialChildren: (): boolean => false,
        shouldSetTextContent: (): boolean => false,
        getRootHostContext: (): object => ROOT_HOST_CONTEXT,
        getChildHostContext: (context: object): object => context,
        getPublicInstance: (node: Node): object => recordOf(node).scene.publicInstance(node),
        prepareForCommit: (): null => null,
        // Removed subtrees are destroyed after the commit, through core, each node exactly once.
        resetAfterCommit: (container: Container): void => container.record.scene.flush(),
        preparePortalMount: (): void => undefined,
        appendChild: (parent: Node, child: Node): void => recordOf(parent).scene.append(parent, child),
        appendChildToContainer: ({ record }: Container, child: Node): void =>
            record.scene.append(record.session.container, child),
        insertBefore: (parent: Node, child: Node, before: Node): void =>
            recordOf(parent).scene.insertBefore(parent, child, before),
        insertInContainerBefore: ({ record }: Container, child: Node, before: Node): void =>
            record.scene.insertBefore(record.session.container, child, before),
        removeChild: (parent: Node, child: Node): void => recordOf(child).scene.remove(parent, child),
        removeChildFromContainer: ({ record }: Container, child: Node): void =>
            record.scene.remove(record.session.container, child),
        commitUpdate: (node: Node, _type: string, previous: HostProps, next: HostProps): void =>
            recordOf(node).scene.update(node, previous, next),
        // Suspense fallbacks and (19.2+) Activity both hide through the session's visibility layer.
        hideInstance: (node: Node): void => recordOf(node).scene.setHidden(node, true),
        unhideInstance: (node: Node): void => recordOf(node).scene.setHidden(node, false),
        // The container's children belong to the scene session; React never clears it.
        clearContainer: (): void => undefined,
        detachDeletedInstance: (): void => undefined,
        shouldAttemptEagerTransition: (): boolean => false,
    };
}

