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
    copyFileSync(new URL('validate.mjs', import.meta.url), join(root, 'validate.mjs'));
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
