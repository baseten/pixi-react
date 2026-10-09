/**
 * React 18: host config and root factory for the exact react-reconciler 0.29.2 this package bundles.
 *
 * Every scene operation forwards to the owning root's core `PixiBridge`: names resolve through the runtime registry,
 * and every node is created, mutated, hidden and destroyed by the Pixi session. No scene library is called directly.
 *
 * 0.29 specifics (each differs from the React 19 epochs): `getCurrentEventPriority()` is the only priority hook;
 * updates are payload-based (`prepareUpdate` diffs, `commitUpdate` receives the payload first); `unhideInstance`
 * receives the props; there are no commit-suspension or transition-status keys; `createContainer` takes eight
 * arguments with `onRecoverableError` as the only error callback; a synchronous unmount uses `flushSync`.
 */
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from 'react-reconciler-0.29';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
} from 'react-reconciler-0.29/constants';
import { UNREACHABLE_HOST_KEYS } from './audit.js';
import { type HostContainer, rawTextError, type RootCallbacks, type SceneRenderer } from './host.js';

import type { PixiTypes, RootRecord, Runtime } from '@pixi-react-provisional/core';

export { UNREACHABLE_HOST_KEYS };

export const RECONCILER_VERSION = '0.29.2';

export type HostProps = Record<string, unknown>;

/** Marks an update React must commit; the props themselves are the payload's data. */
export const UPDATE_PAYLOAD = true;

const DISCRETE_EVENTS = new Set(['click', 'contextmenu', 'dblclick', 'pointercancel', 'pointerdown', 'pointerup']);
const CONTINUOUS_EVENTS = new Set(['pointermove', 'pointerout', 'pointerover', 'pointerenter', 'pointerleave', 'wheel']);

/** The DOM event being dispatched, if any (scene events are dispatched from DOM events). */
function currentEvent(): { type?: string } | undefined
{
    const scope = (typeof self !== 'undefined' && self) || (typeof window !== 'undefined' && window) || undefined;

    return (scope as { event?: { type?: string } } | undefined)?.event;
}

/** React 18's single priority hook, with the baseline mapping of DOM event types to priorities. */
export function getCurrentEventPriority(): number
{
    const type = currentEvent()?.type;

    if (type && DISCRETE_EVENTS.has(type))
    {
        return DiscreteEventPriority;
    }

    if (type && CONTINUOUS_EVENTS.has(type))
    {
        return ContinuousEventPriority;
    }

    return DefaultEventPriority;
}

/**
 * React 18's update diff. `children` is React's, not the scene's; every other key is compared by identity, so a
 * changed callback (`draw`, an event handler) is an update, as it is for the React 19 epochs. Returns `null` when
 * nothing the scene sees changed, so React skips `commitUpdate`.
 */
export function prepareUpdate(previous: HostProps, next: HostProps): typeof UPDATE_PAYLOAD | null
{
    for (const key in previous)
    {
        if (key !== 'children' && (!(key in next) || !Object.is(previous[key], next[key])))
        {
            return UPDATE_PAYLOAD;
        }
    }

    for (const key in next)
    {
        if (key !== 'children' && !(key in previous))
        {
            return UPDATE_PAYLOAD;
        }
    }

    return null;
}

/** The single host context: the scene has no context-dependent node creation. */
const ROOT_HOST_CONTEXT = Object.freeze({});

type AnyContainer = HostContainer<PixiTypes>;
type Node = PixiTypes['node'];
type Config = HostConfig<string, HostProps, AnyContainer, Node, object, object, typeof UPDATE_PAYLOAD>;

/**
 * The runtime that created each node. Host operations on a node (append, insert, remove, update, hide) carry no
 * container, so the shared reconciler finds the node's runtime here and asks that runtime's core for the owning
 * root. Core's own node table stays the source of truth: a node no runtime owns is rejected.
 */
const nodeRuntimes = new WeakMap<object, Runtime<PixiTypes>>();

function recordOf(node: Node): RootRecord<PixiTypes>
{
    const info = nodeRuntimes.get(node as object)?.nodeInfo(node);

    if (!info)
    {
        throw new Error('The node is not owned by this renderer runtime.');
    }

    return info.root;
}

/**
 * The 0.29.2 host config. It is runtime-independent: containers carry their runtime and record, and nodes are traced
 * to their runtime through `nodeRuntimes`. One config, and therefore one reconciler, serves every runtime this
 * package copy binds (see `sharedReconciler`).
 */
