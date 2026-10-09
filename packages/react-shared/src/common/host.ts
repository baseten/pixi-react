/**
 * The host operations every React adapter package shares (React 18.3 and each React 19 minor). They translate
 * reconciler calls into core's scene protocol: names resolve through the runtime registry, and every node is created,
 * mutated, hidden and destroyed through the owning root's `PixiBridge`. No scene library is called directly.
 *
 * Nothing here depends on a runtime. Containers carry their runtime and root record, and each node is traced to the
 * runtime that created it through `nodeRuntimes`, so ONE host config, and therefore ONE reconciler, serves every
 * runtime a package copy binds (see each package's `sharedReconciler`). This is not a host config: each package
 * builds its own config object, typed against its own pinned reconciler declaration, from these functions plus its
 * reconciler-specific keys.
 *
 * This module is bundled into each adapter package, so `nodeRuntimes` exists once per loaded package copy.
 */
import type { PixiTypes, RootRecord, Runtime } from '@pixi-react-provisional/core';

export type HostProps = Record<string, unknown>;

/** The reconciler container of one root: its core record and the runtime that owns it. */
export interface HostContainer<S extends PixiTypes>
{
    readonly runtime: Runtime<S>;
    readonly record: RootRecord<S>;
}

/** Any runtime's container, as the runtime-independent host config sees it. */
export type AnyHostContainer = HostContainer<PixiTypes>;

/** Any runtime's scene node. */
export type AnyNode = PixiTypes['node'];

export const scheduleTimeout = (handler: () => void, timeout?: number): unknown => setTimeout(handler, timeout);
export const cancelTimeout = (handle: never): void => clearTimeout(handle);

/** Thrown for a raw string child: the scene has no text nodes. */
export function rawTextError(text: string): Error
{
    return new Error(
        `Raw text "${text}" cannot be rendered in the scene. Use a text component (for example <pixiText text="…" />).`,
    );
}

/** The single host context: the scene has no context-dependent node creation. */
const ROOT_HOST_CONTEXT = Object.freeze({});

/**
 * The runtime that created each node. Host operations on a node (append, insert, remove, update, hide) carry no
 * container, so the shared reconciler finds the node's runtime here and asks that runtime's core for the owning
 * root. Core's own node table stays the source of truth: a node no runtime owns is rejected.
 */
const nodeRuntimes = new WeakMap<object, Runtime<PixiTypes>>();

/** The root record that owns `node`, through the runtime that created it. Throws for a node no runtime owns. */
export function recordOf(node: AnyNode): RootRecord<PixiTypes>
{
    const info = nodeRuntimes.get(node as object)?.nodeInfo(node);

    if (!info)
    {
        throw new Error('The node is not owned by this renderer runtime.');
    }

    return info.root;
}

/**
 * The mutation-mode operations every package shares. Each forwards to the owning root's Pixi bridge, which checks
 * ownership and attach rules before mutating and destroys removed subtrees after the commit, each node exactly once.
 * `commitUpdate` is not here: its signature differs between React 18 (payload first) and React 19.
 */
export function createMutationHost()
{
    return {
        createInstance(type: string, props: HostProps, container: AnyHostContainer): AnyNode
        {
            const node = container.record.pixi.create(type, props);

            nodeRuntimes.set(node as object, container.runtime);

            return node;
        },
        createTextInstance(text: string): never
        {
            throw rawTextError(text);
        },
        appendInitialChild: (parent: AnyNode, child: AnyNode): void => recordOf(parent).pixi.append(parent, child),
        finalizeInitialChildren: (): boolean => false,
        shouldSetTextContent: (): boolean => false,
        getRootHostContext: (): object => ROOT_HOST_CONTEXT,
        getChildHostContext: (context: object): object => context,
        getPublicInstance: (node: AnyNode): object => recordOf(node).pixi.publicInstance(node),
        prepareForCommit: (): null => null,
        // Removed subtrees are destroyed after the commit, through core, each node exactly once.
        resetAfterCommit: (container: AnyHostContainer): void => container.record.pixi.flush(),
        preparePortalMount: (): void => undefined,
        appendChild: (parent: AnyNode, child: AnyNode): void => recordOf(parent).pixi.append(parent, child),
        appendChildToContainer: ({ record }: AnyHostContainer, child: AnyNode): void =>
            record.pixi.append(record.session.container, child),
        insertBefore: (parent: AnyNode, child: AnyNode, before: AnyNode): void =>
            recordOf(parent).pixi.insertBefore(parent, child, before),
        insertInContainerBefore: ({ record }: AnyHostContainer, child: AnyNode, before: AnyNode): void =>
            record.pixi.insertBefore(record.session.container, child, before),
        removeChild: (parent: AnyNode, child: AnyNode): void => recordOf(child).pixi.remove(parent, child),
        removeChildFromContainer: ({ record }: AnyHostContainer, child: AnyNode): void =>
            record.pixi.remove(record.session.container, child),
        // Suspense fallbacks (and, on React 19.2+, Activity) hide through the session's visibility layer.
        hideInstance: (node: AnyNode): void => recordOf(node).pixi.setHidden(node, true),
        unhideInstance: (node: AnyNode): void => recordOf(node).pixi.setHidden(node, false),
        // The container's children belong to the Pixi session; React never clears it.
        clearContainer: (): void => undefined,
        // Drop the node's runtime link, so an instance user code still holds cannot keep a disposed runtime alive.
        detachDeletedInstance(node: AnyNode): void
        {
            nodeRuntimes.delete(node as object);
        },
    };
}
