/**
 * Host-config keys the React 18 react-reconciler bundles (0.27.0, 0.28.0, 0.29.0, 0.29.2) read that this
 * mutation-only, non-hydrating renderer cannot reach, grouped by the reason they are unreachable. The groups hold the
 * keys every one of those bundles reads; each per-minor package adds the keys only its own bundle reads and composes
 * its `UNREACHABLE_HOST_KEYS` (its `hostConfig.ts`). A unit test in each package checks that the implemented keys and
 * that list together are exactly the keys its installed development bundle reads (the production bundle reads a
 * subset), so reconciler host-key drift fails a test instead of passing silently.
 *
 * The lists are the React 18 packages' own: they are not shared with, or derived from, the React 19 epochs.
 */
export type UnreachableKeys = Readonly<Record<string, string>>;

function group(reason: string, keys: readonly string[]): UnreachableKeys
{
    return Object.fromEntries(keys.map((key) => [key, reason]));
}

export const HYDRATION = /* @__PURE__ */ group('supportsHydration is false', [
    'canHydrateInstance',
    'canHydrateSuspenseInstance',
    'canHydrateTextInstance',
    'clearSuspenseBoundary',
    'clearSuspenseBoundaryFromContainer',
    'commitHydratedContainer',
    'commitHydratedSuspenseInstance',
    'didNotFindHydratableInstance',
    'didNotFindHydratableInstanceWithinContainer',
    'didNotFindHydratableInstanceWithinSuspenseInstance',
    'didNotFindHydratableSuspenseInstance',
    'didNotFindHydratableSuspenseInstanceWithinContainer',
    'didNotFindHydratableSuspenseInstanceWithinSuspenseInstance',
    'didNotFindHydratableTextInstance',
    'didNotFindHydratableTextInstanceWithinContainer',
    'didNotFindHydratableTextInstanceWithinSuspenseInstance',
    'didNotHydrateInstance',
    'didNotHydrateInstanceWithinContainer',
    'didNotHydrateInstanceWithinSuspenseInstance',
    'didNotMatchHydratedContainerTextInstance',
    'didNotMatchHydratedTextInstance',
    'errorHydratingContainer',
    'getFirstHydratableChild',
    'getFirstHydratableChildWithinContainer',
    'getFirstHydratableChildWithinSuspenseInstance',
    'getNextHydratableInstanceAfterSuspenseInstance',
    'getNextHydratableSibling',
    'hydrateInstance',
    'hydrateSuspenseInstance',
    'hydrateTextInstance',
    'isSuspenseInstanceFallback',
    'isSuspenseInstancePending',
    'registerSuspenseInstanceRetry',
    'shouldDeleteUnhydratedTailInstances',
]);

export const PERSISTENCE = /* @__PURE__ */ group('supportsPersistence is false', [
    'appendChildToContainerChildSet',
    'cloneHiddenInstance',
    'cloneHiddenTextInstance',
    'cloneInstance',
    'createContainerChildSet',
    'finalizeContainerChildren',
    'replaceContainerChildren',
]);

export const TEST_SELECTORS = /* @__PURE__ */ group('supportsTestSelectors is not set', [
    'findFiberRoot',
    'getBoundingRect',
    'getInstanceFromNode',
    'getTextContent',
    'isHiddenSubtree',
    'matchAccessibilityRole',
    'setFocusIfFocusable',
    'setupIntersectionObserver',
    'supportsTestSelectors',
]);

export const MICROTASKS = /* @__PURE__ */ group('supportsMicrotasks is not set; the scheduler drives sync work, as in the baseline', [
    'scheduleMicrotask',
    'supportsMicrotasks',
]);

export const TEXT = /* @__PURE__ */ group('createTextInstance always throws, so no text instance exists', [
    'commitTextUpdate',
    'hideTextInstance',
    'resetTextContent',
    'unhideTextInstance',
]);

export const GATED_STABLE = /* @__PURE__ */ group('feature-gated off in the stable bundle', [
    // Scope API (`prepareScopeUpdate` is read from 0.28 on; see PREPARE_SCOPE_UPDATE).
    'getInstanceFromScope',
    // createEventHandle API.
    'afterActiveInstanceBlur',
    'beforeActiveInstanceBlur',
]);

export const MISC = /* @__PURE__ */ group('not reachable from a scene renderer', [
    // finalizeInitialChildren always returns false.
    'commitMount',
]);

/** Read from react-reconciler 0.28 on (the 0.27 bundle reads `preparePortalMount` under that name instead). */
export const PREPARE_SCOPE_UPDATE = /* @__PURE__ */ group('feature-gated off in the stable bundle (Scope API)', ['prepareScopeUpdate']);

/** Read from react-reconciler 0.29.0 on: hydration error details. */
export const HYDRATION_SINCE_0_29 = /* @__PURE__ */ group('supportsHydration is false', ['getSuspenseInstanceFallbackErrorDetails']);

/** Read by react-reconciler 0.27 and 0.28 only. */
export const BEFORE_0_29 = /* @__PURE__ */ Object.freeze({
    ...group('supportsPersistence is false (the persistent-mode Offscreen wrapper)', ['getOffscreenContainerProps', 'getOffscreenContainerType']),
    now: 'read into a variable but never called by the 0.27 and 0.28 bundles (they time work with the scheduler\'s now)',
});

/** The groups every React 18 bundle reads. Each package adds its own bundle's keys. */
export const COMMON_UNREACHABLE: UnreachableKeys = /* @__PURE__ */ (() => Object.freeze({
    ...HYDRATION,
    ...PERSISTENCE,
    ...TEST_SELECTORS,
    ...MICROTASKS,
    ...TEXT,
    ...GATED_STABLE,
    ...MISC,
}))();
