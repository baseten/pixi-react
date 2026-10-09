import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { bindPixi } from '../../src/bind';
import { checkSupportedVersion, compareVersions, parseVersion, PIXI8_PEER_RANGE } from '../../src/version';
import { cells } from './cells';
import { CompatibilityError } from '@pixi-react-provisional/core';

describe('installed version bounds', () =>
{
    it.each([
        ['8.2.6', true],
        ['8.4.1', true],
        ['8.5.0', false],
        ['8.5.1', true],
        ['8.5.2', true],
        ['8.22.0', true],
        ['8.22.9', true],
        ['8.2.5', false],
        ['8.23.0', false],
        ['7.4.2', false],
        ['9.0.0', false],
        ['8.22.0-dev.2f01671', false],
        ['not a version', false],
    ])('pixi.js %s supported: %s', (version, supported) =>
    {
        expect(checkSupportedVersion(version).supported).toBe(supported);
    });

    it('orders pre-releases before their release', () =>
    {
        expect(compareVersions(parseVersion('8.10.0-dev')!, parseVersion('8.10.0')!)).toBeLessThan(0);
        expect(compareVersions(parseVersion('8.10.0')!, parseVersion('8.9.2')!)).toBeGreaterThan(0);
    });

    it('the package peer range is the adapter\'s range', () =>
    {
        expect(packageJson.peerDependencies['pixi.js']).toBe(PIXI8_PEER_RANGE);
    });

    it.each(cells)('accepts the installed pixi.js $version', ({ pixi }) =>
    {
        expect(() => new (bindPixi(pixi).Pixi8Adapter)().checkEnvironment()).not.toThrow();
    });

    it('rejects an excluded installation with UNSUPPORTED_TUPLE naming both versions', () =>
    {
        const [{ pixi }] = cells;
        // A distinct Container identity makes bindPixi treat this as another Pixi module.
        const fake = { ...pixi, VERSION: '8.5.0', Container: class extends pixi.Container {} } as unknown as typeof pixi;
        let error: unknown;

        try
        {
            new (bindPixi(fake).Pixi8Adapter)().checkEnvironment();
        }
        catch (caught)
        {
            error = caught;
        }

        expect(error).toBeInstanceOf(CompatibilityError);
        expect(error).toMatchObject({ code: 'UNSUPPORTED_TUPLE', adapterIds: ['pixi-8'], actual: { 'pixi.js': '8.5.0' } });
    });

    it('records the certified bounds and the installed version in the manifest', () =>
    {
        for (const { pixi, version } of cells)
        {
            const { manifest } = new (bindPixi(pixi).Pixi8Adapter)();

            expect(manifest.pixi).toMatchObject({
                installed: version,
                peerRange: PIXI8_PEER_RANGE,
                bounds: { min: '8.2.6', maxExclusive: '8.23.0', excluded: ['8.5.0'] },
                testedVersions: ['8.2.6', '8.9.2', '8.22.0'],
            });
            expect(manifest.packageVersion).toBe(packageJson.version);
        }
    });
});
