import { describe, expect, it } from 'vitest';
import manifest from '../package.json';
import { REACT18, React18Adapter, UNSUPPORTED_CAPABILITIES } from '../src/index';
import { PACKAGE_VERSION } from '../src/version';
import { CompatibilityError } from '@pixi-react-provisional/core';

function withReact(version: string): React18Adapter
{
    const instance = new React18Adapter() as React18Adapter & { reactVersion(): string };

    instance.reactVersion = () => version;

    return instance;
}

describe('React18Adapter', () =>
{
    it('declares an ABI 1 manifest, the Pixi capabilities it needs and its tested tuple', () =>
    {
        const { manifest: adapterManifest } = new React18Adapter();

        expect(adapterManifest.abi).toEqual({ major: 1, minor: 0 });
        expect(adapterManifest.id).toBe('react-18');
        expect(adapterManifest.packageVersion).toBe(manifest.version);
        expect(adapterManifest.requires).toEqual({
            'pixi.mutation': 1,
            'pixi.visibility': 1,
            'pixi.application': 1,
            'pixi.ticker': 1,
        });
        // React 18 has no Activity: the capability the 19.2+ epochs provide is absent here.
        expect(adapterManifest.provides).toEqual({});
        expect(adapterManifest.provides).not.toHaveProperty('react.activity');
        expect(adapterManifest.certification).toContain('react-reconciler 0.29.2');
        expect(adapterManifest.certification).toContain('its-fine 1.2.5');

        for (const version of REACT18.testedReact)
        {
            expect(adapterManifest.certification).toContain(version);
        }
    });

    it('declares the React 19 capabilities it lacks', () =>
    {
        expect(Object.keys(UNSUPPORTED_CAPABILITIES).sort()).toEqual(['react.activity', 'react.root-error-callbacks']);

        for (const capability of Object.keys(UNSUPPORTED_CAPABILITIES))
        {
            expect(new React18Adapter().manifest.provides).not.toHaveProperty(capability);
        }
    });

    it('accepts the React 18.3 line', () =>
    {
        expect(() => withReact('18.3.1').checkEnvironment()).not.toThrow();
        expect(() => withReact('18.3.0').checkEnvironment()).not.toThrow();
    });

    it('rejects React 18.2 and earlier, React 19 and later with UNSUPPORTED_TUPLE', () =>
    {
        for (const other of ['17.0.2', '18.0.0', '18.2.0', '19.0.0', '19.3.0', '20.0.0'])
        {
            let failure: unknown;

            try
            {
                withReact(other).checkEnvironment();
            }
            catch (error)
            {
                failure = error;
            }

            expect(failure, other).toBeInstanceOf(CompatibilityError);
            expect((failure as CompatibilityError).code).toBe('UNSUPPORTED_TUPLE');
            expect((failure as CompatibilityError).adapterIds).toEqual(['react-18']);
            expect((failure as CompatibilityError).actual).toEqual({ react: other });
            expect((failure as CompatibilityError).expected).toMatchObject({ react: '18.3.x', reconciler: '0.29.2' });

            if (other.startsWith('19.'))
            {
                expect((failure as Error).message).toContain('@pixi-react-provisional/react-19');
            }
        }
    });

    it('keeps PACKAGE_VERSION equal to package.json', () =>
    {
        expect(PACKAGE_VERSION).toBe(manifest.version);
    });

    it('declares a React peer range that is exactly the tested versions (D5)', () =>
    {
        expect(manifest.peerDependencies).toEqual({ react: REACT18.testedReact.join(' || ') });
    });

    it('pins the reconciler and bridge it depends on, exactly', () =>
    {
        expect(manifest.dependencies['react-reconciler']).toBe(REACT18.reconciler);
        expect(manifest.dependencies['its-fine']).toBe(REACT18.bridge);
    });
});
