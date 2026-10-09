/**
 * React 19.0 epoch: host config and root factory for the exact react-reconciler 0.31.0 this package depends on.
 *
 * 0.31 specifics: update/resolve priority hooks; commit suspension without a suspended-state object
 * (`startSuspendingCommit()`, `suspendInstance(type, props)`, `waitForCommitToBeReady()`); a ten-argument
 * `createContainer` whose tenth argument is `transitionCallbacks`.
 */
import { PACKAGE } from './package.js';
import {
    type AnyHostContainer,
    type AnyNode,
    cancelTimeout,
    createMutationHost,
    createPriorityHost,
    type EpochRenderer,
    type EpochRootCallbacks,
    GATED_STABLE,
    type HostContainer,
    type HostProps,
    HYDRATION,
    MICROTASKS,
    MISC,
    PERSISTENCE,
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

export const RECONCILER_VERSION = '0.31.0';

/** Keys the 0.31 bundle reads that this renderer cannot reach, with the reason. */
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
    clearSingleton: 'supportsSingletons is not set',
    afterActiveInstanceBlur: 'createEventHandle API, gated off in the stable bundle',
    requestPostPaintCallback: 'transition tracing, gated off in the stable bundle',
    resolveEventType: 'read but never called by the 0.31 bundle',
    resolveEventTimeStamp: 'read but never called by the 0.31 bundle',
});

type Config = HostConfig<string, HostProps, AnyHostContainer, AnyNode, object, object, null>;

/**
 * The 0.31 host config. It is runtime-independent: containers carry their runtime and root record, and nodes are
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
        // Scene nodes never suspend a commit.
        maySuspendCommit: () => false,
        preloadInstance: () => true,
        startSuspendingCommit: () => undefined,
        suspendInstance: () => undefined,
        waitForCommitToBeReady: () => null,
    };
}

/** Creates a 0.31 root: ten arguments, the tenth being `transitionCallbacks` (none). */
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
        null,
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
