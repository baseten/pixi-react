import { describe, expect, it } from 'vitest';
import {
    CompatibilityError,
    compose,
    CORE_ABI,
    negotiate,
    PixiAdapter,
    ReactAdapter,
    validateManifest,
} from '../src/index.js';
import {
    FakePixiAdapter,
    type FakePixiTypes,
    FakeReactAdapter,
    manifest,
    PIXI_PROVIDES,
} from './fakes.js';

import type {
    AdapterManifest,
    Bind,
    Constructor,
    NodeDefinition,
    PixiSession,
    PixiTypes,
    ReactBindingFamily,
    RootTarget,
    Runtime,
} from '../src/index.js';

function caught(action: () => unknown): CompatibilityError
{
    try
    {
        action();
    }
    catch (error)
    {
        expect(error).toBeInstanceOf(CompatibilityError);

        return error as CompatibilityError;
    }

    throw new Error('expected a CompatibilityError');
}

const pixi = (overrides: Partial<AdapterManifest> = {}) => manifest({ id: 'test.pixi', provides: PIXI_PROVIDES, ...overrides });
const react = (overrides: Partial<AdapterManifest> = {}) => manifest({ id: 'test.react', requires: { 'pixi.mutation': 1 }, ...overrides });

describe('ABI validation', () =>
{
    it('rejects another ABI major before anything is allocated', () =>
    {
        const error = caught(() => validateManifest({ ...pixi(), abi: { major: 2, minor: 0 } }, 'pixi'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.adapterIds).toEqual(['test.pixi']);
        expect(error.expected).toEqual({ major: 1 });
        expect(error.actual).toEqual({ major: 2, minor: 0 });
        expect(error.message).toMatch(/implements ABI 2\.0, but this core implements ABI 1\.0/);
    });

    it('rejects an ABI minor newer than this core', () =>
    {
        const error = caught(() => validateManifest({ ...pixi(), abi: { major: 1, minor: CORE_ABI.minor + 1 } }, 'pixi'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.expected).toEqual({ major: 1, maxMinor: CORE_ABI.minor });
        expect(error.message).toMatch(/Upgrade the core package/);
    });

    it.each([
        ['no manifest', undefined, /no manifest object/],
        ['an empty id', { ...pixi(), id: '' }, /"id" must be a non-empty string/],
        ['a fractional capability version', { ...pixi(), provides: { 'pixi.mutation': 1.5 } }, /protocol version/],
        ['a string capability version', { ...pixi(), requires: { 'pixi.mutation': '1' } }, /protocol version/],
        ['an array capability map', { ...pixi(), provides: ['pixi.mutation'] }, /must be an object/],
        ['a missing certification pointer', { ...pixi(), certification: undefined }, /"certification" must be a string/],
    ])('rejects a malformed manifest with %s', (_name, value, message) =>
    {
        const error = caught(() => validateManifest(value, 'pixi'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.message).toMatch(message);
    });

    it('returns a frozen copy, so a later manifest mutation cannot change a composed runtime', () =>
    {
        const source = pixi();
        const validated = validateManifest(source, 'pixi');

        expect(validated).toEqual(source);
        expect(validated).not.toBe(source);
        expect(Object.isFrozen(validated.provides)).toBe(true);
    });
});

describe('capability negotiation', () =>
{
    it('names the capability, both adapters and the versions when a requirement is missing', () =>
    {
        const error = caught(() => negotiate(react({ requires: { 'pixi.visibility': 1 } }), pixi({ provides: {} })));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.capability).toBe('pixi.visibility');
        expect(error.adapterIds).toEqual(['test.react', 'test.pixi']);
        expect(error.expected).toEqual({ 'pixi.visibility': 1 });
        expect(error.actual).toEqual({ 'pixi.visibility': null });
        expect(error.message).toMatch(/requires capability "pixi.visibility" at protocol version 1, but it is not provided by Pixi adapter "test.pixi"/);
    });

    it('rejects a provided capability with another protocol version', () =>
    {
        const error = caught(() => negotiate(react({ requires: { 'pixi.ticker': 2 } }), pixi()));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.actual).toEqual({ 'pixi.ticker': 1 });
        expect(error.message).toMatch(/version 1 is provided/);
    });

    it('checks the Pixi adapter requirements against the React adapter', () =>
    {
        const error = caught(() => negotiate(react(), pixi({ requires: { 'react.scheduler': 1 } })));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.adapterIds).toEqual(['test.pixi', 'test.react']);
    });

    it('checks consumer requirements against either adapter', () =>
    {
        const ok = negotiate(react({ provides: { 'react.activity': 1 } }), pixi(), { 'react.activity': 1, 'pixi.ticker': 1 });

        expect(ok.capabilities).toMatchObject({ 'react.activity': 1, 'pixi.ticker': 1 });

        const error = caught(() => negotiate(react(), pixi(), { 'pixi.particles': 1 }));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.adapterIds).toEqual(['test.react', 'test.pixi']);
        expect(error.message).toMatch(/The renderer options require capability "pixi.particles"/);
    });

    it('ignores unknown optional capabilities', () =>
    {
        expect(() => negotiate(react(), pixi({ provides: { ...PIXI_PROVIDES, 'vendor.unknown': 7 } }))).not.toThrow();
    });

    it('rejects two owners of one capability with different versions', () =>
    {
        const error = caught(() => negotiate(react({ provides: { 'pixi.ticker': 2 } }), pixi()));

        expect(error.code).toBe('UNSUPPORTED_TUPLE');
        expect(error.capability).toBe('pixi.ticker');
    });
});

