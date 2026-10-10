/**
 * Host-config keys a reconciler bundle reads that this mutation-only, non-hydrating renderer cannot reach, grouped
 * by the reason they are unreachable. Each epoch composes its own list from these groups plus its own keys; a unit
 * test checks that an epoch's implemented keys and its unreachable keys together are exactly the keys its installed
 * bundle reads, so reconciler host-key drift fails a test instead of passing silently.
 */
export type UnreachableKeys = Readonly<Record<string, string>>;

function group(reason: string, keys: readonly string[]): UnreachableKeys
{
    return Object.fromEntries(keys.map((key) => [key, reason]));
}

export const HYDRATION = /* @__PURE__ */ group('supportsHydration is false', [
    'canHydrateFormStateMarker',
    'canHydrateInstance',
    'canHydrateSuspenseInstance',
    'canHydrateTextInstance',
    'clearSuspenseBoundary',
    'clearSuspenseBoundaryFromContainer',
    'commitHydratedContainer',
    'commitHydratedSuspenseInstance',
    'describeHydratableInstanceForDevWarnings',
    'diffHydratedPropsForDevWarnings',
    'diffHydratedTextForDevWarnings',
    'getFirstHydratableChild',
    'getFirstHydratableChildWithinContainer',
    'getFirstHydratableChildWithinSuspenseInstance',
    'getNextHydratableInstanceAfterSuspenseInstance',
    'getNextHydratableSibling',
    'getSuspenseInstanceFallbackErrorDetails',
    'hydrateInstance',
    'hydrateSuspenseInstance',
    'hydrateTextInstance',
    'isFormStateMarkerMatching',
    'isSuspenseInstanceFallback',
    'isSuspenseInstancePending',
    'registerSuspenseInstanceRetry',
    'shouldDeleteUnhydratedTailInstances',
    'validateHydratableInstance',
    'validateHydratableTextInstance',
]);

/** Hydration keys added by 0.32 (singleton hydration). */
export const HYDRATION_0_32 = /* @__PURE__ */ group('supportsHydration is false', [
    'getFirstHydratableChildWithinSingleton',
    'getNextHydratableSiblingAfterSingleton',
]);

/** Hydration keys added by 0.33 (Activity and dehydrated boundaries). */
export const HYDRATION_0_33 = /* @__PURE__ */ group('supportsHydration is false', [
    'canHydrateActivityInstance',
    'clearActivityBoundary',
    'clearActivityBoundaryFromContainer',
    'commitHydratedActivityInstance',
    'commitHydratedInstance',
    'finalizeHydratedChildren',
    'flushHydrationEvents',
    'getFirstHydratableChildWithinActivityInstance',
    'getNextHydratableInstanceAfterActivityInstance',
    'hideDehydratedBoundary',
    'hydrateActivityInstance',
    'unhideDehydratedBoundary',
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

export const RESOURCES = /* @__PURE__ */ group('supportsResources is not set (no hoistables or resources)', [
    'acquireResource',
    'createHoistableInstance',
    'getHoistableRoot',
    'getResource',
    'hydrateHoistable',
    'isHostHoistableType',
    'mayResourceSuspendCommit',
    'mountHoistable',
    'preloadResource',
    'prepareToCommitHoistables',
    'releaseResource',
    'supportsResources',
    'suspendResource',
    'unmountHoistable',
]);

export const SINGLETONS = /* @__PURE__ */ group('supportsSingletons is not set', [
    'acquireSingletonInstance',
    'isHostSingletonType',
    'releaseSingletonInstance',
    'resolveSingletonInstance',
    'supportsSingletons',
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

export const GATED_STABLE = /* @__PURE__ */ group('feature-gated off in the stable bundle (scope API)', [
    'getInstanceFromScope',
    'prepareScopeUpdate',
]);

export const MISC = /* @__PURE__ */ group('not reachable from a scene renderer', [
    // finalizeInitialChildren always returns false.
    'commitMount',
    // Only form host instances are reset; the scene has none.
    'resetFormInstance',
    // DevTools extras and server-component console replay.
    'bindToConsole',
    'extraDevToolsConfig',
    // createEventHandle API, gated off in the stable bundle.
    'beforeActiveInstanceBlur',
]);
