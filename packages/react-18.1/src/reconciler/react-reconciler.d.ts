/**
 * Declarations for the exact react-reconciler 0.28.0 this package depends on. No published declaration imports them.
 * They are written from the installed 0.28.0 bundle, not from `@types/react-reconciler` (whose 0.28 line is a
 * different API and whose React types are the React 19 line in this workspace): `HostConfig` lists exactly the host
 * keys this adapter implements for 0.28.0, with the call signatures that bundle uses. Keys the bundle reads but cannot
 * reach in a mutation-only, non-hydrating renderer are listed (with reasons) in `src/hostConfig.ts`; a unit test
 * checks both lists against the installed bundle.
 *
 * The React 18 shapes that differ from the React 19 epochs:
 * - one event-priority hook, `getCurrentEventPriority()` (no get/set/resolve update priority);
 * - payload-based updates: `prepareUpdate` returns an update payload, and `commitUpdate` receives it first;
 * - `unhideInstance(instance, props)`; no commit-suspension or transition-status keys;
 * - an eight-argument `createContainer` with a single root error callback, `onRecoverableError`;
 * - `flushSync(fn)` instead of `updateContainerSync` and `flushSyncWork`.
 *
 * The module is `#reconciler`, this package's `imports` alias of `react-reconciler` (package.json): the bundle
 * requires `react-reconciler` itself, while the declarations stay out of the way of `@types/react-reconciler`, which
 * its-fine's own declarations import under the real name.
 */
declare module '#reconciler'
{
    import type { ReactNode } from 'react';

    export interface RecoverableErrorInfo
    {
        componentStack?: string | null;
        digest?: string | null;
    }

    export type RecoverableErrorCallback = (error: unknown, info: RecoverableErrorInfo) => void;

    /** The reconciler's opaque root handle (a FiberRoot). */
    export interface OpaqueRoot { readonly __reconcilerRoot: '0.28' }

    export interface HostConfig<Type, Props, Container, Instance, PublicInstance, HostContext, UpdatePayload>
    {
        readonly isPrimaryRenderer: boolean;
        readonly supportsMutation: true;
        readonly supportsPersistence: false;
        readonly supportsHydration: false;
        readonly warnsIfNotActing: boolean;
        readonly noTimeout: -1;
        scheduleTimeout(handler: () => void, timeout?: number): unknown;
        cancelTimeout(handle: never): void;

        createInstance(type: Type, props: Props, container: Container, hostContext: HostContext, fiber: unknown): Instance;
        createTextInstance(text: string, container: Container, hostContext: HostContext, fiber: unknown): never;
        appendInitialChild(parent: Instance, child: Instance): void;
        finalizeInitialChildren(instance: Instance, type: Type, props: Props, container: Container, hostContext: HostContext): boolean;
        prepareUpdate(
            instance: Instance,
            type: Type,
            previous: Props,
            next: Props,
            container: Container,
            hostContext: HostContext,
        ): UpdatePayload | null;
        shouldSetTextContent(type: Type, props: Props): boolean;
        getRootHostContext(container: Container): HostContext;
        getChildHostContext(parentContext: HostContext, type: Type, container: Container): HostContext;
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
        commitUpdate(instance: Instance, payload: UpdatePayload, type: Type, previous: Props, next: Props, fiber: unknown): void;
        hideInstance(instance: Instance): void;
        unhideInstance(instance: Instance, props: Props): void;
        clearContainer(container: Container): void;
        detachDeletedInstance(instance: Instance): void;

        getCurrentEventPriority(): number;
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
            onRecoverableError: RecoverableErrorCallback,
            transitionCallbacks: null,
        ): OpaqueRoot;
        updateContainer(element: ReactNode, container: OpaqueRoot, parentComponent: null, callback?: (() => void) | null): number;
        flushSync<R>(fn: () => R): R;
    }

    export default function createReconciler<Type, Props, Container, Instance, PublicInstance, HostContext, UpdatePayload>(
        config: HostConfig<Type, Props, Container, Instance, PublicInstance, HostContext, UpdatePayload>,
    ): Reconciler<Container>;
}

declare module '#reconciler/constants'
{
    export const LegacyRoot: 0;
    export const ConcurrentRoot: 1;
    export const DiscreteEventPriority: 1;
    export const ContinuousEventPriority: 4;
    export const DefaultEventPriority: 16;
    export const IdleEventPriority: 536870912;
}
