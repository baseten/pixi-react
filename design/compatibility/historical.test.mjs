import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function validate(t, mutate)
{
    const root = mkdtempSync(join(tmpdir(), 'historical-audit-test-'));

    t.after(() => rmSync(root, { recursive: true, force: true }));
    const seed = JSON.parse(readFileSync(new URL('historical-seed.json', import.meta.url)));
    const evidence = JSON.parse(readFileSync(new URL('historical-evidence.json', import.meta.url)));

    mutate?.(evidence, seed);
    copyFileSync(new URL('validate.mjs', import.meta.url), join(root, 'validate.mjs'));
    writeFileSync(join(root, 'historical-seed.json'), JSON.stringify(seed));
    writeFileSync(join(root, seed.evidence), JSON.stringify(evidence));

    return spawnSync(process.execPath, [join(root, 'validate.mjs'), '--historical'], { encoding: 'utf8' });
}

test('accepts the complete historical matrix including explicit negative outcomes', (t) =>
{
    const result = validate(t);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 26 exact tuples/);
});

const cases = [
    ['missing intermediate React patch', (e, s) =>
    {
        s.probes = s.probes.filter((r) => r.packages.react !== '17.0.1');
        e.results = e.results.filter((r) => r.packages.react !== '17.0.1');
    }],
    ['missing NodeNext outcome', (e) => { delete e.results[0].typeVariants; }],
    ['unrelated NodeNext failure', (e) => { e.results[0].typeVariants.NodeNext.stdout = 'unrelated failure'; }],
    ['silently passing NodeNext', (e) => { e.results[0].typeVariants.NodeNext.status = 0; }],
    ['lost secondary source limitation', (e) => { delete e.results[0].observation.features.secondaryParentBridge; }],
    ['lost Pixi 6.4 ESM failure', (e) => { e.results.find((r) => r.id === 'pixi-6.4.2').runtimeExit = 0; }],
    ['unrelated Pixi 6.4 failure', (e) => { e.results.find((r) => r.id === 'pixi-6.4.2').failure = 'unrelated failure'; }],
    ['missing failed-import package evidence', (e) => { e.results.find((r) => r.id === 'pixi-6.4.2').resolvedPackages = {}; }],
    ['lost 6.5.0 bundled-core exclusion', (e) => { delete e.results.find((r) => r.id === 'pixi-6.5.0').observation.observations.packaging; }],
    ['tampered optional event package', (e) => { e.results.find((r) => r.id === 'pixi-6.1.0-federated').resolvedPackages['@pixi/events'].integrity = 'sha512-tampered'; }],
    ['lost particle package removal', (e) => { e.results.find((r) => r.id === 'pixi-6.1.0').declarationDelta = {}; }],
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
