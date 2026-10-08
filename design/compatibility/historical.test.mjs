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
    copyFileSync(new URL('validate-historical.mjs', import.meta.url), join(root, 'validate-historical.mjs'));
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

const historicalObservationCases = [
    ['react-17.0.0-bridge-1.2.0', 'features.contextBridge', undefined],
    ['react-17.0.0-bridge-1.2.0', 'features.refs', 'not-run'],
    ['react-17.0.0-bridge-1.2.0', 'features.effects', []],
    ['react-17.0.0-bridge-1.2.0', 'features.state', false],
    ['react-17.0.0-bridge-1.2.0', 'features.errorBoundary', undefined],
    ['react-17.0.0-bridge-1.2.0', 'features.secondaryParentBridge.actual', 'secondary-parent'],
    ['react-17.0.0-bridge-1.2.0', 'createContainerArity', '4'],
    ['pixi-6.1.0', 'observations.scene', undefined],
    ['pixi-6.1.0', 'observations.eventScope', undefined],
    ['pixi-6.1.0', 'observations.ticker.samples', []],
    ['pixi-6.1.0', 'observations.ticker.samples.0.argument', '6'],
    ['pixi-6.1.0', 'observations.ticker.callback', 'Ticker'],
    ['pixi-6.1.0', 'observations.application.initMethod', 'function'],
    ['pixi-6.1.0', 'observations.application.registeredPlugins', []],
    ['pixi-6.1.0', 'observations.application.runtimeConstruction', 'rendered'],
    ['pixi-6.1.0', 'observations.destruction.events.0.publicDestroyedDuringEvent', true],
    ['pixi-6.0.0', 'observations.destruction.publicDestroyedAfterDestroy', true],
    ['pixi-6.5.1', 'observations.spritesheet.runtime.noArgumentReturn', 'undefined'],
    ['pixi-6.5.1', 'observations.spritesheet.declarations.parseSignatures', []],
    ['pixi-6.4.2', 'observations.spritesheet.commonjs.result.callbacks', 0],
    ['pixi-6.4.2', 'observations.publishedBundles', {}],
    ['pixi-6.5.1', 'observations.packaging', undefined],
    ['pixi-6.5.1', 'observations.packaging.status', 'embedded-core-definitions'],
    ['pixi-6.1.0', 'observations.bootstrap', []],
    ['pixi-6.1.0', 'observations.unmodifiedNodeImport.exit', 0],
    ['pixi-6.1.0-federated', 'observations.optionalEvents.version', '6.5.10'],
    ['pixi-6.1.0-federated', 'observations.optionalEvents.received', ['target']],
    ['pixi-6.1.0-federated', 'observations.optionalEvents.scope', undefined],
    ['pixi-6.1.0-federated', 'observations.publishedBundles', {}],
    ['pixi-6.5.0-assets', 'observations.assets.version', '6.5.1'],
    ['pixi-6.5.0-assets', 'observations.assets.methods', ['load']],
    ['pixi-6.5.0-assets', 'observations.assets.scope', undefined],
    ['pixi-6.5.0-assets', 'observations.publishedSources', {}],
];

for (const [id, path, value] of historicalObservationCases)
{
    test(`historical observations reject ${id}: ${path}`, (t) =>
    {
        const result = validate(t, (evidence) =>
        {
            const row = evidence.results.find((r) => r.id === id);
            const keys = path.split('.');
            const field = keys.pop();
            const target = keys.reduce((object, key) => object[key], row.observation);

            assert.ok(Object.hasOwn(target, field));
            if (value === undefined) delete target[field];
            else target[field] = value;
        });

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /AssertionError/);
        assert.ok(result.stderr.includes(`${id}: observation`), result.stderr);
    });
}
