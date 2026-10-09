/**
 * Fragment refs and ViewTransition. React can reach them from 19.3 (reconciler 0.34); the scene renderer
 * provides neither, so the adapter rejects them with a `CompatibilityError` (`CAPABILITY_MISSING`) instead of
 * silently doing nothing.
 */
import { unsupportedFeature } from './host.js';

export const FRAGMENT_REF_CAPABILITY = 'react.fragment-ref';
export const VIEW_TRANSITION_CAPABILITY = 'react.view-transition';

export function fragmentRefError(adapterId: string)
{
    return unsupportedFeature(adapterId, FRAGMENT_REF_CAPABILITY, 'A ref on a <Fragment> (fragment instance)');
}

export function viewTransitionError(adapterId: string)
{
    return unsupportedFeature(adapterId, VIEW_TRANSITION_CAPABILITY, '<ViewTransition> animation, refs and events');
}

/**
 * Stubs for fragment-instance and view-transition creation in epochs whose stable bundle reads but never calls
 * them (19.1, 19.2): if a bundle ever reached them, they fail with a clear error instead of a TypeError.
 */
export function gatedFeatureStubs(adapterId: string)
{
    return {
        createFragmentInstance(): never
        {
            throw fragmentRefError(adapterId);
        },
        createViewTransitionInstance(): never
        {
            throw viewTransitionError(adapterId);
        },
    };
}
