#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Bundle assertions over the staged release packages (issue 15), run in the clean consumer projects that
 * consumers.mjs installed. Each fixed fixture (scripts/release/fixtures/bundle) is bundled twice with the pinned esbuild:
 *
 * - `browser`: an application bundle (minified, NODE_ENV=production, everything bundled including react and pixi.js),
 *   measured in bytes and gzip bytes, with esbuild's metafile giving the bytes each input module contributes (a module that contributes none was
 *   eliminated);
 * - `node`: the same fixture bundled for Node and executed, so a registration side effect that tree shaking dropped
 *   would show as a missing registration or a failed composition.
 *
 * Assertions:
 * - unused adapter implementations are absent: only the chosen packages contribute modules; exactly one
 *   react-reconciler (the chosen epoch's) is bundled; no other epoch's reconciler version appears in the output; the
 *   facade bundles no modular package and the neutral factory bundles no React, reconciler or Pixi code; no
 *   development build of react, react-reconciler or scheduler contributes to the production bundle;
 * - necessary registration side effects remain: the executed bundle registered Container and Sprite and composed the
 *   expected adapters (the facade's `extend` ran);
 * - unused Pixi constructors can be eliminated: `NineSliceSprite`, which no fixture imports or registers, must be
 *   absent. KNOWN_GAPS lists fixtures where that is not true yet; such a fixture must still fail the assertion (an
 *   unexpected pass fails the run, so the list is kept honest);
 * - our packages are bundled once each, at the release version (lockstep, issue 62);
 * - the Pixi code kept is no more than upstream's (issue 57): the facade fixture is also bundled against upstream
 *   `@pixi/react` 8.0.5 from the registry, in its own clean project with the same React, pixi.js and esbuild, and the
 *   facade and explicit fixtures may keep no more pixi.js modules and no more pixi.js bytes than that baseline.
 *
 * Bundles are measured for a fixed fixture with pinned versions. They say nothing about resolving peer-version
 * conflicts: tree shaking never makes two React or Pixi versions coexist.
 *
 * Usage: node scripts/release/bundles.mjs [--tarballs <dir>]   (after consumers.mjs)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { repoRoot, resetOutputDir } from './config.mjs';
import { consumersRoot, scenarios } from './consumers.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** A Pixi constructor no fixture imports or registers; its module must be eliminated. */
const UNUSED_PIXI_MODULE = /\/NineSliceSprite\.m?js$/;

/**
 * Fixtures that still keep an unused Pixi constructor: `{ [id]: { fixtures: [kind, ...], reason } }`. None today: the
 * gap issue 15 recorded (pixi-8 and the facade bound the whole `pixi.js` namespace) was closed by issue 57, whose
 * entries import the adapter's binding exports by name. A listed fixture that no longer reproduces fails the run.
 */
export const KNOWN_GAPS = {};

/**
 * pixi.js 7's dependencies: its `@pixi/*` packages and their own dependencies (the `url` polyfill chain of `@pixi/utils`
 * among them). pixi.js 7 declares no `sideEffects`, so a bundler keeps nearly all of it whatever the application imports.
 */
const PIXI7_DEPS = ['pixi.js', '@pixi/*', 'earcut', 'eventemitter3', 'ismobilejs', 'url', 'punycode', 'qs', 'side-channel', 'side-channel-*', 'object-inspect', 'get-intrinsic', 'call-bind-apply-helpers', 'call-bound', 'dunder-proto', 'es-define-property', 'es-errors', 'es-object-atoms', 'function-bind', 'get-proto', 'gopd', 'has-symbols', 'hasown', 'math-intrinsics', '@types/*'];

/** pixi.js and its dependencies: the packages a Pixi bundle may contain. */
const PIXI_DEPS = ['pixi.js', '@pixi/colord', '@xmldom/xmldom', '@webgpu/types', 'earcut', 'eventemitter3', 'gifuct-js', 'ismobilejs', 'parse-svg-path', 'tiny-lru', 'js-binary-schema-parser', '@types/*'];

/** A development build file of a React package (`react-reconciler.development.js`, `scheduler.development.js`, ...). */
export const DEVELOPMENT_BUILD = /node_modules\/(?:react|react-dom|react-reconciler|scheduler|its-fine)\/.*\.development\.js$/;

/** Upstream's last release, bundled on the facade fixture as the bound for the Pixi code our bundles keep. */
export const UPSTREAM_BASELINE = Object.freeze({ name: '@pixi/react', version: '8.0.5' });

const fill = (text, values) => Object.entries(values ?? {}).reduce((result, [key, value]) => result.replaceAll(`__${key}__`, value), text);

/** `node_modules/<name>` of an input path, for scoped and unscoped packages. */
function packageOfInput(input)
{
    const match = input.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//g);

    if (!match) return null;

    return match[match.length - 1].replace(/^\/?node_modules\//, '').replace(/^.*node_modules\//, '').replace(/\/$/, '');
}

async function build(esbuild, dir, entry, platform)
{
    const outfile = join(dir, 'bundle', `${entry.replace(/\.mjs$/, '')}.${platform}.mjs`);
    const result = await esbuild.build({
        entryPoints: [join(dir, 'bundle', entry)],
        absWorkingDir: dir,
        bundle: true,
        format: 'esm',
        platform,
        minify: platform === 'browser',
        treeShaking: true,
        metafile: true,
        outfile,
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': '"production"' },
        ...(platform === 'node' ? { banner: { js: 'import { createRequire as __cr } from \'node:module\'; const require = __cr(import.meta.url);' } } : {}),
    });

    return { outfile, metafile: result.metafile };
}

/** Bundles and checks one fixture in one consumer project. */
export async function checkFixture({ dir, fixture, values, expect })
{
    const problems = [];
    const gaps = [];
    const requireFromProject = createRequire(join(dir, 'package.json'));
    const esbuild = requireFromProject('esbuild');

    mkdirSync(join(dir, 'bundle'), { recursive: true });
    writeFileSync(join(dir, 'bundle', fixture), fill(readFileSync(join(here, 'fixtures/bundle', fixture), 'utf8'), values));

    const browser = await build(esbuild, dir, fixture, 'browser');
    const output = readFileSync(browser.outfile);
    // Only modules that contribute bytes to the output: esbuild parses every imported module, then drops the unused.
    const [outputInfo] = Object.values(browser.metafile.outputs);
    const retained = Object.entries(outputInfo.inputs).filter(([, info]) => info.bytesInOutput > 0);
    const inputs = retained.map(([input]) => input);
    const byPackage = {};

    for (const [input, info] of retained)
    {
        const name = packageOfInput(input) ?? '(fixture)';

        byPackage[name] = (byPackage[name] ?? 0) + info.bytesInOutput;
    }
    const packages = Object.keys(byPackage).filter((name) => name !== '(fixture)').sort();

    // Unused adapter implementations are absent.
    for (const name of packages) if (!expect.allowedPackages.some((allowed) => (allowed.endsWith('*') ? name.startsWith(allowed.slice(0, -1)) : name === allowed))) problems.push(`bundles ${name}, which this fixture does not use`);
    for (const name of expect.requiredPackages ?? []) if (!packages.includes(name)) problems.push(`does not bundle ${name}`);
    const text = output.toString('utf8');

    for (const marker of expect.absentMarkers ?? []) if (text.includes(marker.text)) problems.push(`output contains ${marker.label}`);
    // The browser bundle is a production build: no development build of React's packages may contribute code
    // (react-reconciler and scheduler choose their build by NODE_ENV; issue 40 checks nothing ships both).
    for (const input of inputs.filter((item) => DEVELOPMENT_BUILD.test(item))) problems.push(`the production bundle contains the development build ${input}`);
    for (const [name, version] of Object.entries(expect.bundledVersions ?? {}))
    {
        const roots = [...new Set(inputs.filter((input) => packageOfInput(input) === name).map((input) => input.slice(0, input.lastIndexOf(`node_modules/${name}/`) + `node_modules/${name}`.length)))];
        const versions = roots.map((root) => JSON.parse(readFileSync(join(dir, root, 'package.json'), 'utf8')).version);

        if (versions.length !== 1 || versions[0] !== version) problems.push(`bundles ${name} ${versions.join(', ') || 'not at all'}, expected exactly ${version}`);
    }

    // Unused Pixi constructors can be eliminated.
    if (expect.pixi)
    {
        const kept = inputs.some((input) => UNUSED_PIXI_MODULE.test(input));
        const gap = Object.entries(KNOWN_GAPS).find(([, entry]) => entry.fixtures.includes(expect.kind));

        if (kept && gap) gaps.push(`${gap[0]}: ${gap[1].reason}`);
        else if (kept) problems.push('keeps NineSliceSprite, which nothing imports or registers');
        else if (gap) problems.push(`known gap "${gap[0]}" no longer reproduces: NineSliceSprite was eliminated. Remove the fixture from KNOWN_GAPS.`);
    }

    // Necessary registration side effects remain: run the Node bundle.
    let executed = null;

    try
    {
        const node = await build(esbuild, dir, fixture, 'node');
        const module = await import(`${pathToFileURL(node.outfile).href}?${Date.now()}`);

        executed = module.result();
        for (const [key, value] of Object.entries(expect.result ?? {}))
        {
            if (JSON.stringify(executed[key]) !== JSON.stringify(value)) problems.push(`executed bundle: ${key} is ${JSON.stringify(executed[key])}, expected ${JSON.stringify(value)}`);
        }
    }
    catch (error)
    {
        problems.push(`executed bundle failed: ${error.message}`);
    }

    return {
        fixture,
        bytes: output.length,
        gzipBytes: gzipSync(output, { level: 9 }).length,
        inputModules: inputs.length,
        pixiModules: inputs.filter((input) => packageOfInput(input) === 'pixi.js').length,
        pixiBytes: byPackage['pixi.js'] ?? 0,
        bytesByPackage: Object.fromEntries(Object.entries(byPackage).sort(([, a], [, b]) => b - a)),
        executed,
        problems,
        gaps,
    };
}

/** The fixtures to bundle in each consumer scenario that installed esbuild. */
export function bundlePlan(manifest)
{
    const list = scenarios(manifest);
    const reconcilers = ['0.29.2', '0.31.0', '0.32.0', '0.33.0', '0.34.0'];
    const plan = [];

    for (const scenario of list.filter((item) => item.bundle))
    {
        const dir = join(consumersRoot(), scenario.id);
        // Lockstep (issue 62): one copy of each of our packages, at the release version.
        const atRelease = (names) => Object.fromEntries(names.map((name) => [name, scenario.tree.sameVersion.version]));

        if (scenario.bundle === 'explicit')
        {
            const ours = scenario.install.map((entry) => entry.publicName);
            const reconciler = scenario.tree.exactly['react-reconciler'];
            // The Pixi 8 bounds (unused constructors eliminated, no more Pixi than upstream 8.0.5) apply to the default
            // Pixi adapter. pixi.js 7 is barely tree shakable (no `sideEffects`), so a Pixi 7 bundle is checked for the
            // adapter bounds only: our packages once each, one reconciler, no other adapter, registration intact.
            const defaultPixi = scenario.pixiAdapter.isDefault;

            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'explicit.mjs',
                values: scenario.bundleValues,
                expect: {
                    kind: 'explicit',
                    pixi: defaultPixi,
                    allowedPackages: [...ours, 'react', 'react-reconciler', 'scheduler', 'its-fine', ...(defaultPixi ? PIXI_DEPS : PIXI7_DEPS)],
                    requiredPackages: [...ours, 'react-reconciler', 'pixi.js'],
                    bundledVersions: { ...atRelease(ours), 'react-reconciler': reconciler, react: scenario.registry.react, 'pixi.js': scenario.registry['pixi.js'] },
                    absentMarkers: reconcilers.filter((version) => version !== reconciler).map((version) => ({ text: `"${version}"`, label: `another epoch's reconciler version "${version}"` })),
                    result: { registered: ['pixiContainer', 'pixiSprite'], react: scenario.bundleValues.REACT_ID, pixi: scenario.bundleValues.PIXI_ID },
                    upstreamBound: defaultPixi,
                },
            });
            if (!defaultPixi) continue;
            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'pixi-control.mjs',
                values: {},
                expect: { kind: 'control', pixi: true, allowedPackages: PIXI_DEPS, requiredPackages: ['pixi.js'], result: { constructors: ['function', 'function'] } },
            });
        }
        if (scenario.bundle === 'facade')
        {
            const facade = scenario.install[0].publicName;

            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'facade.mjs',
                values: { FACADE: facade },
                expect: {
                    kind: 'facade',
                    pixi: true,
                    allowedPackages: [facade, 'react', 'react-reconciler', 'scheduler', 'its-fine', ...PIXI_DEPS],
                    requiredPackages: [facade, 'react-reconciler'],
                    bundledVersions: { ...atRelease([facade]), 'react-reconciler': '0.34.0', react: scenario.registry.react },
                    absentMarkers: reconcilers.filter((version) => version !== '0.34.0').map((version) => ({ text: `"${version}"`, label: `a non-default epoch's reconciler version "${version}"` })),
                    result: { application: 'object', extend: 'function' },
                    upstreamBound: true,
                },
            });
        }
        if (scenario.bundle === 'renderer')
        {
            const ours = scenario.install.map((entry) => entry.publicName);

            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'renderer.mjs',
                values: scenario.bundleValues,
                expect: { kind: 'renderer', pixi: false, allowedPackages: ours, requiredPackages: ours, bundledVersions: atRelease(ours), result: { createRenderer: 'function' } },
            });
        }
    }

    return plan;
}

