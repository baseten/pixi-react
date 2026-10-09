import { describe, expect, it } from 'vitest';
import manifest from '../package.json';
import { PACKAGE_VERSION } from '../src/shared/version';
import { EPOCHS } from './epochs';
import { CompatibilityError } from '@pixi-react-provisional/core';

function withReact<T extends new() => object>(Adapter: T, version: string): InstanceType<T>
{
    const instance = new Adapter() as InstanceType<T> & { reactVersion(): string };

    instance.reactVersion = () => version;

    return instance;
}

describe('epoch adapters', () =>
{
    for (const { epoch, entry } of EPOCHS)
    {
        describe(epoch, () =>
        {
            const Adapter = entry.React19Adapter;

            it('exports the epoch class as React19Adapter and as its own name, over the shared base', () =>
            {
                const named = (entry as Record<string, unknown>)[`React${epoch.replace('.', '')}Adapter`];

                expect(named).toBe(Adapter);
                expect(new Adapter()).toBeInstanceOf(entry.React19AdapterBase);
            });

            it('declares an ABI 1 manifest with its epoch, the Pixi capabilities it needs and its tested tuple', () =>
            {
                const { manifest: adapterManifest } = new Adapter();

                expect(adapterManifest.abi).toEqual({ major: 1, minor: 0 });
                expect(adapterManifest.id).toBe(`react-19/${epoch}`);
                expect(adapterManifest.packageVersion).toBe(manifest.version);
                expect(adapterManifest.requires).toEqual({
                    'pixi.mutation': 1,
                    'pixi.visibility': 1,
                    'pixi.application': 1,
                    'pixi.ticker': 1,
                });
                expect(adapterManifest.provides).toEqual(epoch >= '19.2' ? { 'react.activity': 1 } : {});

                for (const version of entry.EPOCH.testedReact)
                {
                    expect(adapterManifest.certification).toContain(version);
                }
            });

            it('accepts any patch of its own React minor', () =>
            {
                expect(() => withReact(Adapter, `${epoch}.0`).checkEnvironment()).not.toThrow();
                expect(() => withReact(Adapter, `${epoch}.42`).checkEnvironment()).not.toThrow();
            });

            it('rejects another React minor (and React 18) with UNSUPPORTED_TUPLE naming the right subpath', () =>
            {
                for (const other of ['18.3.1', '19.0.0', '19.1.0', '19.2.0', '19.3.0', '19.4.0', '20.0.0'])
                {
                    if (other.startsWith(`${epoch}.`))
                    {
                        continue;
                    }

                    let failure: unknown;

                    try
                    {
                        withReact(Adapter, other).checkEnvironment();
                    }
                    catch (error)
                    {
                        failure = error;
                    }

                    expect(failure, other).toBeInstanceOf(CompatibilityError);
                    expect((failure as CompatibilityError).code).toBe('UNSUPPORTED_TUPLE');
                    expect((failure as CompatibilityError).adapterIds).toEqual([`react-19/${epoch}`]);
                    expect((failure as CompatibilityError).actual).toEqual({ react: other });
                    expect((failure as Error).message).toContain(`react-19/${other.split('.').slice(0, 2).join('.')}`);
                }
            });
        });
    }

    it('keeps PACKAGE_VERSION equal to package.json', () =>
    {
        expect(PACKAGE_VERSION).toBe(manifest.version);
    });

    it('declares a React peer range that is exactly the union of the tested versions (D5)', () =>
    {
        const tested = EPOCHS.flatMap(({ entry }) => entry.EPOCH.testedReact);

        expect(manifest.peerDependencies).toEqual({ react: tested.join(' || ') });
    });
});
