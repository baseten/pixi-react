/**
 * React 18: host config and root factory for the exact react-reconciler 0.29.2 this package depends on.
 *
 * Every scene operation forwards to the owning root's core `PixiBridge`: names resolve through the runtime registry,
 * and every node is created, mutated, hidden and destroyed by the Pixi session. No scene library is called directly.
 *
 * 0.29 specifics (each differs from the React 19 epochs): `getCurrentEventPriority()` is the only priority hook;
 * updates are payload-based (`prepareUpdate` diffs, `commitUpdate` receives the payload first); `unhideInstance`
 * receives the props; there are no commit-suspension or transition-status keys; `createContainer` takes eight
 * arguments with `onRecoverableError` as the only error callback; a synchronous unmount uses `flushSync`.
 */
import { UNREACHABLE_HOST_KEYS } from './audit.js';
import {
    type AnyHostContainer,
    type AnyNode,
    cancelTimeout,
    createMutationHost,
    currentEventPriority,
    type HostContainer,
    type HostProps,
    recordOf,
    scheduleTimeout,
} from '@pixi-react-provisional/react-shared/common';
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from '#reconciler';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
} from '#reconciler/constants';

import type { RootCallbacks, SceneRenderer } from './host.js';
import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export { UNREACHABLE_HOST_KEYS };

export const RECONCILER_VERSION = '0.29.2';

export type { HostProps };

/** Marks an update React must commit; the props themselves are the payload's data. */
export const UPDATE_PAYLOAD = true;

/** React 18's single priority hook, with the baseline mapping of DOM event types to priorities. */
export function getCurrentEventPriority(): number
{
    return currentEventPriority({ DiscreteEventPriority, ContinuousEventPriority, DefaultEventPriority });
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

type Config = HostConfig<string, HostProps, AnyHostContainer, AnyNode, object, object, typeof UPDATE_PAYLOAD>;

/**
 * The 0.29.2 host config. It is runtime-independent: containers carry their runtime and record, and nodes are traced
 * to their runtime (react-shared's `common/host.ts`). One config, and therefore one reconciler, serves every runtime this
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
        scheduleTimeout,
        cancelTimeout,

        ...createMutationHost(),
        prepareUpdate: (_node, _type, previous, next) => prepareUpdate(previous, next),
        // 0.29 passes the payload first; the scene diffs previous and next props itself.
        commitUpdate: (node, _payload, _type, previous, next) => recordOf(node).pixi.update(node, previous, next),
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

let shared: Reconciler<AnyHostContainer> | undefined;

/**
 * One reconciler for every runtime of this package copy, as React DOM has one for all its roots. React 18 marks each
 * context provider with the secondary renderer that last rendered it and, in development, warns ("Detected multiple
 * renderers concurrently rendering the same context provider") when another reconciler instance renders it. A
 * reconciler per runtime would trip that warning for this package's own root context and every bridged context as
 * soon as a second runtime renders; one shared reconciler never does. Roots stay per runtime. Two installed copies of this package still have two
 * reconcilers (see the README).
 */
export function sharedReconciler(): Reconciler<AnyHostContainer>
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