/**
 * The upstream baseline: the facade fixture against upstream `@pixi/react` 8.0.5 from the registry, with the facade
 * scenario's React, pixi.js and esbuild. Its project is a sibling of the consumer projects.
 */
export function upstreamPlan(manifest)
{
    const facade = scenarios(manifest).find((item) => item.bundle === 'facade');
    const { react, 'react-dom': reactDom, 'pixi.js': pixi, esbuild } = facade.registry;

    return {
        scenario: `upstream-${UPSTREAM_BASELINE.version}`,
        dir: join(consumersRoot(), `upstream-${UPSTREAM_BASELINE.version}`),
        dependencies: { [UPSTREAM_BASELINE.name]: UPSTREAM_BASELINE.version, react, 'react-dom': reactDom, 'pixi.js': pixi, esbuild },
        fixture: 'facade.mjs',
        values: { FACADE: UPSTREAM_BASELINE.name },
        expect: {
            kind: 'upstream',
            pixi: true,
            allowedPackages: [UPSTREAM_BASELINE.name, 'react', 'react-reconciler', 'scheduler', 'its-fine', ...PIXI_DEPS],
            requiredPackages: [UPSTREAM_BASELINE.name, 'react-reconciler', 'pixi.js'],
            bundledVersions: { [UPSTREAM_BASELINE.name]: UPSTREAM_BASELINE.version, react, 'pixi.js': pixi },
            result: { application: 'object', extend: 'function' },
        },
    };
}

