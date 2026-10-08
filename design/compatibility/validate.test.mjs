import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function validate(t, mutate)
{
    const root = mkdtempSync(join(tmpdir(), 'audit-validation-test-'));

    t.after(() => rmSync(root, { recursive: true, force: true }));
    const seed = JSON.parse(readFileSync(new URL('seed.json', import.meta.url)));
    const evidence = JSON.parse(readFileSync(new URL('evidence.json', import.meta.url)));

    mutate?.(evidence, seed);
    copyFileSync(new URL('declaration-series.mjs', import.meta.url), join(root, 'declaration-series.mjs'));
    copyFileSync(new URL('validate.mjs', import.meta.url), join(root, 'validate.mjs'));
    copyFileSync(new URL('validate-historical.mjs', import.meta.url), join(root, 'validate-historical.mjs'));
    writeFileSync(join(root, 'seed.json'), JSON.stringify(seed));
    writeFileSync(join(root, seed.evidence), JSON.stringify(evidence));

    return spawnSync(process.execPath, [join(root, 'validate.mjs')], { encoding: 'utf8' });
}

test('accepts the retained evidence for all 44 exact tuples', (t) =>
{
    const result = validate(t);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 44 exact tuples/);
});

const cases = [
    ['a successful exit for the Pixi regression', (e) => { e.results.find((r) => r.id === 'pixi-8.5.0').runtimeExit = 0; }],
    ['a missing React fragment observation', (e) => { delete e.results.find((r) => r.id === 'react-19.3.0').observation.features.fragmentRef; }],
    ['a rendered React fragment', (e) => { e.results.find((r) => r.id === 'react-19.3.0').observation.features.fragmentRef = 'rendered'; }],
    ['a different React fragment error', (e) => { e.results.find((r) => r.id === 'react-19.3.0').observation.features.fragmentRef.errors = ['unrelated error']; }],
    ['a wrong React fragment status', (e) => { e.results.find((r) => r.id === 'react-19.3.0').observation.features.fragmentRef.status = 'rendered'; }],
    ['an unregistered known failure tuple', (e, s) => { s.knownFailures[0].tupleId = 'absent'; }],
    ['an unrelated runtime error', (e) =>
    {
        const row = e.results.find((r) => r.id === 'pixi-8.5.0');

        row.failure = 'unrelated error';
    }],
];

for (const [name, mutate] of cases)
{
    test(`rejects ${name}`, (t) =>
    {
        const result = validate(t, mutate);

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /AssertionError/);
    });
}

for (const id of ['pixi-8.10.0', 'react-19.0.0'])
{
    for (const field of ['observation', 'surfaces', 'resolvedPackages'])
    {
        for (const value of [undefined, null, {}, []])
        {
            test(`rejects ${id} with ${field} replaced by ${JSON.stringify(value)}`, (t) =>
            {
                const result = validate(t, (evidence) =>
                {
                    const row = evidence.results.find((r) => r.id === id);

                    assert.equal(row.runtimeExit, 0);
                    if (value === undefined) delete row[field];
                    else row[field] = value;
                });

                assert.equal(result.status, 1, result.stdout);
                assert.match(result.stderr, new RegExp(`${id}.*${field}`));
            });
        }
    }
}

for (const [field, mutate] of [
    ['observation', (row) => { delete row.observation.capabilities; }],
    ['surfaces', (row) => { delete Object.values(row.surfaces)[0].sha256; }],
    ['resolvedPackages', (row) => { delete row.resolvedPackages['pixi.js']; }],
])
{
    test(`rejects incomplete nested ${field} evidence`, (t) =>
    {
        const result = validate(t, (evidence) => mutate(evidence.results.find((r) => r.id === 'pixi-8.10.0')));

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, new RegExp(`pixi-8.10.0.*${field}`));
    });
}

