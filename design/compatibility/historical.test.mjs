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
    copyFileSync(new URL('declaration-series.mjs', import.meta.url), join(root, 'declaration-series.mjs'));
    copyFileSync(new URL('react-abi.mjs', import.meta.url), join(root, 'react-abi.mjs'));
    copyFileSync(new URL('validate.mjs', import.meta.url), join(root, 'validate.mjs'));
    copyFileSync(new URL('validate-historical.mjs', import.meta.url), join(root, 'validate-historical.mjs'));
    copyFileSync(new URL('resolved-packages.mjs', import.meta.url), join(root, 'resolved-packages.mjs'));
    copyFileSync(new URL('surface-map.mjs', import.meta.url), join(root, 'surface-map.mjs'));
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

for (const [name, mutate] of [
    ['missing row series', (e) => { delete e.results.find((r) => r.id === 'pixi-6.1.0-federated').declarationSeries; }],
    ['wrong row series', (e) => { e.results.find((r) => r.id === 'pixi-6.1.0-federated').declarationSeries = 'pixi6-baseline'; }],
    ['misassigned manifest and row series', (e, s) =>
    {
        for (const rows of [e.results, s.probes]) rows.find((r) => r.id === 'pixi-6.5.0-assets').declarationSeries = 'pixi6-federated';
    }],
    ['unknown manifest series', (e, s) => { s.probes.find((r) => r.id === 'pixi-6.0.0').declarationSeries = 'anything'; }],
    ['cross-series initial delta', (e) =>
    {
        e.results.find((r) => r.id === 'pixi-6.1.0-federated').declarationDelta['@pixi/events/index.d.ts'].before = ['unrelated baseline'];
    }],
    ['missing within-series delta', (e) => { e.results.find((r) => r.id === 'pixi-6.5.1-federated').declarationDelta = {}; }],
])
{
    test(`declaration history rejects ${name}`, (t) =>
    {
        const result = validate(t, mutate);

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /declarationSeries|declarationDelta/);
    });
}

test('the evidence consumer accepts interleaved historical series with their own retained deltas', (t) =>
{
    const result = validate(t, (e, s) =>
    {
        const react = s.probes.filter((r) => r.kind === 'react');
        const groups = ['pixi6-baseline', 'pixi6-federated', 'pixi6-assets'].map((series) => s.probes.filter((r) => r.declarationSeries === series));
        const interleaved = [];

        for (let i = 0; i < Math.max(...groups.map((g) => g.length)); i++)
        { for (const group of groups) if (group[i]) interleaved.push(group[i]); }
        s.probes = [...react, ...interleaved];
        e.results = s.probes.map((tuple) => e.results.find((row) => row.id === tuple.id));
    });

    assert.equal(result.status, 0, result.stderr);
});

const pixiEvidence = JSON.parse(readFileSync(new URL('historical-evidence.json', import.meta.url))).results.filter((row) => row.packages['pixi.js']);

for (const row of pixiEvidence.filter((item) => item.runtimeExit === 0))
{
    for (const [key, recorded] of Object.entries(row.observation.capabilities))
    {
        test(`historical capability rejects inverted ${row.id}: ${key}`, (t) =>
        {
            assert.equal(typeof recorded, 'boolean');
            const result = validate(t, (e) =>
            {
                e.results.find((item) => item.id === row.id).observation.capabilities[key] = !recorded;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`${row.id}: observation.capabilities`), result.stderr);
        });
    }
    test(`historical capability rejects an unreported flag in ${row.id}`, (t) =>
    {
        const result = validate(t, (e) =>
        {
            e.results.find((item) => item.id === row.id).observation.capabilities.unreportedFeature = true;
        });

        assert.equal(result.status, 1, result.stdout);
        assert.ok(result.stderr.includes(`${row.id}: observation.capabilities`), result.stderr);
    });
}

for (const row of pixiEvidence.filter((item) => item.runtimeExit !== 0))
{
    for (const replacement of [undefined, {}, { asyncInit: false, particle: false, particleContainer: true, cacheAsTexture: false, renderLayer: false, domContainer: false, canvasRenderer: false }])
    {
        test(`failed import retains unobserved capabilities for ${row.id}: ${JSON.stringify(replacement)}`, (t) =>
        {
            assert.equal(row.observation.capabilities, null);
            const result = validate(t, (e) =>
            {
                e.results.find((item) => item.id === row.id).observation.capabilities = replacement;
            });

            assert.equal(result.status, 1, result.stdout);
            assert.ok(result.stderr.includes(`${row.id}: observation.capabilities`), result.stderr);
        });
    }
}

for (const version of ['6.5.0', '6.5.1', '6.5.10'])
{
    test(`historical extension evidence rejects missing registration declarations for ${version}`, (t) =>
    {
        const result = validate(t, (e) =>
        {
            const row = e.results.find((item) => item.id === `pixi-${version}`);

            const path = version === '6.5.0' ? '@pixi/core/index.d.ts' : '@pixi/extensions/index.d.ts';

            row.surfaces[path].declarations = [];
            // Recompute consistent deltas so this tests the retained declaration contract.
            let previous = null;

            for (const item of e.results.filter((item) => item.declarationSeries === 'pixi6-baseline'))
            {
                const after = item.surfaces[path]?.declarations ?? null;

                delete item.declarationDelta[path];
                if (JSON.stringify(previous) !== JSON.stringify(after)) item.declarationDelta[path] = { before: previous, after };
                previous = after;
            }
        });

        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /(?:core|extensions).*declarations/);
    });
}
