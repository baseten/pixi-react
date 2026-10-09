/** Keys several epochs share in their unreachable lists (see `audit.ts`). */
import type { UnreachableKeys } from './audit.js';

/** Persistent-mode view-transition clones, read since 0.32: unreachable in mutation mode. */
export const PERSISTENT_VIEW_TRANSITION: UnreachableKeys = Object.freeze({
    cloneMutableInstance: 'supportsPersistence is false',
    cloneMutableTextInstance: 'supportsPersistence is false',
    cloneRootViewTransitionContainer: 'supportsPersistence is false (persistent view transitions)',
    removeRootViewTransitionClone: 'supportsPersistence is false (persistent view transitions)',
    measureClonedInstance: 'supportsPersistence is false (persistent view transitions)',
});

/** Gesture transitions: gated off in every audited stable bundle. */
export const GESTURES: UnreachableKeys = Object.freeze({
    getCurrentGestureOffset: 'gesture transitions are gated off in the stable bundle',
    startGestureTransition: 'gesture transitions are gated off in the stable bundle',
});

/** View-transition and fragment-instance keys 0.32/0.33 read but their stable bundles never call. */
export const GATED_VIEW_TRANSITION: UnreachableKeys = Object.freeze({
    cancelRootViewTransitionName: 'ViewTransition is gated off in the stable bundle',
    cancelViewTransitionName: 'ViewTransition is gated off in the stable bundle',
    hasInstanceAffectedParent: 'ViewTransition is gated off in the stable bundle',
    hasInstanceChanged: 'ViewTransition is gated off in the stable bundle',
    restoreRootViewTransitionName: 'ViewTransition is gated off in the stable bundle',
    startViewTransition: 'ViewTransition is gated off in the stable bundle',
    suspendOnActiveViewTransition: 'ViewTransition is gated off in the stable bundle',
    commitNewChildToFragmentInstance: 'fragment refs are gated off in the stable bundle',
    deleteChildFromFragmentInstance: 'fragment refs are gated off in the stable bundle',
    updateFragmentInstanceFiber: 'fragment refs are gated off in the stable bundle',
});