for (const field of ['surfaces', 'resolvedPackages'])
{
    for (const value of [undefined, null, {}, [], 'invalid'])
    {
        test(`rejects known runtime failure with ${field} replaced by ${JSON.stringify(value)}`, (t) =>
        {
            const result = validate(t, (evidence) =>
            {
                const row = evidence.results.find((r) => r.id === 'pixi-8.5.0');

                assert.equal(row.installExit, 0);
                assert.equal(row.typeExit, 0);
                assert.equal(row.runtimeExit, 1);
                assert.equal(row.observation, null);
                if (value === undefined) delete row[field];
                else row[field] = value;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.match(result.stderr, new RegExp(`pixi-8.5.0.*${field}`));
        });
    }
}

for (const [name, field, mutate] of [
    ['missing hash', 'surfaces', (row) => { delete Object.values(row.surfaces)[0].sha256; }],
    ['non-string declaration', 'surfaces', (row) => { Object.values(row.surfaces)[0].declarations = ['valid', null]; }],
    ['missing direct package', 'resolvedPackages', (row) => { delete row.resolvedPackages['pixi.js']; }],
    ['wrong direct version', 'resolvedPackages', (row) => { row.resolvedPackages['pixi.js'].version = '8.4.0'; }],
    ['missing integrity', 'resolvedPackages', (row) => { delete row.resolvedPackages['pixi.js'].integrity; }],
])
{
    test(`rejects malformed nested ${field} on a known runtime failure: ${name}`, (t) =>
    {
        const result = validate(t, (evidence) =>
        {
            const row = evidence.results.find((r) => r.id === 'pixi-8.5.0');

            assert.equal(row.runtimeExit, 1);
            mutate(row);
        });

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, new RegExp(`pixi-8.5.0.*${field}`));
    });
}

for (const [id, name] of [
    ['pixi-8.22.0', 'pixi.js'],
    ['pixi-8.5.0', 'pixi.js'],
    ['react-19.0.0', 'react'],
    ['react-19.0.0', 'react-reconciler'],
    ['react-19.0.0', '@types/react'],
    ['react-19.0.0', 'its-fine'],
])
{
    test(`rejects a mismatched registry integrity for ${id}: ${name}`, (t) =>
    {
        const result = validate(t, (evidence, seed) =>
        {
            const row = evidence.results.find((r) => r.id === id);
            const expected = seed.registry[name].selected[row.packages[name]].integrity;

            assert.equal(row.resolvedPackages[name].integrity, expected);
            row.resolvedPackages[name].integrity = 'sha512-tampered';
            assert.notEqual(row.resolvedPackages[name].integrity, expected);
        });

        assert.equal(result.status, 1, result.stdout);
        assert.ok(result.stderr.includes(`${id}: resolvedPackages.${name}.integrity`), result.stderr);
    });
}

for (const value of [undefined, null, ''])
{
    test(`rejects missing registry integrity metadata: ${JSON.stringify(value)}`, (t) =>
    {
        const result = validate(t, (evidence, seed) =>
        {
            const metadata = seed.registry['pixi.js'].selected['8.22.0'];

            if (value === undefined) delete metadata.integrity;
            else metadata.integrity = value;
        });

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /registry.*pixi.js.*8.22.0.*integrity/);
    });
}

for (const [id, field] of [
    ['react-18.3.1', 'hostDelta'],
    ['react-19.0.0', 'hostDelta'],
    ['pixi-7.4.2', 'declarationDelta'],
    ['pixi-8.2.6', 'declarationDelta'],
    ['pixi-8.5.0', 'declarationDelta'],
])
{
    for (const value of [undefined, null, {}, []])
    {
        test(`rejects ${id} with ${field} replaced by ${JSON.stringify(value)}`, (t) =>
        {
            const result = validate(t, (evidence) =>
            {
                const row = evidence.results.find((r) => r.id === id);

                assert.ok(Object.keys(row[field]).length > 0);
                if (value === undefined) delete row[field];
                else row[field] = value;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`${id}: ${field}`), result.stderr);
        });
    }
}

