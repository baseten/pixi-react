/**
 * Production builds (issue 58). The sources read `process.env.NODE_ENV` as written, so a consumer's bundler drops the
 * development-only message text. Unbundled, the read happens at run time, so these tests switch it per test. In
 * production every check still throws the same error, with the same code and details; only the message is shorter.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CompatibilityError, compose, validateManifest } from '../src/index.js';
import { composeFake, FakeNode, FakePixiAdapter, FakeReactAdapter, manifest, PIXI_PROVIDES } from './fakes.js';

const env = process.env.NODE_ENV;

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

const HINT = 'A development build (NODE_ENV !== \'production\') gives the full message.';

describe('production builds', () =>
{
    afterEach(() =>
    {
        process.env.NODE_ENV = env;
    });

    it('keeps the ABI check, with a message built from the code and details', () =>
    {
        const pixi = { ...manifest({ id: 'test.pixi', provides: PIXI_PROVIDES }), abi: { major: 2, minor: 0 } };

        process.env.NODE_ENV = 'production';
        const production = caught(() => validateManifest(pixi, 'pixi'));

        process.env.NODE_ENV = 'development';
        const development = caught(() => validateManifest(pixi, 'pixi'));

        for (const error of [production, development])
        {
            expect(error.code).toBe('ABI_MISMATCH');
            expect(error.adapterIds).toEqual(['test.pixi']);
            expect(error.expected).toEqual({ major: 1 });
            expect(error.actual).toEqual({ major: 2, minor: 0 });
        }

        expect(production.message).toBe(`ABI_MISMATCH (test.pixi; expected {"major":1}; actual {"major":2,"minor":0}). ${HINT}`);
        expect(development.message).toMatch(/implements ABI 2\.0, but this core implements ABI 1\.0/);
    });

    it('keeps the capability negotiation', () =>
    {
        process.env.NODE_ENV = 'production';

        const error = caught(() => compose({ react: new FakeReactAdapter(), pixi: new FakePixiAdapter() }, {
            requiredCapabilities: { 'pixi.particles': 1 },
        }));

        expect(error.code).toBe('CAPABILITY_MISSING');
        expect(error.capability).toBe('pixi.particles');
        expect(error.message).toMatch(/^CAPABILITY_MISSING \(test\.react, test\.pixi; pixi\.particles; expected \{"pixi\.particles":1\}; actual \{"pixi\.particles":null\}\)\. /);
    });

    it('keeps registry conflicts, and the full message for an unregistered element', () =>
    {
        process.env.NODE_ENV = 'production';

        const { registry } = composeFake();

        registry.extend({ Node: FakeNode });

        const conflict = caught(() => registry.extend({ Node: class Other extends FakeNode {} }));

        expect(conflict.code).toBe('REGISTRY_CONFLICT');
        expect(conflict.message).toBe(`REGISTRY_CONFLICT (test.react, test.pixi; actual {"name":"Node"}). ${HINT}`);
        expect(caught(() => registry.resolve('Missing')).message).toMatch(/"Missing" is not registered.*extend\(\{ Missing \}\)/);
    });

    it('builds the message only for an empty one: an explicit message is kept as given', () =>
    {
        expect(new CompatibilityError('', { code: 'core.TARGET_LEASED', adapterIds: [] }).message)
            .toBe(`core.TARGET_LEASED. ${HINT}`);
        expect(new CompatibilityError('Custom.', { code: 'ROOT_DISPOSED', adapterIds: ['a'] }).message).toBe('Custom.');
    });
});
