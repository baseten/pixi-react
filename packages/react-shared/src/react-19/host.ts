/**
 * The host operations every React 19 minor shares, on top of the ones every adapter package shares
 * (`../common/host.ts`). They translate reconciler calls into core's scene protocol.
 *
 * This is not a host config. Each per-minor package builds its own config object, typed against its own pinned
 * reconciler declaration, from these functions plus its reconciler-specific keys; no config is shared between minors
 * or cast to another minor's type. Within one package copy, the config is runtime-independent and backs ONE shared
 * reconciler (see `../common/host.ts`).
 */
import { createContext, type ReactNode } from 'react';
import {
    type AnyNode,
    createMutationHost as createCommonMutationHost,
    currentEventPriority,
    type HostContainer,
    type HostProps,
    recordOf as recordOfNode,
} from '../common/index.js';
import { CompatibilityError, type PixiTypes } from '@pixi-react-provisional/core';

export {
    type AnyHostContainer,
    type AnyNode,
    cancelTimeout,
    currentEvent,
    type HostContainer,
    type HostProps,
    rawTextError,
    recordOf,
    scheduleTimeout,
} from '../common/index.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

export interface RootErrorInfoLike
{
    componentStack?: string | null;
}

/** The three root error channels, as React calls them. */
export interface EpochRootCallbacks
{
    onUncaughtError(error: unknown, info: RootErrorInfoLike): void;
    onCaughtError(error: unknown, info: RootErrorInfoLike): void;
    onRecoverableError(error: unknown, info: RootErrorInfoLike): void;
}

/** A reconciler root, as the shared bindings see it. Each epoch implements it over its own reconciler. */
export interface EpochRoot
{
    /** Schedules `element` at the current update priority; `callback` runs once the update has committed. */
    update(element: ReactNode, callback: () => void): void;
    /** Renders `null` synchronously and flushes, so every node is removed before the call returns. */
    unmountSync(): void;
}

/** What an epoch hands the shared bindings. */
export interface EpochRenderer<S extends PixiTypes>
{
    createRoot(container: HostContainer<S>, callbacks: EpochRootCallbacks, identifierPrefix: string): EpochRoot;
}

/** Event priorities of the epoch's reconciler, from its own `constants` module. */
export interface EventPriorities
{
    readonly NoEventPriority: number;
    readonly DiscreteEventPriority: number;
    readonly ContinuousEventPriority: number;
    readonly DefaultEventPriority: number;
}

/** The update-priority hooks (19.0+ shape), with the baseline mapping of DOM event types to priorities. */
export function createPriorityHost(priorities: EventPriorities)
{
    let current = priorities.NoEventPriority;

    return {
        getCurrentUpdatePriority: (): number => current,
        setCurrentUpdatePriority(priority: number): void
        {
            current = priority;
        },
        resolveUpdatePriority: (): number =>
            (current !== priorities.NoEventPriority ? current : currentEventPriority(priorities)),
    };
}

/** `HostTransitionContext` of this package's reconciler (read by form-status hooks). */
export const HostTransitionContext = createContext<null>(null);

/** The static renderer keys every epoch's config starts from. */
export const STATIC_HOST_KEYS = Object.freeze({
    isPrimaryRenderer: false,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    // Upstream parity: no act() warnings from the scene renderer.
    warnsIfNotActing: false,
    noTimeout: -1,
    NotPendingTransition: null,
    HostTransitionContext,
} as const);

/**
 * A React feature this epoch's reconciler can reach but the renderer does not support (fragment refs,
 * ViewTransition). Raised with the built-in `CAPABILITY_MISSING` code and the missing capability's ID.
 */
export function unsupportedFeature(adapterId: string, capability: string, feature: string): CompatibilityError
{
    return new CompatibilityError(
        process.env.NODE_ENV !== 'production' ? `${feature} is not supported by the ${adapterId} renderer: the Pixi adapter provides no "${capability}" capability.` : '',
        { code: 'CAPABILITY_MISSING', adapterIds: [adapterId], capability, expected: { [capability]: 1 }, actual: { [capability]: null } },
    );
}

/**
 * The mutation-mode operations of every React 19 minor: the shared ones plus React 19's `commitUpdate` (previous and
 * next props, no payload) and `shouldAttemptEagerTransition`. Runtime-independent: nodes are traced to their runtime.
 */
export function createMutationHost()
{
    return {
        ...createCommonMutationHost(),
        commitUpdate: (node: AnyNode, _type: string, previous: HostProps, next: HostProps): void =>
            recordOfNode(node).pixi.update(node, previous, next),
        shouldAttemptEagerTransition: (): boolean => false,
    };
}
