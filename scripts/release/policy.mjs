#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Offline release-policy check (issue 15). Reads the workspace, release.packages.json, .changeset/config.json and the
 * pending release plan (`changeset status --output`), and fails on any violation of design/release.md:
 *
 * 1. Classification: every workspace package is either publishable (release.packages.json `packages`) or never
 *    published (`neverPublished`, each private); Changesets ignores exactly the never-published set, versions
 *    independently (no `fixed`/`linked` groups) and never tags private packages.
 * 2. Manifests: a publishable package depends on another one only through `workspace:^` (published as a caret range
 *    on the current version, so adapters share one core), never on a never-published package; React, ReactDOM and
 *    pixi.js are peers, never dependencies; react-reconciler and its-fine are exact and only in the React adapters
 *    and the facade; the facade depends on no workspace package; every source version constant equals its
 *    package.json version; and publishing stays impossible until the owner enables it (modular packages private,
 *    the facade guarded by `prepublishOnly`).
 * 3. ABI: core's major version is the ABI major (`CORE_ABI.major` in packages/core/src/abi.ts) once the pending plan
 *    is applied; every adapter's manifest ABI major equals it. When the plan bumps core's major (an ABI major change),
 *    every publishable package that depends on core needs its own explicit major changeset, so no adapter keeps a
 *    range on the previous ABI. An ABI minor increase since the released ABI needs at least a minor core release.
 * 4. Release 1: while nothing has been released (`abi.released` is null) the plan must produce exactly the
 *    `release1` versions (the facade 8.1.0, the modular packages 1.0.0).
 * 5. Peers and generated files (issue 40, compat.mjs): the facade's react and pixi.js peers equal the compatibility
 *    manifest's newest tested ranges, the Pixi range is the one the manifest's evidence supports, the facade's major
 *    equals the Pixi major, and the generated compatibility table and docs pins are current.
 *
 * Usage: node scripts/release/policy.mjs [--plan <changeset status JSON>]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseRules } from './compat.mjs';
import { checkCompatibilityTable } from './compat-table.mjs';
import { listWorkspace, loadReleaseConfig, readJson, repoRoot } from './config.mjs';
import { checkDocsPins } from './docs-pins.mjs';

const EXACT = /^\d+\.\d+\.\d+$/;
const PEERS = ['react', 'react-dom', 'pixi.js'];
const PINNED = ['react-reconciler', 'its-fine'];
const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** Source files that declare an adapter manifest's ABI, relative to the repository root. */
export const ADAPTER_ABI_SOURCES = ['packages/pixi-8/src/adapter.ts', 'packages/react-18/src/adapter.ts', 'packages/react-shared/src/react-19/adapter.ts'];

