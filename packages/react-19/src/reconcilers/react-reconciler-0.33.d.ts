/**
 * Declarations for the exact react-reconciler 0.33.0 bundled into the `/19.2` subpath (npm alias
 * `react-reconciler-0.33`). They are written from the installed 0.33.0 bundle, not from `@types/react-reconciler`:
 * `HostConfig` lists exactly the host keys this adapter implements for 0.33.0, with the call signatures that bundle
 * uses. Keys the bundle reads but cannot reach in a mutation-only, non-hydrating renderer are listed (with reasons)
 * in `src/19.2/hostConfig.ts`; a unit test checks both lists against the installed bundle.
 */
declare module 'react-reconciler-0.33'
{
    import type { Context, ReactNode } from 'react';

    /** The commit's suspended-state object, opaque to the host. */
    export type SuspendedState = unknown;

    export interface ErrorInfo { componentStack?: string | null }
    export type RootErrorCallback = (error: unknown, info: ErrorInfo) => void;

    /** The reconciler's opaque root handle (a FiberRoot). */
    export interface OpaqueRoot { readonly __reconcilerRoot: '0.33' }

    export interface HostConfig<Type, Props, Container, Instance, PublicInstance, HostContext, TransitionStatus>
    {
        readonly isPrimaryRenderer: boolean;
        readonly supportsMutation: true;
        readonly supportsPersistence: false;
        readonly supportsHydration: false;
        readonly warnsIfNotActing: boolean;
        readonly noTimeout: -1;
        readonly rendererPackageName: string;
        readonly rendererVersion: string;
        readonly NotPendingTransition: TransitionStatus;
        readonly HostTransitionContext: Context<TransitionStatus>;
        scheduleTimeout(handler: () => void, timeout?: number): unknown;
        cancelTimeout(handle: never): void;

        createInstance(type: Type, props: Props, container: Container, hostContext: HostContext, fiber: unknown): Instance;
        createTextInstance(text: string, container: Container, hostContext: HostContext, fiber: unknown): never;
        appendInitialChild(parent: Instance, child: Instance): void;
        finalizeInitialChildren(instance: Instance, type: Type, props: Props, container: Container, hostContext: HostContext): boolean;
        shouldSetTextContent(type: Type, props: Props): boolean;
        getRootHostContext(container: Container): HostContext;
        getChildHostContext(parentContext: HostContext, type: Type): HostContext;
        getPublicInstance(instance: Instance): PublicInstance;
        prepareForCommit(container: Container): null;
        resetAfterCommit(container: Container): void;
        preparePortalMount(container: Container): void;
        appendChild(parent: Instance, child: Instance): void;
        appendChildToContainer(container: Container, child: Instance): void;
        insertBefore(parent: Instance, child: Instance, before: Instance): void;
        insertInContainerBefore(container: Container, child: Instance, before: Instance): void;
        removeChild(parent: Instance, child: Instance): void;
        removeChildFromContainer(container: Container, child: Instance): void;
        commitUpdate(instance: Instance, type: Type, previous: Props, next: Props, fiber: unknown): void;
        hideInstance(instance: Instance): void;
        unhideInstance(instance: Instance, props: Props): void;
        clearContainer(container: Container): void;
        detachDeletedInstance(instance: Instance): void;

        getCurrentUpdatePriority(): number;
        setCurrentUpdatePriority(priority: number): void;
        resolveUpdatePriority(): number;
        shouldAttemptEagerTransition(): boolean;

        // Commit suspension, 0.33+ shape: a suspended-state object threads through the commit.
        maySuspendCommit(type: Type, props: Props): boolean;
        maySuspendCommitOnUpdate(type: Type, previous: Props, next: Props): boolean;
        maySuspendCommitInSyncRender(type: Type, props: Props): boolean;
        preloadInstance(instance: Instance, type: Type, props: Props): boolean;
        startSuspendingCommit(): SuspendedState;
        suspendInstance(state: SuspendedState, instance: Instance, type: Type, props: Props): void;
        waitForCommitToBeReady(state: SuspendedState, timeoutOffset: number): null | ((commit: () => void) => () => void);
        getSuspendedCommitReason(state: SuspendedState, container: Container): null | string;

        // Scheduler instrumentation and performance tracks (called by the 0.33+ bundle).
        trackSchedulerEvent(): void;
        resolveEventType(): null | string;
        resolveEventTimeStamp(): number;

        // Read by the bundle but gated off in its stable build; implemented to fail clearly if ever reached.
        createFragmentInstance(fiber: unknown): never;
        createViewTransitionInstance(name: string): never;
    }

    export interface Reconciler<Container>
    {
        createContainer(
            containerInfo: Container,
            tag: 0 | 1,
            hydrationCallbacks: null,
            isStrictMode: boolean,
            concurrentUpdatesByDefaultOverride: null | boolean,
            identifierPrefix: string,
            onUncaughtError: RootErrorCallback,
            onCaughtError: RootErrorCallback,
            onRecoverableError: RootErrorCallback,
            onDefaultTransitionIndicator: () => void | (() => void),
        ): OpaqueRoot;
        updateContainer(element: ReactNode, container: OpaqueRoot, parentComponent: null, callback?: (() => void) | null): number;
        updateContainerSync(element: ReactNode, container: OpaqueRoot, parentComponent: null, callback?: (() => void) | null): number;
        flushSyncWork(): boolean;
    }

    export default function createReconciler<Type, Props, Container, Instance, PublicInstance, HostContext, TransitionStatus>(
        config: HostConfig<Type, Props, Container, Instance, PublicInstance, HostContext, TransitionStatus>,
    ): Reconciler<Container>;
}

declare module 'react-reconciler-0.33/constants'
{
    export const LegacyRoot: 0;
    export const ConcurrentRoot: 1;
    export const NoEventPriority: 0;
    export const DiscreteEventPriority: 2;
    export const ContinuousEventPriority: 8;
    export const DefaultEventPriority: 32;
    export const IdleEventPriority: 268435456;
}
