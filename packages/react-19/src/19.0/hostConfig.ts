/**
 * React 19.0 epoch: host config and root factory for the exact react-reconciler 0.31.0 this subpath bundles.
 *
 * 0.31 specifics: update/resolve priority hooks; commit suspension without a suspended-state object
 * (`startSuspendingCommit()`, `suspendInstance(type, props)`, `waitForCommitToBeReady()`); a ten-argument
 * `createContainer` whose tenth argument is `transitionCallbacks`.
 */
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from 'react-reconciler-0.31';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
    NoEventPriority,
} from 'react-reconciler-0.31/constants';
import {
    GATED_STABLE,
    HYDRATION,
    MICROTASKS,
    MISC,
    PERSISTENCE,
    RESOURCES,
    SINGLETONS,
    TEST_SELECTORS,
    TEXT,
    type UnreachableKeys,
} from '../shared/audit.js';
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

type Config<S extends SceneTypes> = HostConfig<string, HostProps, HostContainer<S>, S['node'], object, object, null>;

export function createHostConfig<S extends SceneTypes>(runtime: Runtime<S>): Config<S>
{
    return {
        ...STATIC_HOST_KEYS,
        rendererPackageName: '@pixi-react-provisional/react-19/19.0',
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
    };
}

/** Creates a 0.31 root: ten arguments, the tenth being `transitionCallbacks` (none). */
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
