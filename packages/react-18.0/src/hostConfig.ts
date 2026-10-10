/**
 * React 18.0: host config and root factory for the exact react-reconciler 0.27.0 this package depends on. The host
 * config is react-shared's React 18 config (`createReact18HostConfig`), typed here against this package's own
 * declarations of 0.27.0 (`src/reconciler/react-reconciler.d.ts`). 0.27.0 has the same host-config and root API as
 * 0.29.2 (react-18.3); its bundle reads a slightly different set of keys, all unreachable here: it still reads `now`
 * (never calling it) and the persistent-mode Offscreen keys, and does not yet read `prepareScopeUpdate` (its Scope
 * hook reads `preparePortalMount` instead) or `getSuspenseInstanceFallbackErrorDetails`.
 */
import { currentEventPriority } from '@pixi-react-provisional/react-shared/common';
import {
    type AnyHostContainer,
    type AnyNode,
    BEFORE_0_29,
    COMMON_UNREACHABLE,
    createReact18HostConfig,
    createSceneRenderer,
    type HostContainer,
    type HostProps,
    type RootCallbacks,
    type SceneRenderer,
    type UnreachableKeys,
    type UPDATE_PAYLOAD,
} from '@pixi-react-provisional/react-shared/react-18';
import createReconciler, { type HostConfig, type OpaqueRoot, type Reconciler } from '#reconciler';
import {
    ConcurrentRoot,
    ContinuousEventPriority,
    DefaultEventPriority,
    DiscreteEventPriority,
} from '#reconciler/constants';

import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export { prepareUpdate, UPDATE_PAYLOAD } from '@pixi-react-provisional/react-shared/react-18';

export const RECONCILER_VERSION = '0.27.0';

/**
 * Every key of the 0.27.0 bundle this renderer cannot reach, with the reason.
 * Test-only data (the host-key unit test reads it): a pure expression, so bundles that do not read it drop it.
 */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = /* @__PURE__ */ (() => Object.freeze({
    ...COMMON_UNREACHABLE,
    ...BEFORE_0_29,
}))();

type Config = HostConfig<string, HostProps, AnyHostContainer, AnyNode, object, object, typeof UPDATE_PAYLOAD>;

const LEVELS = { DiscreteEventPriority, ContinuousEventPriority, DefaultEventPriority };

/** The 0.27.0 host config (runtime-independent: one config, and one reconciler, for every runtime). */
export function createHostConfig(): Config
{
    return createReact18HostConfig(LEVELS);
}

/** React 18's single priority hook, with this reconciler's priority constants. */
export const getCurrentEventPriority = (): number => currentEventPriority(LEVELS);

/** Creates a 0.27.0 root: eight arguments, a ConcurrentRoot whose only error callback is `onRecoverableError`. */
export function createContainer<S extends PixiTypes>(
    reconciler: Pick<Reconciler<HostContainer<S>>, 'createContainer'>,
    container: HostContainer<S>,
    callbacks: RootCallbacks,
    identifierPrefix: string,
): OpaqueRoot
{
    return reconciler.createContainer(container, ConcurrentRoot, null, false, null, identifierPrefix, callbacks.onRecoverableError, null);
}

let shared: Reconciler<AnyHostContainer> | undefined;

/**
 * One reconciler for every runtime of this package copy, as React DOM has one for all its roots. React 18 marks each
 * context provider with the secondary renderer that last rendered it and, in development, warns ("Detected multiple
 * renderers concurrently rendering the same context provider") when another reconciler instance renders it. A
 * reconciler per runtime would trip that warning for the root context and every bridged context as soon as a second
 * runtime renders; one shared reconciler never does. Roots stay per runtime. Two installed copies of this package
 * still have two reconcilers (see react-shared's README).
 */
export function sharedReconciler(): Reconciler<AnyHostContainer>
{
    shared ??= createReconciler(createHostConfig());

    return shared;
}

export function createRenderer<S extends PixiTypes>(_runtime: Runtime<S>): SceneRenderer<S>
{
    const reconciler = sharedReconciler() as unknown as Reconciler<HostContainer<S>>;

    return createSceneRenderer(reconciler, (container: HostContainer<S>, callbacks, identifierPrefix) =>
        createContainer(reconciler, container, callbacks, identifierPrefix));
}