export function createHostConfig(): Config
{
    return {
        isPrimaryRenderer: false,
        supportsMutation: true,
        supportsPersistence: false,
        supportsHydration: false,
        // Upstream parity: no act() warnings from the scene renderer.
        warnsIfNotActing: false,
        noTimeout: -1,
        scheduleTimeout: (handler, timeout) => setTimeout(handler, timeout),
        cancelTimeout: (handle) => clearTimeout(handle),

        createInstance(type, props, container)
        {
            const node = container.record.pixi.create(type, props);

            nodeRuntimes.set(node as object, container.runtime);

            return node;
        },
        createTextInstance(text): never
        {
            throw rawTextError(text);
        },
        appendInitialChild: (parent, child) => recordOf(parent).pixi.append(parent, child),
        finalizeInitialChildren: () => false,
        prepareUpdate: (_node, _type, previous, next) => prepareUpdate(previous, next),
        shouldSetTextContent: () => false,
        getRootHostContext: () => ROOT_HOST_CONTEXT,
        getChildHostContext: (context) => context,
        getPublicInstance: (node) => recordOf(node).pixi.publicInstance(node),
        prepareForCommit: () => null,
        // Removed subtrees are destroyed after the commit, through core, each node exactly once.
        resetAfterCommit: (container) => container.record.pixi.flush(),
        preparePortalMount: () => undefined,
        appendChild: (parent, child) => recordOf(parent).pixi.append(parent, child),
        appendChildToContainer: ({ record }, child) => record.pixi.append(record.session.container, child),
        insertBefore: (parent, child, before) => recordOf(parent).pixi.insertBefore(parent, child, before),
        insertInContainerBefore: ({ record }, child, before) =>
            record.pixi.insertBefore(record.session.container, child, before),
        removeChild: (parent, child) => recordOf(child).pixi.remove(parent, child),
        removeChildFromContainer: ({ record }, child) => record.pixi.remove(record.session.container, child),
        // 0.29 passes the payload first; the scene diffs previous and next props itself.
        commitUpdate: (node, _payload, _type, previous, next) => recordOf(node).pixi.update(node, previous, next),
        // Suspense fallbacks hide through the session's visibility layer (React 18 has no Activity).
        hideInstance: (node) => recordOf(node).pixi.setHidden(node, true),
        unhideInstance: (node) => recordOf(node).pixi.setHidden(node, false),
        // The container's children belong to the Pixi session; React never clears it.
        clearContainer: () => undefined,
        detachDeletedInstance: () => undefined,

        getCurrentEventPriority,
    };
}

/** Creates a 0.29 root: eight arguments, a ConcurrentRoot whose only error callback is `onRecoverableError`. */
export function createContainer<S extends PixiTypes>(
    reconciler: Pick<Reconciler<HostContainer<S>>, 'createContainer'>,
    container: HostContainer<S>,
    callbacks: RootCallbacks,
    identifierPrefix: string,
): OpaqueRoot
{
    return reconciler.createContainer(
        container,
        ConcurrentRoot,
        null,
        false,
        null,
        identifierPrefix,
        callbacks.onRecoverableError,
        null,
    );
}

let shared: Reconciler<AnyContainer> | undefined;

/**
 * One reconciler for every runtime of this package copy, as React DOM has one for all its roots. React 18 marks each
 * context provider with the secondary renderer that last rendered it and, in development, warns ("Detected multiple
 * renderers concurrently rendering the same context provider") when another reconciler instance renders it. A
 * reconciler per runtime would trip that warning for this package's own root context and every bridged context as
 * soon as a second runtime renders; one shared reconciler never does. Roots stay per runtime.
 */
export function sharedReconciler(): Reconciler<AnyContainer>
{
    shared ??= createReconciler(createHostConfig());

    return shared;
}

export function createRenderer<S extends PixiTypes>(_runtime: Runtime<S>): SceneRenderer<S>
{
    const reconciler = sharedReconciler() as unknown as Reconciler<HostContainer<S>>;

    return {
        createRoot(container, callbacks, identifierPrefix)
        {
            const root = createContainer(reconciler, container, callbacks, identifierPrefix);

            return {
                update: (element, callback) =>
                {
                    reconciler.updateContainer(element, root, null, callback);
                },
                unmountSync()
                {
                    // A sync-lane update: React 18 commits it and flushes its passive effects before flushSync returns.
                    reconciler.flushSync(() =>
                    {
                        reconciler.updateContainer(null, root, null, null);
                    });
                },
            };
        },
    };
}
