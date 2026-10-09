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
 *   facade bundles no modular package and the neutral factory bundles no React, reconciler or Pixi code;
 * - necessary registration side effects remain: the executed bundle registered Container and Sprite and composed the
 *   expected adapters (the facade's `extend` ran);
 * - unused Pixi constructors can be eliminated: `NineSliceSprite`, which no fixture imports or registers, must be
 *   absent. KNOWN_GAPS lists fixtures where that is not true yet; such a fixture must still fail the assertion (an
 *   unexpected pass fails the run, so the list is kept honest).
 *
 * Bundles are measured for a fixed fixture with pinned versions. They say nothing about resolving peer-version
 * conflicts: tree shaking never makes two React or Pixi versions coexist.
 *
 * Usage: node scripts/release/bundles.mjs [--tarballs <dir>]   (after consumers.mjs)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { repoRoot } from './config.mjs';
import { consumersRoot, scenarios } from './consumers.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** A Pixi constructor no fixture imports or registers; its module must be eliminated. */
const UNUSED_PIXI_MODULE = /\/NineSliceSprite\.m?js$/;

/**
 * Fixtures whose bundles still keep every Pixi constructor. The Pixi 8 adapter binds the whole `pixi.js` module
 * namespace (`import * as peer from 'pixi.js'; bindPixi(peer)`, the D6 peer binding, and the facade's
 * `lib/index.mjs` the same way) so it can detect optional exports. A namespace object that escapes into a function
 * keeps every export alive in every bundler. Closing this needs the adapter to bind named constructors instead
 * (proposed follow-up; see design/release.md, "Known gap: Pixi constructor elimination").
 */
export const KNOWN_GAPS = {
    'unused-pixi-constructor': {
        fixtures: ['explicit', 'facade'],
        reason: 'pixi-8 and the facade bind the whole pixi.js namespace (D6 peer binding), so no Pixi constructor can be eliminated',
    },
};

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
    for (const name of packages) if (!expect.allowedPackages.some((allowed) => (allowed.endsWith('/*') ? name.startsWith(allowed.slice(0, -1)) : name === allowed))) problems.push(`bundles ${name}, which this fixture does not use`);
    for (const name of expect.requiredPackages ?? []) if (!packages.includes(name)) problems.push(`does not bundle ${name}`);
    const text = output.toString('utf8');

    for (const marker of expect.absentMarkers ?? []) if (text.includes(marker.text)) problems.push(`output contains ${marker.label}`);
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
    const pixiDeps = ['pixi.js', '@pixi/colord', '@xmldom/xmldom', '@webgpu/types', 'earcut', 'eventemitter3', 'gifuct-js', 'ismobilejs', 'parse-svg-path', 'tiny-lru', 'js-binary-schema-parser', '@types/*'];

    for (const scenario of list.filter((item) => item.bundle))
    {
        const dir = join(consumersRoot(), scenario.id);

        if (scenario.bundle === 'explicit')
        {
            const ours = scenario.install.map((entry) => entry.publicName);
            const reconciler = scenario.tree.exactly['react-reconciler'];

            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'explicit.mjs',
                values: scenario.bundleValues,
                expect: {
                    kind: 'explicit',
                    pixi: true,
                    allowedPackages: [...ours, 'react', 'react-reconciler', 'scheduler', 'its-fine', ...pixiDeps],
                    requiredPackages: [...ours, 'react-reconciler', 'pixi.js'],
                    bundledVersions: { 'react-reconciler': reconciler, react: scenario.registry.react },
                    absentMarkers: reconcilers.filter((version) => version !== reconciler).map((version) => ({ text: `"${version}"`, label: `another epoch's reconciler version "${version}"` })),
                    result: { registered: ['pixiContainer', 'pixiSprite'], react: scenario.bundleValues.REACT_ID, pixi: 'pixi-8' },
                },
            });
            plan.push({
                scenario: scenario.id,
                dir,
                fixture: 'pixi-control.mjs',
                values: {},
                expect: { kind: 'control', pixi: true, allowedPackages: pixiDeps, requiredPackages: ['pixi.js'], result: { constructors: ['function', 'function'] } },
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
                    allowedPackages: [facade, 'react', 'react-reconciler', 'scheduler', 'its-fine', ...pixiDeps],
                    requiredPackages: [facade, 'react-reconciler'],
                    bundledVersions: { 'react-reconciler': '0.34.0', react: scenario.registry.react },
                    absentMarkers: reconcilers.filter((version) => version !== '0.34.0').map((version) => ({ text: `"${version}"`, label: `a non-default epoch's reconciler version "${version}"` })),
                    result: { application: 'object', extend: 'function' },
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
                expect: { kind: 'renderer', pixi: false, allowedPackages: ours, requiredPackages: ours, result: { createRenderer: 'function' } },
            });
        }
    }

    return plan;
}

export function renderBundleTable(results)
{
    const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
    const lines = ['| Scenario | Fixture | Minified | Gzip | Modules (pixi.js) | Largest inputs | Result |', '| --- | --- | --- | --- | --- | --- | --- |'];

    for (const item of results)
    {
        const largest = Object.entries(item.bytesByPackage).slice(0, 4).map(([name, bytes]) => `${name} ${kb(bytes)}`).join(', ');
        let verdict = item.gaps.length ? 'pass (known gap)' : 'pass';

        if (item.problems.length) verdict = 'FAIL';

        lines.push(`| ${item.scenario} | ${item.fixture} | ${kb(item.bytes)} | ${kb(item.gzipBytes)} | ${item.inputModules} (${item.pixiModules}) | ${largest} | ${verdict} |`);
    }

    return lines.join('\n');
}

export async function runBundles(manifest, { log = console.log } = {})
{
    const results = [];

    for (const entry of bundlePlan(manifest))
    {
        const result = { scenario: entry.scenario, ...(await checkFixture(entry)) };

        results.push(result);
        log(`${entry.scenario} ${entry.fixture}: ${result.problems.length ? 'FAILED' : 'ok'} (${result.bytes} bytes, gzip ${result.gzipBytes}, ${result.inputModules} modules, ${result.pixiModules} from pixi.js)`);
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
