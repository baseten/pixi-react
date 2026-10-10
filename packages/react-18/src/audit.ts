/**
 * Host-config keys the react-reconciler 0.29.2 bundle reads that this mutation-only, non-hydrating renderer cannot
 * reach, grouped by the reason they are unreachable. A unit test checks that the implemented keys and these keys
 * together are exactly the keys the installed development bundle reads (the production bundle reads a subset), so
 * reconciler host-key drift fails a test instead of passing silently.
 *
 * The list is this package's own: it is not shared with, or derived from, the React 19 epochs.
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
    'getSuspenseInstanceFallbackErrorDetails',
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
    // Scope API.
    'getInstanceFromScope',
    'prepareScopeUpdate',
    // createEventHandle API.
    'afterActiveInstanceBlur',
    'beforeActiveInstanceBlur',
]);

export const MISC = /* @__PURE__ */ group('not reachable from a scene renderer', [
    // finalizeInitialChildren always returns false.
    'commitMount',
]);

/**
 * Every key of the 0.29.2 bundle this renderer cannot reach, with the reason.
 * Test-only data (the host-key unit test reads it): a pure expression, so bundles that do not read it drop it.
 */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = /* @__PURE__ */ (() => Object.freeze({
    ...HYDRATION,
    ...PERSISTENCE,
    ...TEST_SELECTORS,
    ...MICROTASKS,
    ...TEXT,
    ...GATED_STABLE,
    ...MISC,
}))();
