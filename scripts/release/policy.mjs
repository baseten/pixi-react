#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Offline release-policy check (issues 15, 40 and 62). Reads the workspace, release.packages.json,
 * .changeset/config.json and the pending release plan (`changeset status --output`), and fails on any violation of
 * design/release.md:
 *
 * 1. Classification: every workspace package is either publishable (release.packages.json `packages`) or never
 *    published (`neverPublished`, each private); Changesets ignores exactly the never-published set, puts exactly the
 *    publishable set in one `fixed` group (lockstep versions, issue 62), has no `linked` groups and never tags private
 *    packages.
 * 2. Manifests: a publishable package depends on another one only through `workspace:*` (published as the exact same
 *    version, never a `^` or `~` range), never on a never-published package; React, ReactDOM and pixi.js are peers,
 *    never dependencies; react-reconciler and its-fine are exact and only in the React adapters and the facade; the
 *    facade depends on no workspace package; every source version constant equals its package.json version; and
 *    publishing stays impossible until the owner enables it (modular packages private, the facade guarded by
 *    `prepublishOnly`).
 * 3. Lockstep: once the pending plan is applied, every publishable package is at one version, whose major is the Pixi
 *    major of the facade's pixi.js peer.
 * 4. ABI: every adapter's manifest ABI major equals CORE_ABI's (packages/core/src/abi.ts), and its ABI minor is not
 *    newer than CORE_ABI's (core rejects such an adapter at runtime). The ABI version is
 *    independent of the npm version. When CORE_ABI or an adapter's ABI declaration differs from the released one
 *    (`abi.released`), the lockstep group needs at least a minor release, and a changeset of at least minor level
 *    whose summary says "ABI" (the changelog note): an ABI break between core and the adapters may ship in a minor,
 *    because every package depends on the others at the exact same version. CORE_ABI's minor may not fall within a
 *    major.
 * 5. Release 1: while nothing has been released (`abi.released` is null) the plan must produce exactly the
 *    `release1` versions (8.1.0 for every package).
 * 6. Peers and generated files (issue 40, compat.mjs): the facade's react and pixi.js peers equal the compatibility
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
import { checkReleaseRules, pixiMajors } from './compat.mjs';
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

/**
 * Every ABI declaration in the source: `{ core: CORE_ABI, adapters: { [file]: [{ major, minor }, ...] } }`. version.mjs
 * records this as `abi.released`; a difference from it is an ABI change.
 */
export function readAbiDeclarations(root = repoRoot)
{
    const adapters = {};

    for (const file of ADAPTER_ABI_SOURCES)
    {
        const found = [...readFileSync(join(root, file), 'utf8').matchAll(/abi: Object\.freeze\(\{ major: (\d+)(?: as const)?, minor: (\d+) \}\)/g)];

        if (!found.length) throw new Error(`${file} declares no adapter ABI (abi: Object.freeze({ major, minor }))`);
        adapters[file] = found.map(([, abiMajor, abiMinor]) => ({ major: Number(abiMajor), minor: Number(abiMinor) }));
    }

    return { core: readCoreAbi(root), adapters };
}

const formatAbi = (abi) => `${abi.major}.${abi.minor}`;

/** What differs between the released ABI declarations and the current ones, as readable lines (empty: no change). */
export function abiChanges(released, current)
{
    const changes = [];

    if (formatAbi(released.core) !== formatAbi(current.core)) changes.push(`CORE_ABI ${formatAbi(released.core)} -> ${formatAbi(current.core)}`);
    for (const file of new Set([...Object.keys(released.adapters ?? {}), ...Object.keys(current.adapters)]))
    {
        const before = (released.adapters?.[file] ?? []).map(formatAbi).join(', ') || 'none';
        const after = (current.adapters[file] ?? []).map(formatAbi).join(', ') || 'none';

        if (before !== after) changes.push(`${file} ABI ${before} -> ${after}`);
    }

    return changes;
}

/**
 * Adapter ABI declarations core would reject at runtime (packages/core/src/abi.ts): another ABI major, or an ABI minor
 * newer than CORE_ABI's (the adapter would need methods this core does not implement).
 */
