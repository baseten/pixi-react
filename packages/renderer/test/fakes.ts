/** Minimal fake adapters built on the published core entry, as a third-party adapter would be. */
import { FrameworkAdapter, SceneAdapter } from '@pixi-react-provisional/core';

import type {
    AdapterManifest,
    Bind,
    BindingFamily,
    Constructor,
    NodeDefinition,
    PropsFamily,
    RootTarget,
    Runtime,
    SceneSession,
    SceneTypes,
} from '@pixi-react-provisional/core';

export const manifest = (id: string, extra: Partial<AdapterManifest> = {}): AdapterManifest => ({
    abi: { major: 1, minor: 0 },
    id,
    packageVersion: '0.0.0-test',
    certification: 'test://renderer',
    provides: {},
    requires: {},
    ...extra,
});

export class Item
{
    constructor(readonly options: { label: string })
    {}
}

export interface ItemScene extends SceneTypes
{
    readonly node: Item;
    readonly app: { readonly name: 'item-app' };
    readonly tick: { deltaMS: number };
    readonly props: PropsFamily;
}

export class ItemSceneAdapter extends SceneAdapter<ItemScene>
{
    readonly manifest = manifest('test.items', { provides: { 'scene.mutation': 1 } });
    readonly sessions: RootTarget[] = [];

    createSession(_runtime: Runtime<ItemScene>, target: RootTarget): SceneSession<ItemScene>
    {
        this.sessions.push(target);

        const app = { name: 'item-app' } as const;

        return {
            app,
            container: new Item({ label: 'stage' }),
            init: async () => undefined,
            updateApplication: () => undefined,
            create: (definition, props) => new (definition.ctor as unknown as typeof Item)(props as { label: string }),
            update: () => undefined,
            destroyNode: () => undefined,
            append: () => undefined,
            insertBefore: () => undefined,
            remove: () => undefined,
            setHidden: () => undefined,
            publicInstance: (node) => node,
            subscribe: () => () => undefined,
            destroy: () => undefined,
        };
    }

    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        return { name, ctor, capabilities: {}, attach: { role: 'child', accepts: ['child'] } };
    }
}

export interface Tools<S extends SceneTypes>
{
    readonly runtimeId: symbol;
    extend(catalog: Record<string, Constructor>): void;
    mount(target: RootTarget): Promise<S['app']>;
}

export interface ToolsFamily extends BindingFamily
{
    readonly type: Tools<Extract<this['scene'], SceneTypes>>;
}

export class ToolsFramework extends FrameworkAdapter<ToolsFamily>
{
    readonly manifest: AdapterManifest;
    calls = 0;

    constructor(extra: Partial<AdapterManifest> = {}, private readonly result?: () => unknown)
    {
        super();
        this.manifest = manifest('test.tools', { requires: { 'scene.mutation': 1 }, ...extra });
    }

    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<ToolsFamily, S>
    {
        this.calls += 1;

        if (this.result)
        {
            return this.result() as Bind<ToolsFamily, S>;
        }

        return {
            runtimeId: runtime.id,
            extend: (catalog) => runtime.registry.extend(catalog),
            mount: (target) => runtime.createRoot(target).initialise({} as S['options']),
        };
    }
}
