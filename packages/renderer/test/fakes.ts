/** Minimal fake adapters built on the published core entry, as a third-party adapter would be. */
import { PixiAdapter, ReactAdapter } from '@pixi-react-provisional/core';

import type {
    AdapterManifest,
    Bind,
    Constructor,
    NodeDefinition,
    PixiSession,
    PixiTypes,
    PropsFamily,
    ReactBindingFamily,
    RootTarget,
    Runtime,
} from '@pixi-react-provisional/core';

export const manifest = (id: string, extra: Partial<AdapterManifest> = {}): AdapterManifest => ({
    abi: { major: 1, minor: 0 },
    id,
    packageVersion: '0.0.0-test',
    verification: 'test://renderer',
    provides: {},
    requires: {},
    ...extra,
});

export class Item
{
    constructor(readonly options: { label: string })
    {}
}

export interface ItemPixiTypes extends PixiTypes
{
    readonly node: Item;
    readonly app: { readonly name: 'item-app' };
    readonly tick: { deltaMS: number };
    readonly props: PropsFamily;
}

export class ItemPixiAdapter extends PixiAdapter<ItemPixiTypes>
{
    readonly manifest = manifest('test.items', { provides: { 'pixi.mutation': 1 } });
    readonly sessions: RootTarget[] = [];

    createSession(_runtime: Runtime<ItemPixiTypes>, target: RootTarget): PixiSession<ItemPixiTypes>
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

export interface Tools<S extends PixiTypes>
{
    readonly runtimeId: symbol;
    extend(catalog: Record<string, Constructor>): void;
    mount(target: RootTarget): Promise<S['app']>;
}

export interface ToolsFamily extends ReactBindingFamily
{
    readonly type: Tools<Extract<this['pixi'], PixiTypes>>;
}

export class ToolsReactAdapter extends ReactAdapter<ToolsFamily>
{
    readonly manifest: AdapterManifest;
    calls = 0;

    constructor(extra: Partial<AdapterManifest> = {}, private readonly result?: () => unknown)
    {
        super();
        this.manifest = manifest('test.tools', { requires: { 'pixi.mutation': 1 }, ...extra });
    }

    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<ToolsFamily, S>
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
