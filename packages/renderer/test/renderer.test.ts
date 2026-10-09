import { describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../src/index.js';
import { Item, ItemPixiAdapter, manifest, ToolsReactAdapter } from './fakes.js';
import { CompatibilityError } from '@pixi-react-provisional/core';

function codeOf(action: () => unknown): string | undefined
{
    try
    {
        action();
    }
    catch (error)
    {
        return error instanceof CompatibilityError ? error.code : String(error);
    }

    return undefined;
}

describe('createRenderer', () =>
{
    it('returns the React bindings for a new runtime, plus that runtime', async () =>
    {
        const pixi = new ItemPixiAdapter();
        const renderer = createRenderer({ react: new ToolsReactAdapter(), pixi });

        expect(renderer.runtimeId).toBe(renderer.runtime.id);
        expect(renderer.runtime.pixi).toBe(pixi);
        expect(renderer.runtime.manifests.react.id).toBe('test.tools');
        expect(Object.getOwnPropertyDescriptor(renderer, 'runtime')).toMatchObject({ writable: false, configurable: false });
        await expect(renderer.mount(document.createElement('canvas'))).resolves.toEqual({ name: 'item-app' });
    });

    it('creates an isolated runtime per call: catalogs and roots are not shared', () =>
    {
        const pixi = new ItemPixiAdapter();
        const first = createRenderer({ react: new ToolsReactAdapter(), pixi });
        const second = createRenderer({ react: new ToolsReactAdapter(), pixi });

        class Other extends Item
        {}

        first.extend({ Item });
        second.extend({ Item: Other });

        expect(first.runtime).not.toBe(second.runtime);
        expect(first.runtime.registry.resolve('Item').ctor).toBe(Item);
        expect(second.runtime.registry.resolve('Item').ctor).toBe(Other);

        const canvas = document.createElement('canvas');

        void first.mount(canvas);
        expect(second.runtime.rootFor(canvas)).toBeUndefined();
        expect(codeOf(() => second.runtime.createRoot(canvas))).toBe('core.TARGET_LEASED');
    });

    it('rejects an invalid ABI or capability set before binding or creating sessions', () =>
    {
        const pixi = new ItemPixiAdapter();
        const abi = new ToolsReactAdapter({ abi: { major: 2 as 1, minor: 0 } });
        const capability = new ToolsReactAdapter({ requires: { 'pixi.visibility': 1 } });

        expect(codeOf(() => createRenderer({ react: abi, pixi }))).toBe('ABI_MISMATCH');
        expect(codeOf(() => createRenderer({ react: capability, pixi }))).toBe('CAPABILITY_MISSING');
        expect(codeOf(() => createRenderer({ react: new ToolsReactAdapter(), pixi }, { requiredCapabilities: { 'pixi.ticker': 1 } })))
            .toBe('CAPABILITY_MISSING');
        expect(abi.calls + capability.calls).toBe(0);
        expect(pixi.sessions).toEqual([]);
    });

    it('disposes the runtime and publishes nothing when bind throws', async () =>
    {
        const disposed = vi.fn();
        const failure = new Error('bind failed');
        const react = new ToolsReactAdapter({}, () =>
        {
            throw failure;
        });
        const pixi = new ItemPixiAdapter();
        const spy = vi.spyOn(react, 'bind').mockImplementation((runtime) =>
        {
            runtime.onDispose(disposed);
            throw failure;
        });

        expect(() => createRenderer({ react, pixi })).toThrow(failure);
        await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
        expect((spy.mock.calls[0][0]).status).toBe('disposed');
    });

    it('disposes the runtime when attaching it to the bindings fails', async () =>
    {
        const disposed = vi.fn();
        const failure = new Error('defineProperty refused');
        const react = new ToolsReactAdapter({}, () => ({}));
        const spy = vi.spyOn(react, 'bind').mockImplementation((runtime) =>
        {
            runtime.onDispose(disposed);

            return new Proxy({}, {
                defineProperty()
                {
                    throw failure;
                },
            }) as ReturnType<typeof react.bind>;
        });

        expect(() => createRenderer({ react, pixi: new ItemPixiAdapter() })).toThrow(failure);
        await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
        expect((spy.mock.calls[0][0]).status).toBe('disposed');
    });

    it.each([
        ['null', () => null, /returned null from bind/],
        ['a string', () => 'bindings', /returned string from bind/],
        ['a reserved runtime key', () => ({ runtime: 1 }), /"runtime" key/],
    ])('rejects bindings that are %s with ABI_MISMATCH', (_name, result, message) =>
    {
        let error: unknown;

        try
        {
            createRenderer({ react: new ToolsReactAdapter({}, result), pixi: new ItemPixiAdapter() });
        }
        catch (caught)
        {
            error = caught;
        }

        expect(error).toBeInstanceOf(CompatibilityError);
        expect((error as CompatibilityError).code).toBe('ABI_MISMATCH');
        expect((error as Error).message).toMatch(message);
    });

    it('accepts frozen bindings and function bindings', () =>
    {
        const frozen = createRenderer({ react: new ToolsReactAdapter({}, () => Object.freeze({ tag: 'frozen' })), pixi: new ItemPixiAdapter() });
        const fn = createRenderer({ react: new ToolsReactAdapter({}, () => () => 'called'), pixi: new ItemPixiAdapter() });
        const frozenFn = createRenderer({
            react: new ToolsReactAdapter({}, () => Object.freeze(Object.assign(() => 'frozen call', { tag: 'fn' }))),
            pixi: new ItemPixiAdapter(),
        });

        expect((frozen as unknown as { tag: string }).tag).toBe('frozen');
        expect(frozen.runtime.status).toBe('active');
        expect((fn as unknown as () => string)()).toBe('called');
        expect(fn.runtime.status).toBe('active');
        expect((frozenFn as unknown as () => string)()).toBe('frozen call');
        expect((frozenFn as unknown as { tag: string }).tag).toBe('fn');
        expect(frozenFn.runtime.status).toBe('active');
    });

    it('calls methods of a frozen class instance with private fields on the original instance', () =>
    {
        class PrivateBindings
        {
            #count = 0;
            readonly tag = 'private';

            increment(): number
            {
                this.#count += 1;

                return this.#count;
            }

            get count(): number
            {
                return this.#count;
            }
        }

        const original = Object.freeze(new PrivateBindings());
        const renderer = createRenderer({ react: new ToolsReactAdapter({}, () => original), pixi: new ItemPixiAdapter() });
        const bindings = renderer as unknown as PrivateBindings;

        expect(bindings.increment()).toBe(1);
        expect(bindings.increment()).toBe(2);
        expect(bindings.count).toBe(2);
        expect(original.count).toBe(2);
        expect(bindings.tag).toBe('private');
        expect(bindings).toBeInstanceOf(PrivateBindings);
        // A detached method keeps its receiver, and reading it twice gives one function.
        const { increment } = bindings;

        expect(increment()).toBe(3);
        expect(bindings.increment).toBe(bindings.increment);
        expect(renderer.runtime.status).toBe('active');
        expect(renderer.runtime.manifests.react.id).toBe('test.tools');
    });

    it('writes the state of a non-extensible class instance to the original instance', () =>
    {
        class PublicBindings
        {
            count = 0;

            increment(): number
            {
                this.count += 1;

                return this.count;
            }
        }

        const original = Object.preventExtensions(new PublicBindings());
        const renderer = createRenderer({ react: new ToolsReactAdapter({}, () => original), pixi: new ItemPixiAdapter() });
        const bindings = renderer as unknown as PublicBindings;

        expect(bindings.increment()).toBe(1);
        expect(original.count).toBe(1);
        expect(bindings.count).toBe(1);
        bindings.count = 10;
        expect(original.count).toBe(10);
        expect(Object.keys(bindings)).toEqual(['count']);
        expect(renderer.runtime.status).toBe('active');
        expect(() =>
        {
            (renderer as { runtime: unknown }).runtime = null;
        }).toThrow(TypeError);
        expect(renderer.runtime.status).toBe('active');
    });

    it('rejects a missing adapter pair', () =>
    {
        expect(() => createRenderer(undefined as never)).toThrow(TypeError);
        expect(codeOf(() => createRenderer({ react: new ToolsReactAdapter(), pixi: {} as never }))).toBe('ABI_MISMATCH');
        expect(codeOf(() => createRenderer({ react: new ToolsReactAdapter(), pixi: { manifest: manifest('x') } as never })))
            .toBe('ABI_MISMATCH');
    });
});
