/**
 * React 19.2 epoch: host config and root factory for the exact react-reconciler 0.33.0 this package depends on.
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
import { PACKAGE } from './package.js';
import {
    type AnyHostContainer,
    type AnyNode,
    cancelTimeout,
    createMutationHost,
    createPriorityHost,
    currentEvent,
    type EpochRenderer,
    type EpochRootCallbacks,
    GATED_STABLE,
    GATED_VIEW_TRANSITION,
    gatedFeatureStubs,
    GESTURES,
    type HostContainer,
    type HostProps,
    HYDRATION,
    HYDRATION_0_32,
    HYDRATION_0_33,
    MICROTASKS,
    MISC,
    PERSISTENCE,
    PERSISTENT_VIEW_TRANSITION,
    RESOURCES,
    scheduleTimeout,
    SINGLETONS,
    STATIC_HOST_KEYS,
    TEST_SELECTORS,
    TEXT,
    type UnreachableKeys,
} from '@pixi-react-provisional/react-shared/react-19';
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from '#reconciler';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
    NoEventPriority,
} from '#reconciler/constants';

import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const RECONCILER_VERSION = '0.33.0';

/**
 * Keys the 0.33 bundle reads that this renderer cannot reach, with the reason.
 * Test-only data (the host-key unit test reads it): a pure expression, so bundles that do not read it drop it.
 */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = /* @__PURE__ */ (() => Object.freeze({
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
}))();

/** No suspended state of our own: scene nodes never suspend a commit. */
const NO_SUSPENDED_STATE = null;

type Config = HostConfig<string, HostProps, AnyHostContainer, AnyNode, object, object, null>;

/**
 * The 0.33 host config. It is runtime-independent: containers carry their runtime and root record, and nodes are
 * traced to their runtime, so one config (and one reconciler, `sharedReconciler`) serves every runtime this package
 * copy binds.
 */
export function createHostConfig(): Config
{
    return {
        ...STATIC_HOST_KEYS,
        rendererPackageName: PACKAGE.name,
        rendererVersion: PACKAGE.version,
        scheduleTimeout,
        cancelTimeout,
        ...createMutationHost(),
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
        ...gatedFeatureStubs('react-19.2'),
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
export function createContainer<S extends PixiTypes>(
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

let shared: Reconciler<AnyHostContainer> | undefined;

/**
 * One reconciler for every runtime of this package copy, as React DOM has one for all its roots (issue 49). Pixi
 * roots are a secondary renderer, and a secondary renderer keeps each context's current value in one field of the
 * context object. With a reconciler per runtime, a time-sliced render of one runtime that yields (a transition or a
 * retry) leaves its pushed context values in place, and a second runtime that renders before the first resumes reads
 * them: it commits the other runtime's value, in production too, and development React warns "Detected multiple
 * renderers concurrently rendering the same context provider". One shared reconciler interrupts the yielded render
 * first, as it does for two React DOM roots. Roots stay per runtime. Two installed copies of this package still have
 * two reconcilers (see the README).
 */
export function sharedReconciler(): Reconciler<AnyHostContainer>
{
    shared ??= createReconciler(createHostConfig());

    return shared;
}

export function createRenderer<S extends PixiTypes>(_runtime: Runtime<S>): EpochRenderer<S>
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
                    reconciler.updateContainerSync(null, root, null, null);
                    reconciler.flushSyncWork();
                },
            };
        },
    };
}
