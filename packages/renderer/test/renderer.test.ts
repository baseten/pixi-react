import { describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../src/index.js';
import { Item, ItemSceneAdapter, manifest, ToolsFramework } from './fakes.js';
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
    it('returns the framework bindings for a new runtime, plus that runtime', async () =>
    {
        const scene = new ItemSceneAdapter();
        const renderer = createRenderer({ framework: new ToolsFramework(), scene });

        expect(renderer.runtimeId).toBe(renderer.runtime.id);
        expect(renderer.runtime.scene).toBe(scene);
        expect(renderer.runtime.manifests.framework.id).toBe('test.tools');
        expect(Object.getOwnPropertyDescriptor(renderer, 'runtime')).toMatchObject({ writable: false, configurable: false });
        await expect(renderer.mount(document.createElement('canvas'))).resolves.toEqual({ name: 'item-app' });
    });

    it('creates an isolated runtime per call: catalogs and roots are not shared', () =>
    {
        const scene = new ItemSceneAdapter();
        const first = createRenderer({ framework: new ToolsFramework(), scene });
        const second = createRenderer({ framework: new ToolsFramework(), scene });

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
        const scene = new ItemSceneAdapter();
        const abi = new ToolsFramework({ abi: { major: 2 as 1, minor: 0 } });
        const capability = new ToolsFramework({ requires: { 'scene.visibility': 1 } });

        expect(codeOf(() => createRenderer({ framework: abi, scene }))).toBe('ABI_MISMATCH');
        expect(codeOf(() => createRenderer({ framework: capability, scene }))).toBe('CAPABILITY_MISSING');
        expect(codeOf(() => createRenderer({ framework: new ToolsFramework(), scene }, { requiredCapabilities: { 'scene.ticker': 1 } })))
            .toBe('CAPABILITY_MISSING');
        expect(abi.calls + capability.calls).toBe(0);
        expect(scene.sessions).toEqual([]);
    });

    it('disposes the runtime and publishes nothing when bind throws', async () =>
    {
        const disposed = vi.fn();
        const failure = new Error('bind failed');
        const framework = new ToolsFramework({}, () =>
        {
            throw failure;
        });
        const scene = new ItemSceneAdapter();
        const spy = vi.spyOn(framework, 'bind').mockImplementation((runtime) =>
        {
            runtime.onDispose(disposed);
            throw failure;
        });

        expect(() => createRenderer({ framework, scene })).toThrow(failure);
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
            createRenderer({ framework: new ToolsFramework({}, result), scene: new ItemSceneAdapter() });
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
        const frozen = createRenderer({ framework: new ToolsFramework({}, () => Object.freeze({ tag: 'frozen' })), scene: new ItemSceneAdapter() });
        const fn = createRenderer({ framework: new ToolsFramework({}, () => () => 'called'), scene: new ItemSceneAdapter() });

        expect((frozen as unknown as { tag: string }).tag).toBe('frozen');
        expect(frozen.runtime.status).toBe('active');
        expect((fn as unknown as () => string)()).toBe('called');
        expect(fn.runtime.status).toBe('active');
    });

    it('rejects a missing adapter pair', () =>
    {
        expect(() => createRenderer(undefined as never)).toThrow(TypeError);
        expect(codeOf(() => createRenderer({ framework: new ToolsFramework(), scene: {} as never }))).toBe('ABI_MISMATCH');
        expect(codeOf(() => createRenderer({ framework: new ToolsFramework(), scene: { manifest: manifest('x') } as never })))
            .toBe('ABI_MISMATCH');
    });
});