/** Creates and installs the upstream baseline project (registry packages only, no lifecycle scripts). */
function installUpstream(plan)
{
    resetOutputDir(plan.dir, { insideRelease: true });
    writeFileSync(join(plan.dir, 'package.json'), `${JSON.stringify({ name: 'release-upstream-baseline', version: '0.0.0', private: true, type: 'module', dependencies: plan.dependencies }, null, 2)}\n`);
    execFileSync('npm', ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: plan.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Problems of `result` against the upstream baseline: more pixi.js modules or bytes than upstream keeps. */
export function compareWithUpstream(result, upstream)
{
    const problems = [];

    if (result.pixiModules > upstream.pixiModules) problems.push(`keeps ${result.pixiModules} pixi.js modules, more than upstream ${UPSTREAM_BASELINE.version}'s ${upstream.pixiModules}`);
    if (result.pixiBytes > upstream.pixiBytes) problems.push(`keeps ${result.pixiBytes} bytes of pixi.js, more than upstream ${UPSTREAM_BASELINE.version}'s ${upstream.pixiBytes}`);

    return problems;
}

export function renderBundleTable(results)
{
    const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
    const lines = ['| Scenario | Fixture | Minified | Gzip | Modules (pixi.js) | pixi.js bytes | Largest inputs | Result |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];

    for (const item of results)
    {
        const largest = Object.entries(item.bytesByPackage).slice(0, 4).map(([name, bytes]) => `${name} ${kb(bytes)}`).join(', ');
        let verdict = item.gaps.length ? 'pass (known gap)' : 'pass';

        if (item.problems.length) verdict = 'FAIL';

        lines.push(`| ${item.scenario} | ${item.fixture} | ${kb(item.bytes)} | ${kb(item.gzipBytes)} | ${item.inputModules} (${item.pixiModules}) | ${kb(item.pixiBytes)} | ${largest} | ${verdict} |`);
    }

    return lines.join('\n');
}

export async function runBundles(manifest, { log = console.log } = {})
{
    const results = [];
    const baseline = upstreamPlan(manifest);

    installUpstream(baseline);
    const upstream = { scenario: baseline.scenario, ...(await checkFixture(baseline)) };

    results.push(upstream);
    log(`${baseline.scenario} ${baseline.fixture}: ${upstream.problems.length ? 'FAILED' : 'ok'} (${upstream.bytes} bytes, gzip ${upstream.gzipBytes}, ${upstream.inputModules} modules, ${upstream.pixiModules} from pixi.js, ${upstream.pixiBytes} bytes of pixi.js; the baseline)`);
    for (const problem of upstream.problems) log(`  - ${problem}`);

    for (const entry of bundlePlan(manifest))
    {
        const result = { scenario: entry.scenario, ...(await checkFixture(entry)) };

        if (entry.expect.upstreamBound && !upstream.problems.length) result.problems.push(...compareWithUpstream(result, upstream));
        else if (entry.expect.upstreamBound) result.problems.push('the upstream baseline failed, so the Pixi bound could not be checked');

        results.push(result);
        log(`${entry.scenario} ${entry.fixture}: ${result.problems.length ? 'FAILED' : 'ok'} (${result.bytes} bytes, gzip ${result.gzipBytes}, ${result.inputModules} modules, ${result.pixiModules} from pixi.js, ${result.pixiBytes} bytes of pixi.js)`);
        for (const problem of result.problems) log(`  - ${problem}`);
        for (const gap of result.gaps) log(`  known gap: ${gap}`);
    }

    return results;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const args = process.argv.slice(2);
    const index = args.indexOf('--tarballs');
    const tarballDir = resolve(index >= 0 ? args[index + 1] : join(repoRoot, '.release', 'tarballs'));
    const manifest = JSON.parse(readFileSync(join(tarballDir, 'release-manifest.json'), 'utf8'));
    const results = await runBundles(manifest);

    writeFileSync(join(tarballDir, 'bundles.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\n${renderBundleTable(results)}`);
    const failed = results.filter((item) => item.problems.length);

    if (failed.length)
    {
        console.error(`\nbundles: ${failed.length} fixture(s) failed`);
        process.exit(1);
    }
    console.log(`\nbundles: ok (${results.length} fixtures; ${results.filter((item) => item.gaps.length).length} with a known gap)`);
}