describe('compose', () =>
{
    it('validates before allocating: a rejected pair never creates a session or binds', () =>
    {
        const pixiAdapter = new FakePixiAdapter(
            { manifest: manifest({ id: 'test.pixi', provides: { 'pixi.mutation': 2 } }) },
        );
        const reactAdapter = new FakeReactAdapter();

        expect(() => compose({ react: reactAdapter, pixi: pixiAdapter })).toThrow(CompatibilityError);
        expect(pixiAdapter.log).toEqual([]);
        expect(reactAdapter.bound).toEqual([]);
    });

    it('detects adapters passed in the wrong roles', () =>
    {
        const error = caught(() => compose({
            react: new FakePixiAdapter() as unknown as FakeReactAdapter,
            pixi: new FakeReactAdapter() as unknown as FakePixiAdapter,
        }));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.message).toMatch(/does not implement bind\(\).*Was a Pixi adapter passed as `react`\?/);
    });

    it('wraps a failing environment check in UNSUPPORTED_TUPLE with the cause', () =>
    {
        class OldEnvironmentPixiAdapter extends FakePixiAdapter
        {
            checkEnvironment(): void
            {
                throw new Error('installed pixi.js 7.0.0 is outside 8.2.6');
            }
        }

        const error = caught(() => compose({ react: new FakeReactAdapter(), pixi: new OldEnvironmentPixiAdapter() }));

        expect(error.code).toBe('UNSUPPORTED_TUPLE');
        expect(error.adapterIds).toEqual(['test.pixi']);
        expect((error.cause as Error).message).toMatch(/outside 8\.2\.6/);
    });

    it('passes an adapter CompatibilityError from the environment check through unchanged', () =>
    {
        const original = new CompatibilityError('React 18.2 is not certified', {
            code: 'UNSUPPORTED_TUPLE',
            adapterIds: ['test.react'],
            expected: { react: '18.3.1' },
            actual: { react: '18.2.0' },
        });

        class StrictReactAdapter extends FakeReactAdapter
        {
            checkEnvironment(): void
            {
                throw original;
            }
        }

        expect(caught(() => compose({ react: new StrictReactAdapter(), pixi: new FakePixiAdapter() }))).toBe(original);
    });

    it.each([
        ['a typo', 'rejet'],
        ['a different case', 'Replace'],
        ['null', null],
        ['a boolean', true],
    ])('rejects a registry conflict policy that is %s with core.INVALID_OPTION, before allocating', (_name, policy) =>
    {
        const pixiAdapter = new FakePixiAdapter();
        const reactAdapter = new FakeReactAdapter();
        const error = caught(() => compose(
            { react: reactAdapter, pixi: pixiAdapter },
            { registryConflict: policy as never },
        ));

        expect(error.code).toBe('core.INVALID_OPTION');
        expect(error.message).toMatch(/registryConflict.*'reject' or 'replace'/);
        expect(error.expected).toEqual({ registryConflict: 'reject | replace' });
        expect(error.actual).toEqual({ registryConflict: String(policy) });
        expect(pixiAdapter.log).toEqual([]);
        expect(reactAdapter.bound).toEqual([]);
    });

    it.each([undefined, 'reject', 'replace'] as const)('accepts the registry conflict policy %s', (policy) =>
    {
        expect(() => compose({ react: new FakeReactAdapter(), pixi: new FakePixiAdapter() }, { registryConflict: policy }))
            .not.toThrow();
    });

    it('creates a new runtime with frozen negotiated capabilities on every call', () =>
    {
        const pixiAdapter = new FakePixiAdapter();
        const first = compose({ react: new FakeReactAdapter(), pixi: pixiAdapter });
        const second = compose({ react: new FakeReactAdapter(), pixi: pixiAdapter });

        expect(first).not.toBe(second);
        expect(first.id).not.toBe(second.id);
        expect(first.registry).not.toBe(second.registry);
        expect(first.capabilities).toEqual(PIXI_PROVIDES);
        expect(Object.isFrozen(first.capabilities)).toBe(true);
        expect(first.manifests.react.id).toBe('test.react');
    });
});

