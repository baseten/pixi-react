/**
 * The contract between the React 18 bindings (`bindings.tsx`) and each React 18 package's reconciler integration
 * (its `hostConfig.ts`), the errors both raise, and the host config every React 18 reconciler (0.27.0, 0.28.0,
 * 0.29.0, 0.29.2) takes. Nothing here names a reconciler type: the bindings see a root as "schedule an update" and
 * "unmount synchronously", and each package types the host config built here against the declarations of its own
 * pinned reconciler (`src/reconciler/react-reconciler.d.ts`), so a reconciler whose host shape differs fails its
 * package's typecheck instead of being cast.
 *
 * Every scene operation forwards to the owning root's core `PixiBridge`: names resolve through the runtime registry,
 * and every node is created, mutated, hidden and destroyed by the Pixi session. No scene library is called directly.
 *
 * React 18 specifics (each differs from the React 19 epochs): `getCurrentEventPriority()` is the only priority hook;
 * updates are payload-based (`prepareUpdate` diffs, `commitUpdate` receives the payload first); `unhideInstance`
 * receives the props; there are no commit-suspension or transition-status keys; `createContainer` takes eight
 * arguments with `onRecoverableError` as the only error callback; a synchronous unmount uses `flushSync`.
 */
import {
    cancelTimeout,
    createMutationHost,
    currentEventPriority,
    type EventPriorityLevels,
    type HostContainer,
    type HostProps,
    recordOf,
    scheduleTimeout,
} from '../common/index.js';
import { CompatibilityError, type PixiTypes } from '@pixi-react-provisional/core';

import type { ReactNode } from 'react';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

export type { AnyHostContainer, AnyNode, HostContainer, HostProps } from '../common/index.js';
export { rawTextError } from '../common/index.js';

/** What React 18 passes to `onRecoverableError`. */
export interface RecoverableErrorInfoLike
{
    componentStack?: string | null;
    digest?: string | null;
}

/**
 * The root error channel React 18 has. React 18 roots have no caught- or uncaught-error callback: caught errors are
 * logged by React, and an uncaught error unmounts the root and is rethrown.
 */
export interface RootCallbacks
{
    onRecoverableError(error: unknown, info: RecoverableErrorInfoLike): void;
}

/** A reconciler root, as the bindings see it. */
export interface ReconcilerRoot
{
    /** Schedules `element` at the current event priority; `callback` runs once the update has committed. */
    update(element: ReactNode, callback: () => void): void;
    /** Renders `null` synchronously, so every node is removed (and passive cleanups run) before the call returns. */
    unmountSync(): void;
}

/** What the reconciler integration hands the bindings. */
export interface SceneRenderer<S extends PixiTypes>
{
    createRoot(container: HostContainer<S>, callbacks: RootCallbacks, identifierPrefix: string): ReconcilerRoot;
}

/** Capabilities React 18 does not have, which the React 19 epochs provide or accept. */
export const UNSUPPORTED_CAPABILITIES = Object.freeze({
    /** `<Activity>` (React 19.2+): no Activity component, so no `useActivityBridge` and no hide/reveal of a subtree. */
    'react.activity': 'React 18 has no <Activity> component (React 19.2+).',
    /** `onCaughtError` / `onUncaughtError` root callbacks (React 19+). */
    'react.root-error-callbacks': 'React 18 roots take only onRecoverableError; onCaughtError and onUncaughtError are React 19 root options.',
} as const);

export type UnsupportedCapability = keyof typeof UNSUPPORTED_CAPABILITIES;

/**
 * A React 19 root option passed to a React 18 root. Raised with the built-in `CAPABILITY_MISSING` code and the
 * missing capability, never silently ignored.
 */
export function unsupportedOptionError(adapterId: string, option: string): CompatibilityError
{
    const capability: UnsupportedCapability = 'react.root-error-callbacks';

    return new CompatibilityError(
        process.env.NODE_ENV !== 'production'
            ? (`The ${option} option is not supported by the ${adapterId} adapter: ${UNSUPPORTED_CAPABILITIES[capability]} `
            + 'Catch render errors with an error boundary, or use onRecoverableError for recovered concurrent errors.')
            : '',
        {
            code: 'CAPABILITY_MISSING',
            adapterIds: [adapterId],
            capability,
            expected: { [capability]: 1 },
            actual: { [capability]: null },
        },
    );
}

/** Marks an update React must commit; the props themselves are the payload's data. */
export const UPDATE_PAYLOAD = true;

/**
 * React 18's update diff. `children` is React's, not the scene's; every other key is compared by identity, so a
 * changed callback (`draw`, an event handler) is an update, as it is for the React 19 epochs. Returns `null` when
 * nothing the scene sees changed, so React skips `commitUpdate`.
 */
export function prepareUpdate(previous: HostProps, next: HostProps): typeof UPDATE_PAYLOAD | null
{
    for (const key in previous)
    {
        if (key !== 'children' && (!(key in next) || !Object.is(previous[key], next[key])))
        {
            return UPDATE_PAYLOAD;
        }
    }

    for (const key in next)
    {
        if (key !== 'children' && !(key in previous))
        {
            return UPDATE_PAYLOAD;
        }
    }

    return null;
}

/**
 * The React 18 host config, built from one reconciler's priority constants. It is runtime-independent: containers
 * carry their runtime and record, and nodes are traced to their runtime (react-shared's `common/host.ts`). One config,
 * and therefore one reconciler, serves every runtime a package copy binds (each package's `sharedReconciler`).
 */
export function createReact18HostConfig(levels: EventPriorityLevels)
{
    return {
        isPrimaryRenderer: false,
        supportsMutation: true as const,
        supportsPersistence: false as const,
        supportsHydration: false as const,
        // Upstream parity: no act() warnings from the scene renderer.
        warnsIfNotActing: false,
        noTimeout: -1 as const,
        scheduleTimeout,
        cancelTimeout,

        ...createMutationHost(),
        prepareUpdate: (_node: unknown, _type: string, previous: HostProps, next: HostProps) => prepareUpdate(previous, next),
        // React 18 passes the payload first; the scene diffs previous and next props itself.
        commitUpdate: (node: PixiTypes['node'], _payload: unknown, _type: string, previous: HostProps, next: HostProps): void =>
            recordOf(node).pixi.update(node, previous, next),
        // React 18's single priority hook, with the baseline mapping of DOM event types to priorities.
        getCurrentEventPriority: (): number => currentEventPriority(levels),
    };
}

/** The part of a React 18 reconciler the scene renderer calls once a root exists. */
export interface React18RootReconciler<R>
{
    updateContainer(element: ReactNode, container: R, parentComponent: null, callback?: (() => void) | null): number;
    flushSync<T>(fn: () => T): T;
}

/**
 * The scene renderer over one package's shared reconciler and root factory: updates at the current event priority,
 * and a synchronous unmount through `flushSync` (React 18 commits a sync-lane update and flushes its passive effects
 * before `flushSync` returns).
 */
export function createSceneRenderer<S extends PixiTypes, R>(
    reconciler: React18RootReconciler<R>,
    createContainer: (container: HostContainer<S>, callbacks: RootCallbacks, identifierPrefix: string) => R,
): SceneRenderer<S>
{
    return {
        createRoot(container, callbacks, identifierPrefix)
        {
            const root = createContainer(container, callbacks, identifierPrefix);

            return {
                update: (element, callback) =>
                {
                    reconciler.updateContainer(element, root, null, callback);
                },
                unmountSync()
                {
                    reconciler.flushSync(() =>
                    {
                        reconciler.updateContainer(null, root, null, null);
                    });
                },
            };
        },
    };
}
