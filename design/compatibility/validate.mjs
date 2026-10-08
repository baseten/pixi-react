import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { declarationSeries } from './declaration-series.mjs';
import { processDiagnosticsSha256 } from './process-diagnostics.mjs';
import { reactAbiSha256 } from './react-abi.mjs';
import { resolvedPackagesSha256 } from './resolved-packages.mjs';
import { surfaceMapSha256 } from './surface-map.mjs';
import { validateHistoricalObservation } from './validate-historical.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const historical = process.argv[2] === '--historical';
const seed = read(historical ? 'historical-seed.json' : 'seed.json');
const evidence = read(seed.evidence);
const nonemptyObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

assert.equal(seed.schemaVersion, 1);
assert.deepEqual(seed.floors, { react: '18.3.1', 'pixi.js': '7.4.2', pixi8: '8.2.6' });
assert.deepEqual(seed.advertisedRanges, []);
assert.equal(new Set(seed.probes.map((p) => p.id)).size, seed.probes.length);
assert.equal(evidence.results.length, seed.probes.length);
assert.deepEqual(evidence.results.map((row) => row.id), seed.probes.map((tuple) => tuple.id), 'evidence tuple order');
let previousReact = [];
const previousPixi = new Map();

for (const tuple of seed.probes)
{
    for (const version of Object.values(tuple.packages)) assert.match(version, /^\d+\.\d+\.\d+$/);
    const row = evidence.results.find((r) => r.id === tuple.id);

    assert.ok(row, tuple.id);
    const series = declarationSeries(tuple);

    assert.equal(declarationSeries(row), series, `${row.id}: declarationSeries`);
    assert.deepEqual(row.packages, tuple.packages);
    assert.equal(row.certification, 'not-certified');
    assert.equal(row.installExit, 0);
    assert.equal(row.typeExit, 0);
    for (const check of tuple.additionalTypeChecks || [])
    {
        assert.equal(row.typeVariants?.[check.name]?.status, check.expectedExit, `${row.id}: ${check.name}`);
        const stdout = row.typeVariants[check.name].stdout;
        const signatures = check.signatures ?? [check.signature];

        assert.ok(signatures.every((signature) => typeof signature === 'string' && signature.length > 0), `${row.id}: ${check.name} signatures`);
        for (const signature of signatures) assert.ok(stdout.includes(signature), `${row.id}: ${check.name} diagnostic ${signature}`);
        if (check.signatures)
        {
            const diagnostics = stdout.split('\n').filter((line) => line.includes('error TS'));

            assert.equal(diagnostics.length, signatures.length, `${row.id}: ${check.name} unexpected diagnostics`);
            for (const line of diagnostics) assert.ok(signatures.some((signature) => line.endsWith(signature)), `${row.id}: ${check.name} unexpected diagnostic ${line}`);
        }
    }
    for (const field of ['surfaces', 'resolvedPackages']) assert.ok(nonemptyObject(row[field]), `${row.id}: ${field}`);
    for (const [path, surface] of Object.entries(row.surfaces))
    {
        assert.ok((/^[a-f0-9]{64}$/).test(surface?.sha256), `${row.id}: surfaces.${path}.sha256`);
        if (path.endsWith('.d.ts')) assert.ok(strings(surface.declarations), `${row.id}: surfaces.${path}.declarations`);
    }
    for (const [name, version] of Object.entries(tuple.packages))
    {
        assert.equal(row.resolvedPackages[name]?.version, version, `${row.id}: resolvedPackages.${name}`);
        if (seed.registry[name])
        {
            const integrity = seed.registry[name].selected?.[version]?.integrity;

            assert.ok(typeof integrity === 'string' && integrity.length > 0, `registry.${name}.${version}.integrity`);
            assert.equal(row.resolvedPackages[name].integrity, integrity, `${row.id}: resolvedPackages.${name}.integrity`);
        }
    }
    for (const [name, pkg] of Object.entries(row.resolvedPackages))
    {
        assert.ok(typeof pkg?.version === 'string' && pkg.version.length > 0, `${row.id}: resolvedPackages.${name}.version`);
        assert.ok(typeof pkg?.integrity === 'string' && pkg.integrity.length > 0, `${row.id}: resolvedPackages.${name}.integrity`);
    }
    assert.ok(typeof tuple.resolvedPackagesSha256 === 'string' && (/^[a-f0-9]{64}$/).test(tuple.resolvedPackagesSha256), `${row.id}: resolvedPackagesSha256`);
    assert.equal(resolvedPackagesSha256(row.resolvedPackages), tuple.resolvedPackagesSha256, `${row.id}: resolvedPackages complete lock digest`);
    if (row.runtimeExit === 0)
    {
        assert.ok(nonemptyObject(row.observation), `${row.id}: observation`);
        const observation = row.observation;

        if (tuple.kind === 'react')
        {
            assert.equal(observation.react, tuple.packages.react, `${row.id}: observation.react`);
            assert.equal(observation.reconciler, tuple.packages['react-reconciler'], `${row.id}: observation.reconciler`);
            for (const field of ['hostKeys', 'exports']) assert.ok(strings(observation[field]) && observation[field].length > 0, `${row.id}: observation.${field}`);
            assert.ok(nonemptyObject(observation.features), `${row.id}: observation.features`);
            const features = observation.features;
            const [major, minor] = tuple.packages.react.split('.').map(Number);
            const reconcilerVersion = tuple.packages['react-reconciler'];
            const expectedPeers = seed.registry['react-reconciler'].selected[reconcilerVersion].peerDependencies;

            assert.ok(nonemptyObject(expectedPeers), `registry.react-reconciler.${reconcilerVersion}.peerDependencies`);
            assert.deepEqual(observation.peers, expectedPeers, `${row.id}: observation.peers`);
            // Published React 19.2/19.3 builds omit the tagged source's eleventh parameter.
            assert.equal(observation.createContainerArity, { 17: 4, 18: 8, 19: 10 }[major], `${row.id}: observation.createContainerArity`);

            assert.equal(features.contextBridge, 'mount-update-unmount', `${row.id}: observation.features.contextBridge`);
            assert.equal(features.activity, major === 19 && minor >= 2 ? 'hide-restore' : 'not-available', `${row.id}: observation.features.activity`);
            if (major === 19 && minor >= 3)
            {
                assert.ok(nonemptyObject(features.fragmentRef), `${row.id}: observation.features.fragmentRef`);
                assert.equal(features.fragmentRef.status, 'missing-host-capability', `${row.id}: observation.features.fragmentRef.status`);
                assert.ok(strings(features.fragmentRef.errors) && features.fragmentRef.errors.length === 1, `${row.id}: observation.features.fragmentRef.errors`);
            }
            else assert.equal(features.fragmentRef, 'not-available', `${row.id}: observation.features.fragmentRef`);
        }
        else
        {
            assert.equal(observation.version, tuple.packages['pixi.js'], `${row.id}: observation.version`);
            assert.ok(nonemptyObject(observation.capabilities), `${row.id}: observation.capabilities`);
            const [major, minor] = tuple.packages['pixi.js'].split('.').map(Number);
            const v8 = major === 8;
            const expectedCapabilities = { asyncInit: v8, particle: v8 && minor >= 5, particleContainer: major === 6 || major === 7 || (v8 && minor >= 5), cacheAsTexture: v8 && minor >= 6, renderLayer: v8 && minor >= 7, domContainer: v8 && minor >= 9, canvasRenderer: v8 && minor >= 16 };

            for (const [key, expected] of Object.entries(expectedCapabilities)) assert.equal(observation.capabilities[key], expected, `${row.id}: observation.capabilities.${key}`);
            assert.ok(nonemptyObject(observation.observations), `${row.id}: observation.observations`);
            const observed = observation.observations;

            if (major !== 6) assert.equal(observed.visibleChanged, v8 && minor >= 17 ? 1 : 0, `${row.id}: observation.observations.visibleChanged`);
            // Version boundaries keep edited capability flags from hiding required observations.
            if (major === 8 && minor >= 5)
            {
                assert.equal(observed.particleIsContainer, false, `${row.id}: observation.observations.particleIsContainer`);
                assert.equal(observed.removeParticlesDefaultCount, minor >= 10 ? 1 : 0, `${row.id}: observation.observations.removeParticlesDefaultCount`);
            }
            if (major === 8)
            {
                assert.deepEqual(observed.zeroScale, minor >= 19 ? [0, 0] : [1, 1], `${row.id}: observation.observations.zeroScale`);
                assert.ok(nonemptyObject(observed.mirroredTransform), `${row.id}: observation.observations.mirroredTransform`);
                const expectedTransform = minor >= 21 ? { rotation: -Math.PI / 6, scaleX: -1, skewX: 0 } : { rotation: 0, scaleX: 1, skewX: Math.PI / 6 };

                for (const [key, expected] of Object.entries(expectedTransform))
                {
                    const value = observed.mirroredTransform[key];

                    assert.ok(Number.isFinite(value), `${row.id}: observation.observations.mirroredTransform.${key}`);
                    // Matrix decomposition may round computed angles by a few floating-point bits.
                    if (key === 'scaleX' || expected === 0) assert.equal(value, expected, `${row.id}: observation.observations.mirroredTransform.${key}`);
                    else assert.ok(Math.abs(value - expected) <= 1e-12, `${row.id}: observation.observations.mirroredTransform.${key}`);
                }
            }
        }
    }
    if (historical) validateHistoricalObservation(row, tuple);
    if (row.runtimeExit !== 0)
    {
        const diagnostics = row.runtimeDiagnostics;

        assert.ok(nonemptyObject(diagnostics), `${row.id}: runtimeDiagnostics`);
        assert.equal(diagnostics.status, row.runtimeExit, `${row.id}: runtimeDiagnostics.status`);
        assert.ok(Object.hasOwn(diagnostics, 'signal') && (diagnostics.signal === null || (typeof diagnostics.signal === 'string' && diagnostics.signal.length > 0)), `${row.id}: runtimeDiagnostics.signal`);
        for (const field of ['stdout', 'stderr']) assert.ok(Object.hasOwn(diagnostics, field) && (diagnostics[field] === null || typeof diagnostics[field] === 'string'), `${row.id}: runtimeDiagnostics.${field}`);
        if (Object.hasOwn(diagnostics, 'error')) assert.ok(typeof diagnostics.error === 'string' && diagnostics.error.length > 0, `${row.id}: runtimeDiagnostics.error`);
        if (row.runtimeExit === null) assert.ok(diagnostics.signal || diagnostics.error, `${row.id}: runtimeDiagnostics.termination`);
        assert.ok(typeof tuple.runtimeDiagnosticsSha256 === 'string' && (/^[a-f0-9]{64}$/).test(tuple.runtimeDiagnosticsSha256), `${row.id}: runtimeDiagnostics pinned digest`);
        assert.equal(processDiagnosticsSha256(diagnostics), tuple.runtimeDiagnosticsSha256, `${row.id}: runtimeDiagnostics captured digest`);
        assert.equal(row.failure, (diagnostics.stderr || '').split('\n').slice(0, 12).join('\n'), `${row.id}: runtimeDiagnostics failure excerpt`);
        assert.ok(seed.knownFailures.some((f) => f.tupleId === row.id && f.expectedRuntimeExit === row.runtimeExit && row.failure?.includes(f.signature)), row.id);
    }
    if (tuple.kind === 'react')
    {
        const keys = row.observation?.hostKeys || [];
        const previousKeys = previousReact;
        const expected = { added: keys.filter((key) => !previousKeys.includes(key)), removed: previousKeys.filter((key) => !keys.includes(key)) };

        assert.deepEqual(row.hostDelta, expected, `${row.id}: hostDelta`);
        previousReact = keys;
        assert.ok(typeof tuple.reactAbiSha256 === 'string' && (/^[a-f0-9]{64}$/).test(tuple.reactAbiSha256), `${row.id}: React ABI digest`);
        assert.equal(reactAbiSha256(row.observation), tuple.reactAbiSha256, `${row.id}: React ABI captured contract`);
    }
    else
    {
        const previousSurfaces = previousPixi.get(series) || {};
        const paths = new Set([...Object.keys(row.surfaces), ...Object.keys(previousSurfaces)]);
        const expected = Object.fromEntries([...paths].map((path) => [path, { before: previousSurfaces[path]?.declarations ?? null, after: row.surfaces[path]?.declarations ?? null }]).filter(([, delta]) => JSON.stringify(delta.before) !== JSON.stringify(delta.after)));

        assert.deepEqual(row.declarationDelta, expected, `${row.id}: declarationDelta`);
        previousPixi.set(series, row.surfaces);
    }
    assert.ok(typeof tuple.surfacesSha256 === 'string' && (/^[a-f0-9]{64}$/).test(tuple.surfacesSha256), `${row.id}: surfacesSha256`);
    assert.equal(surfaceMapSha256(row.surfaces), tuple.surfacesSha256, `${row.id}: surfaces captured map digest`);
}
for (const failure of seed.knownFailures)
{
    const row = evidence.results.find((r) => r.id === failure.tupleId);

    assert.ok(row, failure.id);
    assert.ok(Number.isInteger(failure.expectedRuntimeExit), failure.id);
    assert.equal(row.runtimeExit, failure.expectedRuntimeExit, failure.id);
    if (failure.expectedRuntimeExit === 0)
    {
        assert.ok(Array.isArray(failure.observationPath) && failure.observationPath.length > 0, failure.id);
        const observation = failure.observationPath.reduce((value, key) => value?.[key], row.observation);

        assert.equal(observation?.status, failure.classification, failure.id);
        assert.ok(observation?.errors?.some((error) => error.includes(failure.signature)), failure.id);
    }
    else
    {
        assert.ok(row.failure?.includes(failure.signature), failure.id);
    }
}
if (historical)
{
    for (const version of ['17.0.0', '17.0.1', '17.0.2'])
    {
        for (const bridge of ['1.2.0', '1.2.2'])
        { assert.ok(seed.probes.some((p) => p.packages.react === version && p.packages['its-fine'] === bridge)); }
    }
    for (const version of ['6.0.0', '6.0.4', '6.1.0', '6.1.3', '6.2.0', '6.2.2', '6.3.0', '6.3.2', '6.4.0', '6.4.2', '6.5.0', '6.5.1', '6.5.10'])
    { assert.ok(seed.probes.some((p) => p.packages['pixi.js'] === version)); }
}
else
{
    for (let minor = 2; minor <= 22; minor++) assert.ok(seed.probes.some((p) => p.packages['pixi.js']?.startsWith(`8.${minor}.`)));
    for (let minor = 0; minor <= 3; minor++) assert.ok(seed.probes.some((p) => p.packages.react?.startsWith(`19.${minor}.`)));
}
process.stdout.write(`Validated ${seed.probes.length} exact tuples; known failures remain excluded from certification.\n`);
