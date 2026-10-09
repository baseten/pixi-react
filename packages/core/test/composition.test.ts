import { describe, expect, it } from 'vitest';
import {
    CompatibilityError,
    compose,
    CORE_ABI,
    FrameworkAdapter,
    negotiate,
    SceneAdapter,
    validateManifest,
} from '../src/index.js';
import {
    FakeFrameworkAdapter,
    FakeSceneAdapter,
    type FakeSceneTypes,
    manifest,
    SCENE_PROVIDES,
} from './fakes.js';

import type {
    AdapterManifest,
    Bind,
    BindingFamily,
    Constructor,
    NodeDefinition,
    RootTarget,
    Runtime,
    SceneSession,
    SceneTypes,
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

const scene = (overrides: Partial<AdapterManifest> = {}) => manifest({ id: 'test.scene', provides: SCENE_PROVIDES, ...overrides });
const framework = (overrides: Partial<AdapterManifest> = {}) => manifest({ id: 'test.framework', requires: { 'scene.mutation': 1 }, ...overrides });

describe('ABI validation', () =>
{
    it('rejects another ABI major before anything is allocated', () =>
    {
        const error = caught(() => validateManifest({ ...scene(), abi: { major: 2, minor: 0 } }, 'scene'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.adapterIds).toEqual(['test.scene']);
        expect(error.expected).toEqual({ major: 1 });
        expect(error.actual).toEqual({ major: 2, minor: 0 });
        expect(error.message).toMatch(/implements ABI 2\.0, but this core implements ABI 1\.0/);
    });

    it('rejects an ABI minor newer than this core', () =>
    {
        const error = caught(() => validateManifest({ ...scene(), abi: { major: 1, minor: CORE_ABI.minor + 1 } }, 'scene'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.expected).toEqual({ major: 1, maxMinor: CORE_ABI.minor });
        expect(error.message).toMatch(/Upgrade the core package/);
    });

    it.each([
        ['no manifest', undefined, /no manifest object/],
        ['an empty id', { ...scene(), id: '' }, /"id" must be a non-empty string/],
        ['a fractional capability version', { ...scene(), provides: { 'scene.mutation': 1.5 } }, /protocol version/],
        ['a string capability version', { ...scene(), requires: { 'scene.mutation': '1' } }, /protocol version/],
        ['an array capability map', { ...scene(), provides: ['scene.mutation'] }, /must be an object/],
        ['a missing certification pointer', { ...scene(), certification: undefined }, /"certification" must be a string/],
    ])('rejects a malformed manifest with %s', (_name, value, message) =>
    {
        const error = caught(() => validateManifest(value, 'scene'));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.message).toMatch(message);
    });

    it('returns a frozen copy, so a later manifest mutation cannot change a composed runtime', () =>
    {
        const source = scene();
        const validated = validateManifest(source, 'scene');

        expect(validated).toEqual(source);
        expect(validated).not.toBe(source);
        expect(Object.isFrozen(validated.provides)).toBe(true);
    });
});

describe('capability negotiation', () =>
{
    it('names the capability, both adapters and the versions when a requirement is missing', () =>
    {
        const error = caught(() => negotiate(framework({ requires: { 'scene.visibility': 1 } }), scene({ provides: {} })));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.capability).toBe('scene.visibility');
        expect(error.adapterIds).toEqual(['test.framework', 'test.scene']);
        expect(error.expected).toEqual({ 'scene.visibility': 1 });
        expect(error.actual).toEqual({ 'scene.visibility': null });
        expect(error.message).toMatch(/requires capability "scene.visibility" at protocol version 1, but it is not provided by scene adapter "test.scene"/);
    });

    it('rejects a provided capability with another protocol version', () =>
    {
        const error = caught(() => negotiate(framework({ requires: { 'scene.ticker': 2 } }), scene()));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.actual).toEqual({ 'scene.ticker': 1 });
        expect(error.message).toMatch(/version 1 is provided/);
    });

    it('checks the scene requirements against the framework', () =>
    {
        const error = caught(() => negotiate(framework(), scene({ requires: { 'framework.scheduler': 1 } })));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.adapterIds).toEqual(['test.scene', 'test.framework']);
    });

    it('checks consumer requirements against either adapter', () =>
    {
        const ok = negotiate(framework({ provides: { 'react.activity': 1 } }), scene(), { 'react.activity': 1, 'scene.ticker': 1 });

        expect(ok.capabilities).toMatchObject({ 'react.activity': 1, 'scene.ticker': 1 });

        const error = caught(() => negotiate(framework(), scene(), { 'scene.particles': 1 }));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.adapterIds).toEqual(['test.framework', 'test.scene']);
        expect(error.message).toMatch(/The renderer options require capability "scene.particles"/);
    });

    it('ignores unknown optional capabilities', () =>
    {
        expect(() => negotiate(framework(), scene({ provides: { ...SCENE_PROVIDES, 'vendor.unknown': 7 } }))).not.toThrow();
    });

    it('rejects two owners of one capability with different versions', () =>
    {
        const error = caught(() => negotiate(framework({ provides: { 'scene.ticker': 2 } }), scene()));

        expect(error.code).toBe('UNSUPPORTED_TUPLE');
        expect(error.capability).toBe('scene.ticker');
    });
});