export function readCoreAbi(root = repoRoot)
{
    const match = readFileSync(join(root, 'packages/core/src/abi.ts'), 'utf8').match(/CORE_ABI = Object\.freeze\(\{ major: (\d+), minor: (\d+) \}/);

    if (!match) throw new Error('CORE_ABI = Object.freeze({ major, minor }) not found in packages/core/src/abi.ts');

    return { major: Number(match[1]), minor: Number(match[2]) };
}

/** `changeset status --output` for the current pending changesets. */
export function readPlan(root = repoRoot)
{
    const dir = mkdtempSync(join(tmpdir(), 'pixi-react-plan-'));

    try
    {
        execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', join(dir, 'plan.json')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

        return readJson(join(dir, 'plan.json'));
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
}

const major = (version) => Number(String(version).split('.')[0]);

/** Every policy violation for the workspace at `root` and the release `plan`. Pure apart from reading files. */
export function checkPolicy({ root = repoRoot, plan, config = loadReleaseConfig({ root }) })
{
    const problems = [];
    const fail = (message) => problems.push(message);
    const workspace = listWorkspace(root);
    const byName = new Map(workspace.map((pkg) => [pkg.name, pkg]));
    const publishable = new Map(config.packages.map((pkg) => [pkg.workspaceName, pkg]));
    const changesetConfig = readJson(join(root, '.changeset/config.json'));

    // 1. Classification and Changesets configuration.
    for (const pkg of workspace)
    {
        const isPublishable = publishable.has(pkg.name);
        const never = config.isNeverPublished(pkg.name);

        if (isPublishable && never) fail(`${pkg.name} is both publishable and never published`);
        if (!isPublishable && !never) fail(`${pkg.name} (${pkg.dir}) is not classified in release.packages.json`);
        if (never && !pkg.private) fail(`${pkg.name} is never published but not "private": true`);
        if (isPublishable && publishable.get(pkg.name).dir !== pkg.dir) fail(`${pkg.name} lives in ${pkg.dir}, release.packages.json says ${publishable.get(pkg.name).dir}`);
    }
    for (const pkg of config.packages) if (!byName.has(pkg.workspaceName)) fail(`release.packages.json lists ${pkg.workspaceName}, which is not in the workspace`);
    // The workspace root is never a Changesets package, so it is not in "ignore".
    const expectedIgnore = config.neverPublishedGlobs.filter((name) => byName.get(name)?.dir !== '.').sort();
    const actualIgnore = [...(changesetConfig.ignore ?? [])].sort();

    if (JSON.stringify(expectedIgnore) !== JSON.stringify(actualIgnore)) fail(`.changeset/config.json "ignore" must be exactly the never-published packages ${JSON.stringify(expectedIgnore)}, found ${JSON.stringify(actualIgnore)}`);
    if ((changesetConfig.fixed ?? []).length || (changesetConfig.linked ?? []).length) fail('.changeset/config.json must version independently: "fixed" and "linked" must be empty');
    if (changesetConfig.privatePackages?.version !== true || changesetConfig.privatePackages?.tag !== false) fail('.changeset/config.json "privatePackages" must be { version: true, tag: false }: the modular packages stay private until publishing is enabled, and nothing is tagged');

    // 2. Manifests.
    const coreAbi = readCoreAbi(root);

    for (const pkg of config.packages)
    {
        const manifest = byName.get(pkg.workspaceName)?.manifest;

        if (!manifest) continue;
        const isReactAdapter = (/^packages\/react-1\d/).test(pkg.dir);
        const deps = manifest.dependencies ?? {};

        for (const field of RUNTIME_FIELDS)
        {
            for (const [name, spec] of Object.entries(manifest[field] ?? {}))
            {
                if (config.isNeverPublished(name)) fail(`${pkg.workspaceName}: ${field} names never-published ${name}`);
                if (publishable.has(name) && field !== 'peerDependencies' && spec !== 'workspace:^') fail(`${pkg.workspaceName}: ${field}.${name} is ${spec}; use "workspace:^" (published as ^<version>, one ABI major)`);
                if (publishable.has(name) && field === 'peerDependencies') fail(`${pkg.workspaceName}: ${name} must be a dependency, not a peer`);
            }
        }
        for (const name of PEERS) if (deps[name]) fail(`${pkg.workspaceName}: ${name} is a dependency; it must be a peer`);
        for (const name of PINNED)
        {
            if (!deps[name])
            {
                if (isReactAdapter) fail(`${pkg.workspaceName}: React adapter without an exact ${name} dependency`);
                continue;
            }
            if (!isReactAdapter && !pkg.facade) fail(`${pkg.workspaceName}: only the React adapters and the facade depend on ${name}`);
            if (!EXACT.test(deps[name])) fail(`${pkg.workspaceName}: ${name} is ${deps[name]}; it must be exact`);
        }
        if (pkg.facade)
        {
            const internal = Object.keys(deps).filter((name) => byName.has(name));

            if (internal.length) fail(`the facade has runtime dependencies on workspace packages: ${internal.join(', ')} (they must stay devDependencies, bundled at build time)`);
            if (!String(manifest.scripts?.prepublishOnly ?? '').includes('scripts/release/guard-publish.mjs') && !config.publishEnabled) fail('the facade must keep the "prepublishOnly" publish guard while publishing is disabled');
        }
        else if (manifest.private !== true && !config.publishEnabled) fail(`${pkg.workspaceName} must stay "private": true while publishing is disabled`);
        for (const field of ['files', 'exports', 'license']) if (!manifest[field]) fail(`${pkg.workspaceName}: package.json has no "${field}"`);
        if (pkg.versionConstant)
        {
            const source = readFileSync(join(root, pkg.dir, pkg.versionConstant.file), 'utf8');
            const found = source.match(new RegExp(pkg.versionConstant.pattern));

            if (!found) fail(`${pkg.workspaceName}: ${pkg.versionConstant.file} has no version constant matching ${pkg.versionConstant.pattern}`);
            else if (found.groups.version !== manifest.version) fail(`${pkg.workspaceName}: ${pkg.versionConstant.file} says ${found.groups.version}, package.json says ${manifest.version} (run scripts/release/version.mjs, not "changeset version" alone)`);
        }
    }

    // 3. ABI.
    for (const file of ADAPTER_ABI_SOURCES)
    {
        for (const [, abiMajor] of readFileSync(join(root, file), 'utf8').matchAll(/abi: Object\.freeze\(\{ major: (\d+)/g))
        {
            if (Number(abiMajor) !== coreAbi.major) fail(`${file} declares ABI major ${abiMajor}, core implements ${coreAbi.major}`);
        }
    }
    const releases = new Map((plan?.releases ?? []).map((release) => [release.name, release]));
    const explicit = new Map();

    for (const changeset of plan?.changesets ?? [])
    {
        for (const release of changeset.releases) explicit.set(release.name, Math.max(explicit.get(release.name) ?? 0, RANK[release.type]));
    }
    const corePkg = config.packages.find((pkg) => pkg.dir === 'packages/core');
    const coreRelease = releases.get(corePkg.workspaceName);
    const coreVersion = coreRelease?.newVersion ?? byName.get(corePkg.workspaceName).manifest.version;
    const coreBump = coreRelease?.type ?? 'none';

    if (major(coreVersion) !== coreAbi.major) fail(`core will be ${coreVersion}, but its major must equal the ABI major ${coreAbi.major} (CORE_ABI): ${coreRelease ? 'change the core changeset' : 'add a core changeset'}`);
    const dependents = config.packages.filter((pkg) => Object.keys(byName.get(pkg.workspaceName)?.manifest.dependencies ?? {}).includes(corePkg.workspaceName));

    if (coreBump === 'major')
    {
        for (const pkg of dependents)
        {
            if ((explicit.get(pkg.workspaceName) ?? 0) < RANK.major) fail(`core's major changes (ABI ${coreAbi.major}): ${pkg.workspaceName} depends on core and needs its own major changeset, so its range moves to the new ABI with an explicit release`);
        }
    }
    const released = config.releasedAbi;

    if (released)
    {
        if (coreAbi.major !== released.major && coreBump !== 'major') fail(`CORE_ABI is ${coreAbi.major}.${coreAbi.minor} but ABI ${released.major}.${released.minor} was released: an ABI major change needs a major core changeset`);
        if (coreAbi.major === released.major && coreAbi.minor > released.minor && RANK[coreBump] < RANK.minor) fail(`CORE_ABI minor rose to ${coreAbi.minor} (released ${released.minor}): core needs at least a minor changeset`);
        if (coreAbi.major === released.major && coreAbi.minor < released.minor) fail(`CORE_ABI minor fell from ${released.minor} to ${coreAbi.minor}: removing ABI methods is an ABI major change`);
    }
    else
    {
        // 4. Release 1.
        for (const pkg of config.packages)
        {
            const release = releases.get(pkg.workspaceName);
            const planned = release?.newVersion ?? byName.get(pkg.workspaceName)?.manifest.version;

            if (pkg.release1 && planned !== pkg.release1) fail(`Release 1: ${pkg.workspaceName} would release ${planned}, expected ${pkg.release1}`);
        }
    }

    // 5. Peers and generated files.
    problems.push(...checkReleaseRules({ root, config, plan }), ...checkCompatibilityTable({ root }), ...checkDocsPins({ root }));

    return { problems, coreAbi, coreVersion, plan: (plan?.releases ?? []).filter((release) => release.type !== 'none').map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion })) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const args = process.argv.slice(2);
    const index = args.indexOf('--plan');
    const plan = index >= 0 ? readJson(resolve(args[index + 1])) : readPlan();
    const result = checkPolicy({ plan });

    for (const release of result.plan) console.log(`plan: ${release.name} ${release.oldVersion} -> ${release.newVersion} (${release.type})`);
    if (result.problems.length)
    {
        console.error(`\nRelease policy violations:\n  - ${result.problems.join('\n  - ')}`);
        process.exit(1);
    }
    console.log(`\npolicy: ok (ABI ${result.coreAbi.major}.${result.coreAbi.minor}; core ${result.coreVersion} after the plan)`);
}