for (const [name, id, field, mutate] of [
    ['missing host addition', 'react-19.0.0', 'hostDelta', (row) =>
    {
        assert.ok(row.hostDelta.added.length > 0);
        row.hostDelta.added.pop();
    }],
    ['missing host removal', 'react-19.0.0', 'hostDelta', (row) =>
    {
        assert.ok(row.hostDelta.removed.length > 0);
        row.hostDelta.removed.pop();
    }],
    ['spurious host change', 'react-19.0.8', 'hostDelta', (row) =>
    {
        assert.deepEqual(row.hostDelta, { added: [], removed: [] });
        row.hostDelta.added.push('inventedHostKey');
    }],
    ['host keys disagree with delta', 'react-19.0.8', 'hostDelta', (row) =>
    {
        assert.ok(row.observation.hostKeys.length > 1);
        row.observation.hostKeys.pop();
    }],
    ['missing removed declaration', 'pixi-8.2.6', 'declarationDelta', (row) =>
    {
        const path = '@pixi/app/lib/Application.d.ts';

        assert.equal(row.declarationDelta[path].after, null);
        delete row.declarationDelta[path];
    }],
    ['wrong declaration before', 'pixi-8.10.0', 'declarationDelta', (row) =>
    {
        const delta = row.declarationDelta['pixi.js/lib/scene/text/Text.d.ts'];

        assert.ok(Array.isArray(delta.before));
        delta.before = ['invented(): void;'];
    }],
    ['wrong declaration after', 'pixi-8.10.0', 'declarationDelta', (row) =>
    {
        const delta = row.declarationDelta['pixi.js/lib/scene/text/Text.d.ts'];

        assert.ok(Array.isArray(delta.after));
        delta.after = ['invented(): void;'];
    }],
    ['spurious declaration change', 'pixi-8.5.2', 'declarationDelta', (row) =>
    {
        assert.deepEqual(row.declarationDelta, {});
        row.declarationDelta['pixi.js/Invented.d.ts'] = { before: null, after: [] };
    }],
])
{
    test(`rejects ${name}`, (t) =>
    {
        const result = validate(t, (evidence) => mutate(evidence.results.find((r) => r.id === id)));

        assert.equal(result.status, 1, result.stdout);
        assert.ok(result.stderr.includes(`${id}: ${field}`), result.stderr);
    });
}

test('rejects evidence reordered away from the seed boundary sequence', (t) =>
{
    const result = validate(t, (evidence) => evidence.results.reverse());

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /tuple order/);
});

test('tracks separate React and Pixi boundary histories when seed tuples interleave', (t) =>
{
    const result = validate(t, (evidence, seed) =>
    {
        const pixiIndex = seed.probes.findIndex((tuple) => tuple.kind === 'pixi');

        assert.ok(pixiIndex > 1);
        const [pixi] = seed.probes.splice(pixiIndex, 1);

        seed.probes.splice(1, 0, pixi);
        evidence.results = seed.probes.map((tuple) => evidence.results.find((row) => row.id === tuple.id));
    });

    assert.equal(result.status, 0, result.stderr);
});

for (const [id, field, values] of [
    ['pixi-7.4.2', 'visibleChanged', [null, '0', -1, 0.5]],
    ['pixi-8.2.6', 'visibleChanged', [undefined, null, '0', -1, 0.5]],
    ['pixi-8.5.2', 'particleIsContainer', [undefined, null, 'false', 0]],
    ['pixi-8.10.0', 'removeParticlesDefaultCount', [undefined, null, '1', -1, 0.5]],
    ['pixi-8.2.6', 'zeroScale', [undefined, null, {}, [], [0], [0, 0, 0], ['0', 0], [0, null]]],
    ['pixi-8.21.0', 'mirroredTransform', [undefined, null, [], {}, 'invalid']],
])
{
    for (const value of values)
    {
        test(`rejects ${id} observation ${field} replaced by ${JSON.stringify(value)}`, (t) =>
        {
            const result = validate(t, (evidence) =>
            {
                const row = evidence.results.find((r) => r.id === id);

                assert.equal(row.runtimeExit, 0);
                assert.ok(Object.hasOwn(row.observation.observations, field));
                if (value === undefined) delete row.observation.observations[field];
                else row.observation.observations[field] = value;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`${id}: observation.observations.${field}`), result.stderr);
        });
    }
}