export function abiDeclarationProblems(abi)
{
    const problems = [];

    for (const [file, declared] of Object.entries(abi.adapters))
    {
        for (const item of declared)
        {
            if (item.major !== abi.core.major) problems.push(`${file} declares ABI major ${item.major}, core implements ${abi.core.major}`);
            else if (item.minor > abi.core.minor) problems.push(`${file} declares ABI ${formatAbi(item)}, but core implements only ${formatAbi(abi.core)}: core would reject the adapter (ABI_MISMATCH); raise CORE_ABI.minor with the new methods first`);
        }
    }

    return problems;
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
    const fixed = changesetConfig.fixed ?? [];
    const lockstep = config.packages.map((pkg) => pkg.workspaceName).sort();

    if (fixed.length !== 1 || JSON.stringify([...fixed[0]].sort()) !== JSON.stringify(lockstep)) fail(`.changeset/config.json "fixed" must be one group of exactly the publishable packages ${JSON.stringify(lockstep)} (lockstep versions), found ${JSON.stringify(fixed)}`);
    if ((changesetConfig.linked ?? []).length) fail('.changeset/config.json "linked" must be empty: the publishable packages are one "fixed" group');
    if (changesetConfig.privatePackages?.version !== true || changesetConfig.privatePackages?.tag !== false) fail('.changeset/config.json "privatePackages" must be { version: true, tag: false }: the modular packages stay private until publishing is enabled, and nothing is tagged');

    // 2. Manifests.
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
                if (publishable.has(name) && field !== 'peerDependencies' && spec !== 'workspace:*') fail(`${pkg.workspaceName}: ${field}.${name} is ${spec}; use "workspace:*" (published as the exact same version: install all packages at one version)`);
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

    // 3. Lockstep: one version for every publishable package once the plan is applied, on the Pixi major.
    const releases = new Map((plan?.releases ?? []).map((release) => [release.name, release]));
    const planned = new Map(config.packages.map((pkg) => [pkg.workspaceName, releases.get(pkg.workspaceName)?.newVersion ?? byName.get(pkg.workspaceName)?.manifest.version]));
    const versions = [...new Set(planned.values())];
    const facadePkg = config.packages.find((pkg) => pkg.facade);
    const version = planned.get(facadePkg.workspaceName);
    const pixiMajorsOfFacade = pixiMajors(byName.get(facadePkg.workspaceName)?.manifest.peerDependencies?.['pixi.js'] ?? '');

    if (versions.length > 1)
    {
        const off = [...planned].filter(([, value]) => value !== version).map(([name, value]) => `${name} ${value}`);

        fail(`lockstep: every publishable package must release at the facade's version ${version}, but ${off.join(', ')} (keep them in the "fixed" group and release them together)`);
    }
    if (pixiMajorsOfFacade.length !== 1 || major(version) !== pixiMajorsOfFacade[0]) fail(`lockstep: the packages would release ${version}, but their major must equal the Pixi major of the facade's pixi.js peer (${pixiMajorsOfFacade.join(', ') || 'none'})`);

    // 4. ABI: declarations agree with core; a change since the released ABI needs at least a minor lockstep release.
    const abi = readAbiDeclarations(root);
    const coreAbi = abi.core;

    problems.push(...abiDeclarationProblems(abi));
    const released = config.releasedAbi;
    const groupBump = Math.max(0, ...config.packages.map((pkg) => RANK[releases.get(pkg.workspaceName)?.type ?? 'none']));

    if (released && !released.core) fail('release.packages.json abi.released must be { core: { major, minor }, adapters: { [file]: [...] } } (written by scripts/release/version.mjs)');
    else if (released)
    {
        const changes = abiChanges(released, abi);
        const group = new Set(config.packages.map((pkg) => pkg.workspaceName));
        const noted = (plan?.changesets ?? []).some((changeset) => (/\bABI\b/).test(changeset.summary ?? '')
            && changeset.releases.some((release) => group.has(release.name) && RANK[release.type] >= RANK.minor));

        if (changes.length && groupBump < RANK.minor) fail(`the adapter ABI changed since the last release (${changes.join('; ')}): the lockstep packages need at least a minor changeset`);
        if (changes.length && !noted) fail(`the adapter ABI changed since the last release (${changes.join('; ')}): a changeset of at least minor level must document it in its summary (mention "ABI"), so the changelog warns that mixing versions may fail`);
        if (coreAbi.major === released.core.major && coreAbi.minor < released.core.minor) fail(`CORE_ABI minor fell from ${released.core.minor} to ${coreAbi.minor}: removing ABI methods is an ABI major change`);
    }
    else
    {
        // 5. Release 1.
        for (const pkg of config.packages)
        {
            if (pkg.release1 && planned.get(pkg.workspaceName) !== pkg.release1) fail(`Release 1: ${pkg.workspaceName} would release ${planned.get(pkg.workspaceName)}, expected ${pkg.release1}`);
        }
    }

    // 6. Peers and generated files.
    problems.push(...checkReleaseRules({ root, config, plan }), ...checkCompatibilityTable({ root }), ...checkDocsPins({ root }));

    return { problems, coreAbi, version, plan: (plan?.releases ?? []).filter((release) => release.type !== 'none').map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion })) };
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
    console.log(`\npolicy: ok (ABI ${result.coreAbi.major}.${result.coreAbi.minor}; every package at ${result.version} after the plan)`);
}
