import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { PACKAGE_VERSION } from '../../src/adapter';
import { bindPixi } from '../../src/bind';
import { checkSupportedVersion, compareVersions, parseVersion, PIXI7_PEER_RANGE } from '../../src/version';
import { cells } from './cells';
import { CompatibilityError } from '@pixi-react-provisional/core';

describe('installed version bounds', () =>
{
    it.each([
        ['7.4.2', true],
        ['7.4.3', true],
        ['7.4.9', true],
        ['7.4.1', false],
        ['7.3.3', false],
        ['7.5.0', false],
        ['6.5.10', false],
        ['8.2.6', false],
        ['8.22.0', false],
        ['7.4.3-rc.1', false],
        ['not a version', false],
    ])('pixi.js %s supported: %s', (version, supported) =>
    {
        expect(checkSupportedVersion(version).supported).toBe(supported);
    });

    it('names the Pixi 8 adapter when Pixi 8 is installed', () =>
    {
        expect(checkSupportedVersion('8.22.0')).toMatchObject({ supported: false, reason: expect.stringContaining('Pixi 8 adapter') });
    });

    it('orders pre-releases before their release', () =>
    {
        expect(compareVersions(parseVersion('7.4.3-rc')!, parseVersion('7.4.3')!)).toBeLessThan(0);
    });

    it('the package peer range is the adapter\'s range', () =>
    {
        expect(packageJson.peerDependencies['pixi.js']).toBe(PIXI7_PEER_RANGE);
    });

    it('the manifest reports the package version', () =>
    {
        expect(PACKAGE_VERSION).toBe(packageJson.version);
    });

    it.each(cells)('accepts the installed pixi.js $version', ({ pixi }) =>
    {
        expect(() => new (bindPixi(pixi).Pixi7Adapter)().checkEnvironment()).not.toThrow();
    });

    it('rejects a Pixi 8 installation with UNSUPPORTED_TUPLE naming both versions', () =>
    {
        const [{ pixi }] = cells;
        // A distinct Container identity makes bindPixi treat this as another Pixi module.
        const fake = { ...pixi, VERSION: '8.22.0', Container: class extends pixi.Container {} } as unknown as typeof pixi;
        let error: unknown;

        try
        {
            new (bindPixi(fake).Pixi7Adapter)().checkEnvironment();
        }
        catch (caught)
        {
            error = caught;
        }

        expect(error).toBeInstanceOf(CompatibilityError);
        expect(error).toMatchObject({
            code: 'UNSUPPORTED_TUPLE',
            adapterIds: ['pixi-7'],
            expected: { 'pixi.js': '>=7.4.2 <7.5.0' },
            actual: { 'pixi.js': '8.22.0' },
        });
    });

    it('a Pixi 8 module, which lacks Pixi 7 exports, still binds so that checkEnvironment rejects it clearly', () =>
    {
        const [{ pixi }] = cells;
        const { SimpleMesh: _mesh, SimpleRope: _rope, SimplePlane: _plane, FXAAFilter: _fxaa, ...rest } = pixi;
        const pixi8Like = { ...rest, VERSION: '8.2.6', Container: class extends pixi.Container {} } as unknown as typeof pixi;
        const adapter = new (bindPixi(pixi8Like).Pixi7Adapter)();

        expect(() => adapter.checkEnvironment()).toThrow(/pixi\.js 8\.2\.6 is Pixi 8; .*Compose the Pixi 8 adapter/);
    });

    it('a pixi.js 7 module missing a binding export is a broken binding', () =>
    {
        const [{ pixi }] = cells;
        const { SimpleRope: _rope, ...rest } = pixi;
        const broken = { ...rest, Container: class extends pixi.Container {} } as unknown as typeof pixi;

        expect(() => bindPixi(broken)).toThrow(/missing SimpleRope/);
    });

    it('records the bounds, the installed version and the Pixi 8-only capabilities in the manifest', () =>
    {
        for (const { pixi, version } of cells)
        {
            const { manifest } = new (bindPixi(pixi).Pixi7Adapter)();

            expect(manifest.pixi).toMatchObject({
                installed: version,
                peerRange: PIXI7_PEER_RANGE,
                bounds: { min: '7.4.2', maxExclusive: '7.5.0', excluded: [] },
                testedVersions: ['7.4.2', '7.4.3'],
            });
            expect(Object.keys(manifest.pixi.unsupported).sort()).toEqual(['pixi8.dom-container', 'pixi8.filter', 'pixi8.particle', 'pixi8.render-layer']);
            expect(manifest.packageVersion).toBe(packageJson.version);
        }
    });
});
