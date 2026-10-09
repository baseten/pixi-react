/**
 * React 19.2 epoch: host config and root factory for the exact react-reconciler 0.33.0 this subpath bundles.
 *
 * 0.33 specifics, against 0.32:
 * - `createContainer` argument 10 is `onDefaultTransitionIndicator`, not `transitionCallbacks` (the published
 *   bundle keeps arity ten). Passing the 19.0 shape would hand it `null` where it expects a function.
 * - Commit suspension threads a suspended-state object (`startSuspendingCommit()` returns it;
 *   `suspendInstance(state, instance, type, props)`, `waitForCommitToBeReady(state, timeoutOffset)`) and adds
 *   `maySuspendCommitOnUpdate`, `maySuspendCommitInSyncRender` and `getSuspendedCommitReason`.
 * - The bundle calls `trackSchedulerEvent`, `resolveEventType` and `resolveEventTimeStamp`.
 * - Activity hides and restores host instances through `hideInstance`/`unhideInstance`, which reach the session's
 *   `setHidden`; Activity hydration hooks are unreachable (no hydration).
 */
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from 'react-reconciler-0.33';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
    NoEventPriority,
} from 'react-reconciler-0.33/constants';
import {
    GATED_STABLE,
    HYDRATION,
    HYDRATION_0_32,
    HYDRATION_0_33,
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
    currentEvent,
    type EpochRenderer,
    type EpochRootCallbacks,
    type HostContainer,
    type HostProps,
    scheduleTimeout,
    STATIC_HOST_KEYS,
} from '../shared/host.js';
import { PACKAGE_VERSION } from '../shared/version.js';

import type { Runtime, SceneTypes } from '@pixi-react-provisional/core';

export const RECONCILER_VERSION = '0.33.0';

/** Keys the 0.33 bundle reads that this renderer cannot reach, with the reason. */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = Object.freeze({
    ...HYDRATION,
    ...HYDRATION_0_32,
    ...HYDRATION_0_33,
    ...PERSISTENCE,
    ...PERSISTENT_VIEW_TRANSITION,
    ...RESOURCES,
    ...SINGLETONS,
    ...TEST_SELECTORS,
    ...MICROTASKS,
    ...TEXT,
    ...GATED_STABLE,
    ...MISC,
    ...GESTURES,
    ...GATED_VIEW_TRANSITION,
    isSingletonScope: 'supportsSingletons is not set',
    stopViewTransition: 'ViewTransition is gated off in the stable bundle',
    requestPostPaintCallback: 'transition tracing, gated off in the stable bundle',
});

/** No suspended state of our own: scene nodes never suspend a commit. */
const NO_SUSPENDED_STATE = null;

type Config<S extends SceneTypes> = HostConfig<string, HostProps, HostContainer<S>, S['node'], object, object, null>;

export function createHostConfig<S extends SceneTypes>(runtime: Runtime<S>): Config<S>
{
    return {
        ...STATIC_HOST_KEYS,
        rendererPackageName: '@pixi-react-provisional/react-19/19.2',
        rendererVersion: PACKAGE_VERSION,
        scheduleTimeout,
        cancelTimeout,
        ...createMutationHost(runtime),
        ...createPriorityHost({ NoEventPriority, DiscreteEventPriority, ContinuousEventPriority, DefaultEventPriority }),
        maySuspendCommit: () => false,
        maySuspendCommitOnUpdate: () => false,
        maySuspendCommitInSyncRender: () => false,
        preloadInstance: () => true,
        startSuspendingCommit: () => NO_SUSPENDED_STATE,
        suspendInstance: () => undefined,
        waitForCommitToBeReady: () => null,
        getSuspendedCommitReason: () => null,
        trackSchedulerEvent: () => undefined,
        resolveEventType: () => currentEvent()?.type ?? null,
        resolveEventTimeStamp: () => currentEvent()?.timeStamp ?? -1.1,
        ...gatedFeatureStubs('react-19/19.2'),
    };
}

/**
 * The 0.33 default-transition-indicator handler. React DOM shows the browser's loading indicator here; a scene
 * has none, so it does nothing and returns no cleanup.
 */
export function onDefaultTransitionIndicator(): void
{
    // Intentionally empty: no scene-level transition indicator.
}

/** Creates a 0.33 root: ten arguments, the tenth being `onDefaultTransitionIndicator`. */
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
        onDefaultTransitionIndicator,
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
