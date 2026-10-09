/**
 * React 19.1 epoch: host config and root factory for the exact react-reconciler 0.32.0 this subpath bundles.
 *
 * 0.32 specifics, against 0.31: it reads the scheduler instrumentation hook `trackSchedulerEvent` (but its stable
 * bundle never calls it); it reads fragment-instance, view-transition and gesture hooks that its stable bundle never
 * calls (fragment and view-transition creation are stubbed to fail clearly); it no longer reads
 * `afterActiveInstanceBlur` or `clearSingleton`, so neither is supplied. Commit suspension keeps the 0.31 shape and
 * `createContainer` keeps ten arguments, the tenth being `transitionCallbacks`.
 */
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from 'react-reconciler-0.32';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
    NoEventPriority,
} from 'react-reconciler-0.32/constants';
import {
    GATED_STABLE,
    HYDRATION,
    HYDRATION_0_32,
    MICROTASKS,
    MISC,
    PERSISTENCE,
    RESOURCES,
    SINGLETONS,
    TEST_SELECTORS,
    TEXT,
    type UnreachableKeys,
} from '../shared/audit.js';
import { GATED_VIEW_TRANSITION, GESTURES, PERSISTENT_VIEW_TRANSITION } from '../shared/epochKeys.js';
import { gatedFeatureStubs } from '../shared/features.js';
import {
    cancelTimeout,
    createMutationHost,
    createPriorityHost,
    type EpochRenderer,
    type EpochRootCallbacks,
    type HostContainer,
    type HostProps,
    scheduleTimeout,
    STATIC_HOST_KEYS,
} from '../shared/host.js';
import { PACKAGE_VERSION } from '../shared/version.js';

import type { Runtime, SceneTypes } from '@pixi-react-provisional/core';

export const RECONCILER_VERSION = '0.32.0';

/** Keys the 0.32 bundle reads that this renderer cannot reach, with the reason. */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = Object.freeze({
    ...HYDRATION,
    ...PERSISTENCE,
    ...RESOURCES,
    ...SINGLETONS,
    ...TEST_SELECTORS,
    ...MICROTASKS,
    ...TEXT,
    ...GATED_STABLE,
    ...MISC,
    ...HYDRATION_0_32,
    ...PERSISTENT_VIEW_TRANSITION,
    ...GESTURES,
    ...GATED_VIEW_TRANSITION,
    isSingletonScope: 'supportsSingletons is not set',
    stopGestureTransition: 'gesture transitions are gated off in the stable bundle',
    subscribeToGestureDirection: 'gesture transitions are gated off in the stable bundle',
    requestPostPaintCallback: 'transition tracing, gated off in the stable bundle',
    resolveEventType: 'read but never called by the 0.32 bundle',
    resolveEventTimeStamp: 'read but never called by the 0.32 bundle',
});

type Config<S extends SceneTypes> = HostConfig<string, HostProps, HostContainer<S>, S['node'], object, object, null>;

export function createHostConfig<S extends SceneTypes>(runtime: Runtime<S>): Config<S>
{
    return {
        ...STATIC_HOST_KEYS,
        rendererPackageName: '@pixi-react-provisional/react-19/19.1',
        rendererVersion: PACKAGE_VERSION,
        scheduleTimeout,
        cancelTimeout,
        ...createMutationHost(runtime),
        ...createPriorityHost({ NoEventPriority, DiscreteEventPriority, ContinuousEventPriority, DefaultEventPriority }),
        // Scene nodes never suspend a commit.
        maySuspendCommit: () => false,
        preloadInstance: () => true,
        startSuspendingCommit: () => undefined,
        suspendInstance: () => undefined,
        waitForCommitToBeReady: () => null,
        // Scheduler instrumentation: no profiling track of our own.
        trackSchedulerEvent: () => undefined,
        ...gatedFeatureStubs('react-19/19.1'),
    };
}

/** Creates a 0.32 root: ten arguments, the tenth being `transitionCallbacks` (none). */
export function createContainer<S extends SceneTypes>(
    reconciler: Pick<Reconciler<HostContainer<S>>, 'createContainer'>,
    container: HostContainer<S>,
    callbacks: EpochRootCallbacks,
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
        callbacks.onUncaughtError,
        callbacks.onCaughtError,
        callbacks.onRecoverableError,
        null,
    );
}

export function createRenderer<S extends SceneTypes>(runtime: Runtime<S>): EpochRenderer<S>
{
    const reconciler = createReconciler(createHostConfig(runtime));

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
                    reconciler.updateContainerSync(null, root, null, null);
                    reconciler.flushSyncWork();
                },
            };
        },
    };
}