describe('compose', () =>
{
    it('validates before allocating: a rejected pair never creates a session or binds', () =>
    {
        const sceneAdapter = new FakeSceneAdapter(
            { manifest: manifest({ id: 'test.scene', provides: { 'scene.mutation': 2 } }) },
        );
        const frameworkAdapter = new FakeFrameworkAdapter();

        expect(() => compose({ framework: frameworkAdapter, scene: sceneAdapter })).toThrow(CompatibilityError);
        expect(sceneAdapter.log).toEqual([]);
        expect(frameworkAdapter.bound).toEqual([]);
    });

    it('detects adapters passed in the wrong roles', () =>
    {
        const error = caught(() => compose({
            framework: new FakeSceneAdapter() as unknown as FakeFrameworkAdapter,
            scene: new FakeFrameworkAdapter() as unknown as FakeSceneAdapter,
        }));

        expect(error.code).toBe('ABI_MISMATCH');
        expect(error.message).toMatch(/does not implement bind\(\).*Was a scene adapter passed as the framework\?/);
    });

    it('wraps a failing environment check in UNSUPPORTED_TUPLE with the cause', () =>
    {
        class OldEnvironmentScene extends FakeSceneAdapter
        {
            checkEnvironment(): void
            {
                throw new Error('installed scene library 7.0.0 is outside 8.2.6');
            }
        }

        const error = caught(() => compose({ framework: new FakeFrameworkAdapter(), scene: new OldEnvironmentScene() }));

        expect(error.code).toBe('UNSUPPORTED_TUPLE');
        expect(error.adapterIds).toEqual(['test.scene']);
        expect((error.cause as Error).message).toMatch(/outside 8\.2\.6/);
    });

    it('passes an adapter CompatibilityError from the environment check through unchanged', () =>
    {
        const original = new CompatibilityError('React 18.2 is not certified', {
            code: 'UNSUPPORTED_TUPLE',
            adapterIds: ['test.framework'],
            expected: { react: '18.3.1' },
            actual: { react: '18.2.0' },
        });

        class StrictFramework extends FakeFrameworkAdapter
        {
            checkEnvironment(): void
            {
                throw original;
            }
        }

        expect(caught(() => compose({ framework: new StrictFramework(), scene: new FakeSceneAdapter() }))).toBe(original);
    });

    it.each([
        ['a typo', 'rejet'],
        ['a different case', 'Replace'],
        ['null', null],
        ['a boolean', true],
    ])('rejects a registry conflict policy that is %s with core.INVALID_OPTION, before allocating', (_name, policy) =>
    {
        const sceneAdapter = new FakeSceneAdapter();
        const frameworkAdapter = new FakeFrameworkAdapter();
        const error = caught(() => compose(
            { framework: frameworkAdapter, scene: sceneAdapter },
            { registryConflict: policy as never },
        ));

        expect(error.code).toBe('core.INVALID_OPTION');
        expect(error.message).toMatch(/registryConflict.*'reject' or 'replace'/);
        expect(error.expected).toEqual({ registryConflict: 'reject | replace' });
        expect(error.actual).toEqual({ registryConflict: String(policy) });
        expect(sceneAdapter.log).toEqual([]);
        expect(frameworkAdapter.bound).toEqual([]);
    });

    it.each([undefined, 'reject', 'replace'] as const)('accepts the registry conflict policy %s', (policy) =>
    {
        expect(() => compose({ framework: new FakeFrameworkAdapter(), scene: new FakeSceneAdapter() }, { registryConflict: policy }))
            .not.toThrow();
    });

    it('creates a new runtime with frozen negotiated capabilities on every call', () =>
    {
        const sceneAdapter = new FakeSceneAdapter();
        const first = compose({ framework: new FakeFrameworkAdapter(), scene: sceneAdapter });
        const second = compose({ framework: new FakeFrameworkAdapter(), scene: sceneAdapter });

        expect(first).not.toBe(second);
        expect(first.id).not.toBe(second.id);
        expect(first.registry).not.toBe(second.registry);
        expect(first.capabilities).toEqual(SCENE_PROVIDES);
        expect(Object.isFrozen(first.capabilities)).toBe(true);
        expect(first.manifests.framework.id).toBe('test.framework');
    });
});

