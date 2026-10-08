import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const seed = read('seed.json');
const evidence = read(seed.evidence);
const nonemptyObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

assert.equal(seed.schemaVersion, 1);
assert.deepEqual(seed.floors, { react: '18.3.1', 'pixi.js': '7.4.2', pixi8: '8.2.6' });
assert.deepEqual(seed.advertisedRanges, []);
assert.equal(new Set(seed.probes.map((p) => p.id)).size, seed.probes.length);
assert.equal(evidence.results.length, seed.probes.length);
for (const tuple of seed.probes)
{
    for (const version of Object.values(tuple.packages)) assert.match(version, /^\d+\.\d+\.\d+$/);
    const row = evidence.results.find((r) => r.id === tuple.id);

    assert.ok(row, tuple.id);
    assert.deepEqual(row.packages, tuple.packages);
    assert.equal(row.certification, 'not-certified');
    assert.equal(row.installExit, 0);
    assert.equal(row.typeExit, 0);
    for (const field of ['surfaces', 'resolvedPackages']) assert.ok(nonemptyObject(row[field]), `${row.id}: ${field}`);
    for (const [path, surface] of Object.entries(row.surfaces))
    {
        assert.ok((/^[a-f0-9]{64}$/).test(surface?.sha256), `${row.id}: surfaces.${path}.sha256`);
        if (path.endsWith('.d.ts')) assert.ok(strings(surface.declarations), `${row.id}: surfaces.${path}.declarations`);
    }
    for (const [name, version] of Object.entries(tuple.packages)) assert.equal(row.resolvedPackages[name]?.version, version, `${row.id}: resolvedPackages.${name}`);
    for (const [name, pkg] of Object.entries(row.resolvedPackages))
    {
        assert.ok(typeof pkg?.version === 'string' && pkg.version.length > 0, `${row.id}: resolvedPackages.${name}.version`);
        assert.ok(typeof pkg?.integrity === 'string' && pkg.integrity.length > 0, `${row.id}: resolvedPackages.${name}.integrity`);
    }
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
        }
        else
        {
            assert.equal(observation.version, tuple.packages['pixi.js'], `${row.id}: observation.version`);
            assert.ok(nonemptyObject(observation.capabilities), `${row.id}: observation.capabilities`);
            for (const key of ['asyncInit', 'particle', 'particleContainer', 'cacheAsTexture', 'renderLayer', 'domContainer', 'canvasRenderer']) assert.equal(typeof observation.capabilities[key], 'boolean', `${row.id}: observation.capabilities.${key}`);
            assert.ok(nonemptyObject(observation.observations), `${row.id}: observation.observations`);
        }
    }
    if (row.runtimeExit !== 0) assert.ok(seed.knownFailures.some((f) => f.tupleId === row.id && f.expectedRuntimeExit === row.runtimeExit && row.failure?.includes(f.signature)), row.id);
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
for (let minor = 2; minor <= 22; minor++) assert.ok(seed.probes.some((p) => p.packages['pixi.js']?.startsWith(`8.${minor}.`)));
for (let minor = 0; minor <= 3; minor++) assert.ok(seed.probes.some((p) => p.packages.react?.startsWith(`19.${minor}.`)));
process.stdout.write(`Validated ${seed.probes.length} exact tuples; known failures remain excluded from certification.\n`);