describe('third-party adapters (open subclasses, no closed name union)', () =>
{
    interface ParticleTypes extends PixiTypes
    {
        readonly node: { particleIndex: number };
        readonly app: { label: string };
    }

    class CommunityPixiAdapter extends PixiAdapter<ParticleTypes>
    {
        readonly manifest = manifest({ id: 'community.particles', provides: { 'pixi.mutation': 1, 'community.particles.batch': 3 } });

        createSession(_runtime: Runtime<ParticleTypes>, _target: RootTarget): PixiSession<ParticleTypes>
        {
            throw new Error('not used');
        }

        describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
        {
            return { name, ctor, capabilities: { 'community.particles.batch': 3 }, attach: { role: 'particle', accepts: [] } };
        }
    }

    interface Inspection<S extends PixiTypes>
    {
        inspect(): Runtime<S>;
    }

    interface InspectorFamily extends ReactBindingFamily
    {
        readonly type: Inspection<Extract<this['pixi'], PixiTypes>>;
    }

    class Inspector extends ReactAdapter<InspectorFamily>
    {
        readonly manifest = manifest({ id: 'community.inspector', requires: { 'community.particles.batch': 3 } });

        bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<InspectorFamily, S>
        {
            return { inspect: () => runtime } as Inspection<PixiTypes> as Bind<InspectorFamily, S>;
        }
    }

    it('composes adapters with arbitrary IDs and capabilities', () =>
    {
        const runtime = compose({ react: new Inspector(), pixi: new CommunityPixiAdapter() });

        expect(runtime.manifests.pixi.id).toBe('community.particles');
        expect(runtime.capabilities['community.particles.batch']).toBe(3);
    });

    it('accepts a structurally complete adapter that does not extend this core\'s class', () =>
    {
        // E.g. built against another installed copy of core: judged by what it implements, not by identity.
        const foreignPixi = {
            manifest: manifest({ id: 'community.foreign', provides: { 'pixi.mutation': 1 } }),
            createSession: () => undefined,
            describe: () => undefined,
            normalizeName: (name: string) => name,
        } as unknown as PixiAdapter<FakePixiTypes>;

        expect(() => compose({ react: new FakeReactAdapter(), pixi: foreignPixi })).not.toThrow();
    });

    it.each([
        ['without describe()', { describe: undefined }, /does not implement describe\(\)/],
        ['without createSession()', { createSession: undefined }, /does not implement createSession\(\)/],
        ['with an ABI 2 manifest', { manifest: { ...manifest({ id: 'community.broken' }), abi: { major: 2, minor: 0 } } }, /ABI 2\.0/],
        ['with a manifest getter that returns null', { manifest: null }, /no manifest object/],
    ])('rejects a malformed subclass %s with ABI_MISMATCH', (_name, patch, message) =>
    {
        class Malformed extends CommunityPixiAdapter
        {}

        const instance = new Malformed();

        for (const [key, value] of Object.entries(patch))
        {
            Object.defineProperty(instance, key, { value });
        }

        const error = caught(() => compose({ react: new Inspector(), pixi: instance }));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.message).toMatch(message);
    });
});

describe('CompatibilityError', () =>
{
    it('accepts built-in and dotted namespaced codes only', () =>
    {
        expect(new CompatibilityError('x', { code: 'community.shader.UNSUPPORTED_FORMAT', adapterIds: ['community.shader'] }).code)
            .toBe('community.shader.UNSUPPORTED_FORMAT');
        expect(() => new CompatibilityError('x', { code: 'CAPABILTY_MISSING' as 'ABI_MISMATCH', adapterIds: [] }))
            .toThrow(/Invalid CompatibilityError code/);
    });

    it('keeps the cause and freezes diagnostics', () =>
    {
        const cause = new Error('root cause');
        const error = new CompatibilityError('x', { code: 'INIT_FAILED', adapterIds: ['a'], cause, expected: { a: 1 } });

        expect(error.cause).toBe(cause);
        expect(error.name).toBe('CompatibilityError');
        expect(Object.isFrozen(error.expected)).toBe(true);
        expect(Object.isFrozen(error.adapterIds)).toBe(true);
        expect('cause' in new CompatibilityError('x', { code: 'INIT_FAILED', adapterIds: [] })).toBe(false);
    });
});