describe('third-party adapters (open subclasses, no closed name union)', () =>
{
    interface ParticleTypes extends SceneTypes
    {
        readonly node: { particleIndex: number };
        readonly app: { label: string };
    }

    class CommunityScene extends SceneAdapter<ParticleTypes>
    {
        readonly manifest = manifest({ id: 'community.particles', provides: { 'scene.mutation': 1, 'community.particles.batch': 3 } });

        createSession(_runtime: Runtime<ParticleTypes>, _target: RootTarget): SceneSession<ParticleTypes>
        {
            throw new Error('not used');
        }

        describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
        {
            return { name, ctor, capabilities: { 'community.particles.batch': 3 }, attach: { role: 'particle', accepts: [] } };
        }
    }

    interface Inspection<S extends SceneTypes>
    {
        inspect(): Runtime<S>;
    }

    interface InspectorFamily extends BindingFamily
    {
        readonly type: Inspection<Extract<this['scene'], SceneTypes>>;
    }

    class Inspector extends FrameworkAdapter<InspectorFamily>
    {
        readonly manifest = manifest({ id: 'community.inspector', requires: { 'community.particles.batch': 3 } });

        bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<InspectorFamily, S>
        {
            return { inspect: () => runtime } as Inspection<SceneTypes> as Bind<InspectorFamily, S>;
        }
    }

    it('composes adapters with arbitrary IDs and capabilities', () =>
    {
        const runtime = compose({ framework: new Inspector(), scene: new CommunityScene() });

        expect(runtime.manifests.scene.id).toBe('community.particles');
        expect(runtime.capabilities['community.particles.batch']).toBe(3);
    });

    it('accepts a structurally complete adapter that does not extend this core\'s class', () =>
    {
        // E.g. built against another installed copy of core: judged by what it implements, not by identity.
        const foreignScene = {
            manifest: manifest({ id: 'community.foreign', provides: { 'scene.mutation': 1 } }),
            createSession: () => undefined,
            describe: () => undefined,
            normalizeName: (name: string) => name,
        } as unknown as SceneAdapter<FakeSceneTypes>;

        expect(() => compose({ framework: new FakeFrameworkAdapter(), scene: foreignScene })).not.toThrow();
    });

    it.each([
        ['without describe()', { describe: undefined }, /does not implement describe\(\)/],
        ['without createSession()', { createSession: undefined }, /does not implement createSession\(\)/],
        ['with an ABI 2 manifest', { manifest: { ...manifest({ id: 'community.broken' }), abi: { major: 2, minor: 0 } } }, /ABI 2\.0/],
        ['with a manifest getter that returns null', { manifest: null }, /no manifest object/],
    ])('rejects a malformed subclass %s with ABI_MISMATCH', (_name, patch, message) =>
    {
        class Malformed extends CommunityScene
        {}

        const instance = new Malformed();

        for (const [key, value] of Object.entries(patch))
        {
            Object.defineProperty(instance, key, { value });
        }

        const error = caught(() => compose({ framework: new Inspector(), scene: instance }));

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
