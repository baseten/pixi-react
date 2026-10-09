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

export const HYDRATION = group('supportsHydration is false', [
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

export const PERSISTENCE = group('supportsPersistence is false', [
    'appendChildToContainerChildSet',
    'cloneHiddenInstance',
    'cloneHiddenTextInstance',
    'cloneInstance',
    'createContainerChildSet',
    'finalizeContainerChildren',
    'replaceContainerChildren',
]);

export const TEST_SELECTORS = group('supportsTestSelectors is not set', [
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

export const MICROTASKS = group('supportsMicrotasks is not set; the scheduler drives sync work, as in the baseline', [
    'scheduleMicrotask',
    'supportsMicrotasks',
]);

export const TEXT = group('createTextInstance always throws, so no text instance exists', [
    'commitTextUpdate',
    'hideTextInstance',
    'resetTextContent',
    'unhideTextInstance',
]);

export const GATED_STABLE = group('feature-gated off in the stable bundle', [
    // Scope API.
    'getInstanceFromScope',
    'prepareScopeUpdate',
    // createEventHandle API.
    'afterActiveInstanceBlur',
    'beforeActiveInstanceBlur',
]);

export const MISC = group('not reachable from a scene renderer', [
    // finalizeInitialChildren always returns false.
    'commitMount',
]);

/** Every key of the 0.29.2 bundle this renderer cannot reach, with the reason. */
export const UNREACHABLE_HOST_KEYS: UnreachableKeys = Object.freeze({
    ...HYDRATION,
    ...PERSISTENCE,
    ...TEST_SELECTORS,
    ...MICROTASKS,
    ...TEXT,
    ...GATED_STABLE,
    ...MISC,
});
