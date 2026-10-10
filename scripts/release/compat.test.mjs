// Offline tests of the issue-40 release rules, the generated compatibility table and the docs pins:
// `node --test scripts/release/*.test.mjs` (part of `pnpm test:release`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEVELOPMENT_BUILD } from './bundles.mjs';
import { checkReleaseRules, committedConfig, exactList, loadSeedAt, pixiMajors, releaseFacts, supportedPixiRange } from './compat.mjs';
import { checkCompatibilityTable, renderCompatibilityTable, TABLE_FILE } from './compat-table.mjs';
import { readJson, repoRoot } from './config.mjs';
import { checkDocsPins, lockstepPins, lockstepProblems, PINS_FILE, renderPins, rewriteLockstep, rewriteVersions, textProblems } from './docs-pins.mjs';

const config = committedConfig();
const seed = loadSeedAt();
const clone = (value) => JSON.parse(JSON.stringify(value));

test('the Pixi range is derived from the manifest: minimum, current and the excluded versions', () =>
{
    assert.equal(supportedPixiRange(seed), '>=8.2.6 <8.5.0 || >=8.5.1 <8.23.0');
    const next = clone(seed);

    next.pixiEpochs.find((epoch) => epoch.id === 'pixi8').current = '8.23.1';
    assert.equal(supportedPixiRange(next), '>=8.2.6 <8.5.0 || >=8.5.1 <8.24.0', 'a newer audited current widens the range by one minor');
    next.adapterMatrix.pixiAdapters.pixi8.excludedVersions = ['8.5.0', '8.30.0', '8.1.0'];
    assert.equal(supportedPixiRange(next), '>=8.2.6 <8.5.0 || >=8.5.1 <8.24.0', 'exclusions outside the range are ignored');
    assert.deepEqual(exactList('19.0.8 || 19.0.0'), ['19.0.0', '19.0.8']);
    assert.equal(exactList('^19.3.0'), null);
    assert.deepEqual(pixiMajors('>=8.2.6 <8.5.0 || >=8.5.1 <8.23.0'), [8]);
});

test('the workspace satisfies the release rules', () =>
{
    assert.deepEqual(checkReleaseRules({ config }), []);
    const facts = releaseFacts({ config });

    assert.equal(facts.facade.reactEpoch, 'react193');
    assert.equal(facts.facade.expectedReactPeer, '^19.3.0');
    assert.equal(facts.pixi.newest, '8.22.0');
    assert.deepEqual(facts.pixi.pr, ['8.2.6', '8.22.0']);
});

