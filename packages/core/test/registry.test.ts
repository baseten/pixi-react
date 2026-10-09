import { afterEach, describe, expect, it } from 'vitest';
import { CompatibilityError } from '../src/index.js';
import { composeFake, FakeFilter, FakeNode, FakeSceneAdapter } from './fakes.js';

function codeOf(action: () => unknown): string | undefined
{
    try
    {
        action();
    }
    catch (error)
    {
        return error instanceof CompatibilityError ? error.code : `not a CompatibilityError: ${String(error)}`;
    }

    return undefined;
}

describe('per-runtime registry', () =>
{
    const env = process.env.NODE_ENV;

    afterEach(() =>
    {
        process.env.NODE_ENV = env;
    });

    it('registers raw constructors and resolves validated, frozen definitions', () =>
    {
        const { registry } = composeFake();

        registry.extend({ Node: FakeNode, Filter: FakeFilter });

        const definition = registry.resolve('Node');

        expect(definition).toEqual({
            name: 'Node',
            ctor: FakeNode,
            capabilities: { 'scene.mutation': 1 },
            attach: { role: 'child', accepts: ['child', 'filter'] },
        });
        expect(Object.isFrozen(definition)).toBe(true);
        expect(registry.resolve('Filter').attach.role).toBe('filter');
    });

    it('is idempotent for the same name and constructor', () =>
    {
        const { registry } = composeFake();

        registry.extend({ Node: FakeNode });
        const first = registry.resolve('Node');

        registry.extend({ Node: FakeNode });
        expect(registry.resolve('Node')).toBe(first);
    });

    it.each(['production', 'development'])('throws REGISTRY_CONFLICT for another constructor (NODE_ENV=%s)', (mode) =>
    {
        process.env.NODE_ENV = mode;

        const { registry } = composeFake();

        class Other extends FakeNode
        {}

        registry.extend({ Node: FakeNode });
        expect(codeOf(() => registry.extend({ Node: Other }))).toBe('REGISTRY_CONFLICT');
        expect(registry.resolve('Node').ctor).toBe(FakeNode);
    });

    it('registers nothing from a catalog that contains a conflict', () =>
    {
        const { registry } = composeFake();

        class Other extends FakeNode
        {}

        registry.extend({ Node: FakeNode });
        expect(codeOf(() => registry.extend({ Fresh: Other, Node: Other }))).toBe('REGISTRY_CONFLICT');
        expect(registry.has('Fresh')).toBe(false);
    });

    it('lets the facade opt into upstream replacement (D4) with the replace policy', () =>
    {
        const { registry } = composeFake(new FakeSceneAdapter(), { registryConflict: 'replace' });

        class Other extends FakeNode
        {}

        registry.extend({ Node: FakeNode });
        registry.extend({ Node: Other });

        expect(registry.resolve('Node').ctor).toBe(Other);
        // The displaced constructor no longer claims the name.
        expect(registry.nameOf(FakeNode)).toMatch(/^component:/);
        // component(Ctor, name) is modular-only, so it never replaces, even under this policy.
        expect(codeOf(() => registry.define(FakeNode, 'Node'))).toBe('REGISTRY_CONFLICT');
    });

    it('throws UNKNOWN_ELEMENT naming the element and the fix, in every build', () =>
    {
        process.env.NODE_ENV = 'production';

        const { registry } = composeFake();
        let error: CompatibilityError | undefined;

        try
        {
            registry.resolve('Missing');
        }
        catch (caught)
        {
            error = caught as CompatibilityError;
        }

        expect(error?.code).toBe('UNKNOWN_ELEMENT');
        expect(error?.message).toMatch(/"Missing" is not registered.*extend\(\{ Missing \}\)/);
        expect(error?.adapterIds).toEqual(['test.framework', 'test.scene']);
    });

    it('normalizes names once through the scene adapter', () =>
    {
        const { registry } = composeFake(new FakeSceneAdapter({ prefix: 'fake' }));

        registry.extend({ fakeNode: FakeNode });

        expect(registry.resolve('Node').name).toBe('Node');
        expect(registry.resolve('fakeNode').ctor).toBe(FakeNode);
    });

    it('propagates UNSUPPORTED_NODE from describe and registers nothing', () =>
    {
        class Resource
        {}
        const { registry } = composeFake(new FakeSceneAdapter({ unsupported: [Resource] }));

        expect(codeOf(() => registry.extend({ Node: FakeNode, Resource }))).toBe('UNSUPPORTED_NODE');
        expect(registry.has('Node')).toBe(false);
    });

    it('rejects malformed descriptors on the register route', () =>
    {
        const { registry } = composeFake();

        expect(codeOf(() => registry.register({ name: '', ctor: FakeNode, capabilities: {}, attach: { role: 'child', accepts: [] } })))
            .toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => registry.register({ name: 'X', ctor: FakeNode, capabilities: { a: -1 }, attach: { role: 'child', accepts: [] } })))
            .toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => registry.register({ name: 'X', ctor: FakeNode, capabilities: {}, attach: { role: 'child' } as never })))
            .toBe('UNSUPPORTED_NODE');
    });

    describe('component(Ctor) naming', () =>
    {
        it('uses an explicit name, normalized like extend keys', () =>
        {
            const { registry } = composeFake(new FakeSceneAdapter({ prefix: 'fake' }));

            expect(registry.define(FakeNode, 'fakeWidget').name).toBe('Widget');
            expect(registry.resolve('Widget').ctor).toBe(FakeNode);
        });

        it('assigns a stable per-runtime id and never reads Ctor.name', () =>
        {
            const { registry } = composeFake();
            // Two different classes with the same (minified) name.
            const A = { X: class extends FakeNode {} }.X;
            const B = { X: class extends FakeNode {} }.X;

            expect(A.name).toBe(B.name);

            const a = registry.define(A);
            const b = registry.define(B);

            expect(a.name).not.toBe(b.name);
            expect(a.name).not.toContain('X');
            expect(registry.define(A)).toBe(a);
            expect(registry.nameOf(A)).toBe(a.name);
        });

        it('reuses an extend key for a constructor already registered that way', () =>
        {
            const { registry } = composeFake();

            registry.extend({ Sprite: FakeNode });

            expect(registry.nameOf(FakeNode)).toBe('Sprite');
            expect(registry.define(FakeNode).name).toBe('Sprite');
        });

        it('rejects an explicit name bound to another constructor', () =>
        {
            const { registry } = composeFake();

            registry.extend({ Sprite: FakeNode });
            expect(codeOf(() => registry.nameOf(FakeFilter, 'Sprite'))).toBe('REGISTRY_CONFLICT');
        });

        it('assigns ids per runtime', () =>
        {
            const first = composeFake().registry;
            const second = composeFake().registry;

            class Shared extends FakeNode
            {}

            first.define(FakeFilter);
            expect(first.define(Shared).name).toBe('component:2');
            expect(second.define(Shared).name).toBe('component:1');
        });
    });
});