for (const field of ['rotation', 'scaleX', 'skewX'])
{
    for (const value of [undefined, null, '0'])
    {
        test(`rejects mirroredTransform.${field} replaced by ${JSON.stringify(value)}`, (t) =>
        {
            const result = validate(t, (evidence) =>
            {
                const transform = evidence.results.find((r) => r.id === 'pixi-8.21.0').observation.observations.mirroredTransform;

                assert.ok(Number.isFinite(transform[field]));
                if (value === undefined) delete transform[field];
                else transform[field] = value;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`pixi-8.21.0: observation.observations.mirroredTransform.${field}`), result.stderr);
        });
    }
}

test('requires particle observations for a particle-era tuple even with an edited capability flag', (t) =>
{
    const result = validate(t, (evidence) =>
    {
        const observation = evidence.results.find((r) => r.id === 'pixi-8.10.0').observation;

        assert.equal(observation.capabilities.particle, true);
        observation.capabilities.particle = false;
        delete observation.observations.particleIsContainer;
        delete observation.observations.removeParticlesDefaultCount;
    });

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /pixi-8.10.0: observation.observations.particleIsContainer/);
});

for (const id of ['react-18.3.1', 'react-19.0.0', 'react-19.0.8', 'react-19.1.0', 'react-19.1.9', 'react-19.2.0', 'react-19.2.8', 'react-19.3.0'])
{
    for (const field of ['contextBridge', 'activity'])
    {
        for (const value of [undefined, null, 'wrong-outcome'])
        {
            test(`rejects ${id} feature ${field} replaced by ${JSON.stringify(value)}`, (t) =>
            {
                const result = validate(t, (evidence) =>
                {
                    const row = evidence.results.find((r) => r.id === id);

                    assert.equal(row.runtimeExit, 0);
                    assert.equal(typeof row.observation.features[field], 'string');
                    if (value === undefined) delete row.observation.features[field];
                    else row.observation.features[field] = value;
                });

                assert.equal(result.status, 1, result.stdout);
                assert.ok(result.stderr.includes(`${id}: observation.features.${field}`), result.stderr);
            });
        }
    }
}

for (const [id, activity] of [['react-19.1.9', 'hide-restore'], ['react-19.2.0', 'not-available'], ['react-19.3.0', 'not-available']])
{
    test(`rejects version-inappropriate Activity outcome for ${id}`, (t) =>
    {
        const result = validate(t, (evidence) =>
        {
            const features = evidence.results.find((r) => r.id === id).observation.features;

            assert.notEqual(features.activity, activity);
            features.activity = activity;
        });

        assert.equal(result.status, 1, result.stdout);
        assert.ok(result.stderr.includes(`${id}: observation.features.activity`), result.stderr);
    });
}

for (const id of ['react-18.3.1', 'react-19.1.0', 'react-19.2.0'])
{
    for (const value of [undefined, null, 'rendered', { status: 'missing-host-capability', errors: ['createFragmentInstance is not a function'] }])
    {
        test(`rejects ${id} fragmentRef replaced by ${JSON.stringify(value)}`, (t) =>
        {
            const result = validate(t, (evidence) =>
            {
                const features = evidence.results.find((r) => r.id === id).observation.features;

                assert.equal(features.fragmentRef, 'not-available');
                if (value === undefined) delete features.fragmentRef;
                else features.fragmentRef = value;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`${id}: observation.features.fragmentRef`), result.stderr);
        });
    }
}

for (const extra of [null, 42, 'another error'])
{
    test(`rejects an extra fragment error ${JSON.stringify(extra)}`, (t) =>
    {
        const result = validate(t, (evidence) =>
        {
            const fragment = evidence.results.find((r) => r.id === 'react-19.3.0').observation.features.fragmentRef;

            assert.equal(fragment.errors.length, 1);
            assert.match(fragment.errors[0], /createFragmentInstance/);
            fragment.errors.push(extra);
        });

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /react-19.3.0: observation.features.fragmentRef.errors/);
    });
}
