/**
 * The fake scene backend as a core `SceneAdapter`, so a `createRenderer({ framework, scene })` composition can
 * run the conformance suite without a renderer. Exported as `@pixi-react-provisional/conformance/fake-scene-adapter`
 * (a separate entry, so the facade's conformance run never loads core).
 */
import { applyFakeProps, type FakeNodeDefinition, FakeSceneSession, type FakeSceneSessionOptions } from './session';
import {
    type AdapterManifest,
    type Constructor,
    type NodeDefinition,
    type PropsFamily,
    type RootTarget,
    type Runtime,
    SceneAdapter,
    type SceneSession,
    type SceneTypes,
    type TickOptions,
} from '@pixi-react-provisional/core';

import type { FakeApplication, FakeApplicationOptions, FakeContainer, FakeNodeDestroyOptions, FakeTicker } from './nodes';

export interface FakePropsFamily extends PropsFamily
{
    readonly type: Record<string, unknown>;
}

export interface FakeDestroyOptions
{
    destroyOptions?: FakeNodeDestroyOptions;
    rendererDestroyOptions?: unknown;
}

/** The fake backend's scene types. */
export interface FakeSceneTypes extends SceneTypes
{
    readonly node: FakeContainer;
    readonly app: FakeApplication;
    readonly options: FakeApplicationOptions;
    readonly appProps: { resizeTo?: HTMLElement | null };
    readonly destroy: FakeDestroyOptions;
    readonly nodeDestroy: FakeNodeDestroyOptions;
    readonly tick: FakeTicker;
    readonly props: FakePropsFamily;
}

export const FAKE_SCENE_CAPABILITIES = Object.freeze({
    'scene.mutation': 1,
    'scene.visibility': 1,
    'scene.application': 1,
    'scene.ticker': 1,
});

export interface FakeSceneAdapterOptions extends FakeSceneSessionOptions
{
    /** Element-name prefix stripped by `normalizeName` (e.g. `fake` for `fakeSprite`). */
    prefix?: string;
}

/** Adapts one `FakeSceneSession` to the core `SceneSession` protocol. */
class CoreFakeSession implements SceneSession<FakeSceneTypes>
{
    constructor(private readonly inner: FakeSceneSession)
    {}

    get app(): FakeApplication
    {
        return this.inner.app;
    }

    get container(): FakeContainer
    {
        return this.inner.container;
    }

    init(options: FakeApplicationOptions, signal: AbortSignal): Promise<void>
    {
        return this.inner.init(options, signal);
    }

    updateApplication(props: { resizeTo?: HTMLElement | null }): void
    {
        this.inner.updateApplication(props);
    }

    create(definition: NodeDefinition, props: unknown): FakeContainer
    {
        const { name, ctor } = definition;

        return this.inner.create({ name, ctor: ctor as unknown as FakeNodeDefinition['ctor'] }, (props ?? {}) as Record<string, unknown>);
    }

    update(node: FakeContainer, previous: unknown, next: unknown): void
    {
        this.inner.update(node, previous as Record<string, unknown>, next as Record<string, unknown>);
    }

    destroyNode(node: FakeContainer, options: FakeNodeDestroyOptions | undefined): void
    {
        this.inner.destroyNode(node, options);
    }

    append(parent: FakeContainer, child: FakeContainer): void
    {
        this.inner.append(parent, child);
    }

    insertBefore(parent: FakeContainer, child: FakeContainer, before: FakeContainer): void
    {
        this.inner.insertBefore(parent, child, before);
    }

    remove(parent: FakeContainer, child: FakeContainer): void
    {
        this.inner.remove(parent, child);
    }

    setHidden(node: FakeContainer, hidden: boolean): void
    {
        this.inner.setHidden(node, hidden);
    }

    publicInstance(node: FakeContainer): object
    {
        return node;
    }

    subscribe<C>(options: TickOptions<FakeTicker, C>): () => void
    {
        return this.inner.subscribe(options as TickOptions<FakeTicker, unknown> as Parameters<FakeSceneSession['subscribe']>[0]);
    }

    nodeDestroyOptions(options: FakeDestroyOptions | undefined): FakeNodeDestroyOptions | undefined
    {
        return options?.destroyOptions;
    }

    destroy(options: FakeDestroyOptions | undefined): void
    {
        this.inner.destroy(options?.rendererDestroyOptions, options?.destroyOptions);
    }
}

/** A scene adapter over the fake backend. Every session shares the adapter's journal, faults and init interceptor. */
export class FakeSceneAdapter extends SceneAdapter<FakeSceneTypes>
{
    readonly manifest: AdapterManifest = {
        abi: { major: 1, minor: 0 },
        id: 'conformance.fake-scene',
        packageVersion: '0.0.0',
        certification: 'none: conformance test double',
        provides: FAKE_SCENE_CAPABILITIES,
        requires: {},
    };

    constructor(private readonly options: FakeSceneAdapterOptions = {})
    {
        super();
    }

    normalizeName(name: string): string
    {
        const { prefix } = this.options;

        return prefix && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
    }

    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        return { name, ctor, capabilities: { 'scene.mutation': 1 }, attach: { role: 'child', accepts: ['child'] } };
    }

    createSession(_runtime: Runtime<FakeSceneTypes>, _target: RootTarget): SceneSession<FakeSceneTypes>
    {
        return new CoreFakeSession(new FakeSceneSession(this.options));
    }

    applyProps(node: FakeContainer, props: unknown): void
    {
        applyFakeProps(node, {}, props as Record<string, unknown>, this.options.faults);
    }
}
