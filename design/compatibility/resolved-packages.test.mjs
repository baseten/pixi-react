import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvedPackagesFromLock, resolvedPackagesSha256 } from './resolved-packages.mjs';

const packages = {
    '': { name: 'audit-root', version: '1.0.0' },
    'node_modules/@scope/direct': { version: '1.2.3', integrity: 'sha512-direct', resolved: 'https://example.invalid/direct' },
    'node_modules/transitive': { version: '2.0.0', integrity: 'sha512-transitive' },
    'node_modules/@scope/direct/node_modules/transitive': { version: '1.0.0', integrity: 'sha512-nested' },
    'node_modules/@scope/direct/node_modules/@other/scoped': { version: '3.0.0', integrity: 'sha512-scoped' },
};

test('extracts the full lock map without truncating scoped or nested package paths', () =>
{
    const lock = { packages: structuredClone(packages) };
    const result = resolvedPackagesFromLock(lock);

    assert.deepEqual(result, {
        '@scope/direct': { version: '1.2.3', integrity: 'sha512-direct' },
        transitive: { version: '2.0.0', integrity: 'sha512-transitive' },
        '@scope/direct/node_modules/transitive': { version: '1.0.0', integrity: 'sha512-nested' },
        '@scope/direct/node_modules/@other/scoped': { version: '3.0.0', integrity: 'sha512-scoped' },
    });
    assert.deepEqual(lock.packages, packages);
});

test('canonicalizes package and property ordering without losing nested entries', () =>
{
    const result = resolvedPackagesFromLock({ packages });
    const reversed = Object.fromEntries(Object.entries(result).reverse().map(([name, pkg]) => [name, { integrity: pkg.integrity, version: pkg.version }]));

    assert.equal(resolvedPackagesSha256(result), resolvedPackagesSha256(reversed));
    for (const name of Object.keys(result))
    {
        const missing = structuredClone(result);

        delete missing[name];
        assert.notEqual(resolvedPackagesSha256(missing), resolvedPackagesSha256(result));
    }
});
