/**
 * React 19.3 epoch: host config and root factory for the exact react-reconciler 0.34.0 this subpath bundles.
 *
 * 0.34 keeps the 0.33 root shape (argument 10 is `onDefaultTransitionIndicator`), commit suspension, scheduler
 * instrumentation and Activity behaviour. What changes is that its stable bundle reaches fragment refs and
 * ViewTransition, and adds the measure/viewport hooks (`measureInstance`, `wasInstanceInViewport`,
 * `applyViewTransitionName`, `restoreViewTransitionName`, `addViewTransitionFinishedListener`). The scene
 * provides neither feature, so (see `../shared/features.ts`):
 * - a ref on a `<Fragment>` throws `CAPABILITY_MISSING` (`react.fragment-ref`) when React creates the fragment
 *   instance; React routes the error to the nearest error boundary or `onUncaughtError`;
 * - a ref or event callback on `<ViewTransition>` throws `CAPABILITY_MISSING` (`react.view-transition`);
 * - a transition that would animate a `<ViewTransition>` reports `CAPABILITY_MISSING` (`react.view-transition`)
 *   through `onRecoverableError` and commits without animation. Throwing there would abandon the commit.
 */
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from 'react-reconciler-0.34';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
    NoEventPriority,
} from 'react-reconciler-0.34/constants';
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
import { GESTURES, PERSISTENT_VIEW_TRANSITION } from '../shared/epochKeys.js';
import { fragmentRefError, viewTransitionError } from '../shared/features.js';
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

export const RECONCILER_VERSION = '0.34.0';

/** Keys the 0.34 bundle reads that this renderer cannot reach, with the reason. */
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
    isSingletonScope: 'supportsSingletons is not set',
    requestPostPaintCallback: 'transition tracing, gated off in the stable bundle',
});

const ADAPTER_ID = 'react-19/19.3';
const NO_MEASUREMENT = Object.freeze({});

/** Fragment-instance and view-transition hooks: rejected, never silently accepted. */
function createUnsupportedFeatureHost()
{
    const rejectFragment = (): never =>
    {
        throw fragmentRefError(ADAPTER_ID);
    };

    return {
        createFragmentInstance: rejectFragment,
        updateFragmentInstanceFiber: rejectFragment,
        commitNewChildToFragmentInstance: rejectFragment,
        deleteChildFromFragmentInstance: rejectFragment,
        createViewTransitionInstance(): never
        {
            throw viewTransitionError(ADAPTER_ID);
        },
        startViewTransition(
            _state: unknown,
            _container: unknown,
            _types: unknown,
            mutationCallback: () => void,
            layoutCallback: () => void,
            _afterMutationCallback: () => void,
            spawnedWorkCallback: () => void,
            _passiveCallback: () => unknown,
            errorCallback: (error: unknown) => void,
        ): null
        {
            // Report through the root's recoverable-error channel, then commit synchronously without animating,
            // as a renderer without view transitions does. Passive effects are scheduled by the spawned work.
            errorCallback(viewTransitionError(ADAPTER_ID));
            mutationCallback();
            layoutCallback();
            spawnedWorkCallback();

            return null;
        },
        // No transition is ever started, so there is nothing to stop, name, wait for or measure.
        stopViewTransition: (): void => undefined,
        addViewTransitionFinishedListener: (_transition: unknown, callback: () => void): void => callback(),
        suspendOnActiveViewTransition: (): void => undefined,
        applyViewTransitionName: (): void => undefined,
        restoreViewTransitionName: (): void => undefined,
        cancelViewTransitionName: (): void => undefined,
        cancelRootViewTransitionName: (): void => undefined,
        restoreRootViewTransitionName: (): void => undefined,
        measureInstance: (): object => NO_MEASUREMENT,
        wasInstanceInViewport: (): boolean => true,
        hasInstanceChanged: (): boolean => false,
        hasInstanceAffectedParent: (): boolean => false,
    };
}

/** No suspended state of our own: scene nodes never suspend a commit. */
const NO_SUSPENDED_STATE = null;

type Config<S extends SceneTypes> = HostConfig<string, HostProps, HostContainer<S>, S['node'], object, object, null>;

export function createHostConfig<S extends SceneTypes>(runtime: Runtime<S>): Config<S>
{
    return {
        ...STATIC_HOST_KEYS,
        rendererPackageName: '@pixi-react-provisional/react-19/19.3',
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
        ...createUnsupportedFeatureHost(),
    };
}

/**
 * The 0.34 default-transition-indicator handler. React DOM shows the browser's loading indicator here; a scene
 * has none, so it does nothing and returns no cleanup.
 */
export function onDefaultTransitionIndicator(): void
{
    // Intentionally empty: no scene-level transition indicator.
}

/** Creates a 0.34 root: ten arguments, the tenth being `onDefaultTransitionIndicator`. */
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