test('a peer range is never wider than the manifest evidence', () =>
{
    const widened = clone(seed);

    widened.adapterMatrix.pixiAdapters.pixi8.declaredPeers['pixi.js'] = '>=8.2.6 <8.5.0 || >=8.5.1 <8.24.0';
    const problems = checkReleaseRules({ config, seed: widened }).join('\n');

    assert.match(problems, /declaredPeers\["pixi.js"\] is ">=8.2.6 <8.5.0 \|\| >=8.5.1 <8.24.0", but the manifest's evidence .* supports ">=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0"/);
    assert.match(problems, /the facade's pixi.js peer is ">=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0", the manifest's tested range is ">=8.2.6 <8.5.0 \|\| >=8.5.1 <8.24.0"/);
});

test('the facade\'s React peer and runtime warning follow the newest tested React of its epoch', () =>
{
    const patched = clone(seed);

    patched.adapterMatrix.reactAdapters.react193.declaredPeers.react = '19.3.0 || 19.3.1';
    const problems = checkReleaseRules({ config, seed: patched }).join('\n');

    assert.match(problems, /react peer is "\^19\.3\.0", expected "\^19\.3\.1"/);
    assert.match(problems, /TESTED_REACT is 19\.3 \["19\.3\.0"\], the manifest says 19\.3 \["19\.3\.0","19\.3\.1"\]/);

    const newer = clone(seed);

    newer.reactEpochs.push({ id: 'react194', reactMinor: '19.4', reconciler: '0.35.0', status: 'candidate-not-certified', requiredEvidence: [] });
    assert.match(checkReleaseRules({ config, seed: newer }).join('\n'), /newest React epoch in the manifest is react194 \(D1\)/);
});

test('the facade major tracks the Pixi major', () =>
{
    const plan = { releases: [{ name: '@pixi/react', type: 'major', oldVersion: '8.0.5', newVersion: '9.0.0' }] };

    assert.match(checkReleaseRules({ config, plan }).join('\n'), /the facade would release 9\.0\.0, but its major must equal the Pixi major of its pixi\.js peer \(8\)/);
    assert.deepEqual(checkReleaseRules({ config, plan: { releases: [{ name: '@pixi/react', type: 'minor', oldVersion: '8.0.5', newVersion: '8.1.0' }] } }), []);
});

test('the checked-in compatibility table is current', () =>
{
    assert.deepEqual(checkCompatibilityTable(), [], `${TABLE_FILE} is stale: run node scripts/release/compat-table.mjs --write`);
    const table = renderCompatibilityTable();
    const facade = readJson(join(repoRoot, 'packages/react/package.json'));
    const facts = releaseFacts({ config }).facade;
    // Release 1 is labelled until it is versioned; after that the row is the facade's current version (issue 62).
    const label = `${facts.version}${facts.pending ? ' (Release 1, not yet published)' : ''}`;

    assert.ok(table.includes(`| ${label} | \`${facade.peerDependencies.react}\` | 19.3.0 | \`${facade.peerDependencies['pixi.js'].replaceAll('|', '\\|')}\``), 'facade row');
    for (const pkg of config.packages) assert.ok(table.includes(`\`${pkg.publicName}\``), pkg.publicName);
    assert.doesNotMatch(table, /certified/i, 'the table says "tested" until a range is promoted');
});

test('the docs pins are current, exact and used by every example', () =>
{
    assert.deepEqual(checkDocsPins(), []);
    const pins = readJson(join(repoRoot, PINS_FILE));
    const facts = releaseFacts({ config });

    assert.deepEqual(pins, renderPins());
    assert.deepEqual(pins.current.dependencies, {
        [facts.facade.publicName]: facts.facade.version,
        'pixi.js': facts.pixi.newest,
        react: facts.facade.newestReact,
        'react-dom': facts.facade.newestReact,
    });
    const editor = readFileSync(join(repoRoot, 'apps/docs/src/components/Editor/Editor.tsx'), 'utf8');

    assert.match(editor, /release-pins\.json/);
    assert.doesNotMatch(editor, /'(?:\^|~)?\d+(?:\.\d+)*'|'latest'|'beta'/, 'the editor names no version of its own');
});

test('the pin rewriter and text checks catch drift, missing versions and moving tags', () =>
{
    const pins = { '@pixi/react': '8.1.0', 'pixi.js': '8.22.0', react: '19.3.0', 'react-dom': '19.3.0' };
    const text = [
        'npm install pixi.js@8.21.0 react@19.2.0 react-dom@19.2.0 @pixi/react@8.0.5',
        '"react/": "https://esm.sh/react@19.0.0/",',
        '"@pixi/react": "https://cdn.jsdelivr.net/npm/@pixi/react@8.0.5/dist/pixi-react.mjs"',
        'npm create pixi.js@latest',
    ].join('\n');
    const rewritten = rewriteVersions(text, pins);

    assert.equal(rewritten, [
        'npm install pixi.js@8.22.0 react@19.3.0 react-dom@19.3.0 @pixi/react@8.1.0',
        '"react/": "https://esm.sh/react@19.3.0/",',
        '"@pixi/react": "https://cdn.jsdelivr.net/npm/@pixi/react@8.1.0/dist/pixi-react.mjs"',
        'npm create pixi.js@latest',
    ].join('\n'));
    assert.deepEqual(textProblems(rewritten, pins, 'page'), []);
    assert.match(textProblems(text, pins, 'page').join('\n'), /react@19\.2\.0, the pin is 19\.3\.0/);
    const loose = textProblems('npm install pixi.js @pixi/react\n<script src="https://unpkg.com/@pixi/react/dist/x.js"></script>\nnpm i react@latest', pins, 'page').join('\n');

    assert.match(loose, /installs pixi\.js without a version/);
    assert.match(loose, /installs @pixi\/react without a version/);
    assert.match(loose, /CDN URL loads @pixi\/react without a version/);
    assert.match(loose, /react@latest is a moving tag/);
    // Lines about the modular packages show another React version on purpose; they are neither rewritten nor checked.
    const modular = 'npm install @pixi/react-renderer @pixi/react-19.1 @pixi/react-pixi-8 pixi.js react@19.1.9 react-dom@19.1.9';

    assert.equal(rewriteVersions(modular, pins), modular);
    assert.deepEqual(textProblems(modular, pins, 'page'), []);
});

test('install recipes name every modular package at the lockstep version (issue 62)', () =>
{
    const { names, version, pages } = lockstepPins();

    assert.equal(version, releaseFacts({ config }).facade.version, 'the lockstep version is the facade\'s release version');
    assert.ok(names.includes('@pixi/react-core') && names.includes('@pixi-react-provisional/pixi-8') && !names.includes('@pixi/react'));
    assert.ok(pages.includes('apps/docs/docs/migrating-to-8.1.mdx') && pages.includes('packages/react-18/README.md') && pages.includes('design/release.md'));
    // A fixed example version, so the test holds after any release.
    const example = '8.1.0';
    const recipe = 'npm install @pixi/react-renderer@8.0.0 @pixi/react-19.1@8.1.0 @pixi-react-provisional/pixi-8@1.0.0 pixi.js react@19.1.9 react-dom@19.1.9';
    const fixed = rewriteLockstep(recipe, names, example);

    assert.equal(fixed, 'npm install @pixi/react-renderer@8.1.0 @pixi/react-19.1@8.1.0 @pixi-react-provisional/pixi-8@8.1.0 pixi.js react@19.1.9 react-dom@19.1.9');
    assert.deepEqual(lockstepProblems(fixed, names, example, 'page'), []);
    assert.match(lockstepProblems(recipe, names, example, 'page').join('\n'), /@pixi\/react-renderer@8\.0\.0; install all modular packages at the same version, 8\.1\.0/);
    assert.match(lockstepProblems('npm install @pixi/react-renderer @pixi/react-18@8.1.0', names, example, 'page').join('\n'), /installs @pixi\/react-renderer without a version/);
    // The facade is not a modular package, and a longer name is not a shorter one.
    assert.equal(rewriteLockstep('@pixi/react@8.0.5 @pixi/react-18-fixture@1.0.0', names, example), '@pixi/react@8.0.5 @pixi/react-18-fixture@1.0.0');
});

test('a production bundle may not contain a development build of React\'s packages', () =>
{
    assert.ok(DEVELOPMENT_BUILD.test('node_modules/react-reconciler/cjs/react-reconciler.development.js'));
    assert.ok(DEVELOPMENT_BUILD.test('node_modules/@pixi/react/node_modules/scheduler/cjs/scheduler.development.js'));
    assert.ok(!DEVELOPMENT_BUILD.test('node_modules/react-reconciler/cjs/react-reconciler.production.js'));
    assert.ok(!DEVELOPMENT_BUILD.test('node_modules/pixi.js/lib/environment/development.js'));
});
