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
 * 7. An already-versioned release commit (no pending changeset, every package above its version on main): the plan is
 *    empty instead of `changeset status` (which fails there), and abi.released and the CHANGELOGs must be current.
 *
 * Usage: node scripts/release/policy.mjs [--plan <changeset status JSON>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
export const ADAPTER_ABI_SOURCES = ['packages/pixi-8/src/adapter.ts', 'packages/pixi-7/src/adapter.ts', 'packages/react-18/src/adapter.ts', 'packages/react-shared/src/react-19/adapter.ts'];

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

/**
 * `changeset status --output` for the current pending changesets. Changesets runs it against `main` (the merge base
 * with HEAD) and exits non-zero when a publishable package changed with no pending changeset; that and every other
 * failure is rethrown with Changesets' own message and what to do. Use `currentPlan`, which first recognizes an
 * already-versioned release commit (where `status` would always fail, because `version` consumed the changesets).
 */
export function readPlan(root = repoRoot)
{
    const dir = mkdtempSync(join(tmpdir(), 'pixi-react-plan-'));

    try
    {
        execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', join(dir, 'plan.json')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

        return readJson(join(dir, 'plan.json'));
    }
    catch (error)
    {
        const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
        let hint = 'See the output above.';

        if ((/no changesets were found/i).test(output)) hint = 'A publishable package changed since main, but no changeset is pending and the versions were not bumped by `pnpm release:version`. Add one with `pnpm changeset` (design/release.md, release procedure).';
        else if ((/diverged|Does "?main"? exist/i).test(output)) hint = 'Changesets compares against the local branch `main`; create it (for example `git branch main origin/main`) or fetch the full history.';

        throw new Error(`changeset status failed, so the release plan is unknown:\n${output || error.message}\n${hint}`);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
}

const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0 or 1 for two plain `x.y.z` versions. */
export function compareVersions(a, b)
{
    const [x, y] = [a, b].map((version) => PLAIN_VERSION.exec(version)?.slice(1).map(Number) ?? [0, 0, 0]);

    for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return x[index] < y[index] ? -1 : 1;

    return 0;
}

/**
 * Whether the checkout is an already-versioned release commit (`pnpm release:version` ran and its result was
 * committed): every publishable package's version above its version at `base` (the merge base with main), no pending
 * changeset, and nothing that ships changed after that version commit. Pure: `baseVersions` is null when there is no
 * base to compare with, and `afterVersion` (from `versionCommitHistory`) says what happened after the version commit:
 * `{ commit, merges, changed }`, or null when the version commit could not be found.
 *
 * - `versioned: true`: the versioning result itself; `changeset status` is skipped.
 * - `blocked` non-empty: the versions were bumped, but published inputs changed after the version commit, or a branch
 *   was merged in after it. Such a checkout is neither a release nor an ordinary change, and the policy fails it.
 * - otherwise (`reasons`): an ordinary checkout, whose plan comes from `changeset status`.
 */
export function classifyReleaseState({ pendingChangesets, currentVersions, baseVersions, afterVersion = null })
{
    // `reasons`: why the versions were not bumped above main. Pending changesets are not such a reason: on a branch whose
    // versions were bumped they mean something (main's next change, in a pull request's merge commit) arrived after the
    // versioning, which blocks it rather than making it an ordinary checkout.
    const reasons = [];

    if (!baseVersions) reasons.push('there is no merge base with main to compare versions with');
    else
    {
        for (const [name, version] of Object.entries(currentVersions))
        {
            const before = baseVersions[name];

            if (before !== undefined && compareVersions(version, before) <= 0) reasons.push(`${name} is ${version}, not above its ${before} on main`);
        }
    }
    const versions = [...new Set(Object.values(currentVersions))];
    const version = versions.length === 1 ? versions[0] : null;
    const blocked = [];

    if (!reasons.length)
    {
        const at = afterVersion?.commit ? `the version commit ${afterVersion.commit.slice(0, 12)}` : 'the versioning';

        if (!afterVersion) blocked.push('the versions are above main, but no commit since the merge base moved them there');
        // Recovery never rewrites history and never needs a revert: the changesets were consumed only on the release
        // branch, so main still has them, and a fresh release branch from main can be versioned again.
        const fresh = 'cut a new release branch from main and run pnpm release:version there (main still has the changesets)';

        if (pendingChangesets.length) blocked.push(`changesets are pending (${pendingChangesets.join(', ')}) on top of ${at}, so the versioned release does not include them; ${fresh}`);
        for (const merge of afterVersion?.merges ?? []) blocked.push(`${merge.slice(0, 12)} merged another branch into the release branch after ${at}, so the versioned release no longer matches what it ships; ${fresh}`);
        if (afterVersion?.changed?.length) blocked.push(`published packages changed after ${at}: ${afterVersion.changed.join(', ')}; land the change on main with a changeset, then ${fresh}`);
    }

    return { versioned: !reasons.length && !blocked.length, version, reasons, blocked };
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).trim();

/**
 * The merge base of HEAD with main: with `main` and `origin/main` both present, the more recent of the two merge bases,
 * so a stale local `main` (one never updated since the clone) cannot make an ordinary branch look versioned. Null
 * outside a repository with either.
 */
export function mainMergeBase(root = repoRoot)
{
    const bases = [];

    for (const ref of ['main', 'origin/main'])
    {
        try
        {
            bases.push(git(root, ['merge-base', ref, 'HEAD']));
        }
        catch
        {
            // That ref is missing.
        }
    }
    if (bases.length < 2 || bases[0] === bases[1]) return bases[0] ?? null;
    const isAncestor = (a, b) =>
    {
        try
        {
            git(root, ['merge-base', '--is-ancestor', a, b]);

            return true;
        }
        catch
        {
            return false;
        }
    };

    return isAncestor(bases[0], bases[1]) ? bases[1] : bases[0];
}

/**
 * Paths whose change after the version commit would ship unversioned: every publishable package directory, the
 * private react-shared bundled into the React adapters, the build and release scripts, and the files that decide what
 * is installed and how it is named. Each package's CHANGELOG.md may still be edited.
 */
export function publishedInputs(config)
{
    const dirs = [...config.packages.map((pkg) => `${pkg.dir}/`), 'packages/react-shared/', 'scripts/'];
    // .nvmrc selects the Node runtime the dry run builds and stages with.
    const files = ['release.packages.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.nvmrc'];
    const changelogs = new Set(config.packages.map((pkg) => `${pkg.dir}/CHANGELOG.md`));

    return (path) => !changelogs.has(path) && (files.includes(path) || dirs.some((dir) => path.startsWith(dir)));
}

/** The publishable packages' versions at a git revision (a package missing there is left out). */
function versionsAt(root, rev, config)
{
    const versions = {};

    for (const pkg of config.packages)
    {
        try
        {
            versions[pkg.workspaceName] = JSON.parse(git(root, ['show', `${rev}:${pkg.dir}/package.json`])).version;
        }
        catch
        {
            // Not in that revision.
        }
    }

    return versions;
}

const sameVersions = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * What happened after the version commit: the newest commit on HEAD's first-parent history since `base` whose first
 * parent had other package versions than the current ones. A merge whose first parent lacks the versions but whose
 * second parent has them (the merge commit CI checks out for a pull request, or a merge-queue commit) is followed into
 * its second parent; any other merge after the version commit is reported. `changed` lists the published inputs
 * changed from the version commit to HEAD (including what a synthetic merge brought in from main), plus staged,
 * unstaged and untracked ones.
 * Versions that are only in the working tree (release:version ran, not yet committed) count as the versioning itself.
 */
export function versionCommitHistory(root, { base, config, currentVersions })
{
    const shipped = publishedInputs(config);
    const merges = [];
    let tip = 'HEAD';

    if (!sameVersions(versionsAt(root, 'HEAD', config), currentVersions)) return { commit: null, merges, changed: [] };
    for (let depth = 0; depth < 20; depth += 1)
    {
        const lines = git(root, ['rev-list', '--first-parent', '--parents', `${base}..${tip}`]).split('\n').filter(Boolean);
        let descend = null;

        for (const line of lines)
        {
            const [commit, first, second] = line.split(' ');

            if (sameVersions(versionsAt(root, first, config), currentVersions))
            {
                if (second) merges.push(commit);
                continue;
            }
            if (second && sameVersions(versionsAt(root, second, config), currentVersions))
            {
                descend = second;
                break;
            }
            // Always compare the version commit with the real HEAD, never only the branch it was found on: in the merge
            // commit CI checks out for a pull request, main's side can carry published inputs the versioning never saw.
            // `git diff HEAD` covers staged and unstaged edits alike; untracked files are listed separately.
            const changed = [
                ...git(root, ['diff', '--name-only', commit, 'HEAD']).split('\n'),
                ...git(root, ['diff', '--name-only', 'HEAD']).split('\n'),
                ...git(root, ['ls-files', '--others', '--exclude-standard']).split('\n'),
            ];

            return { commit, merges, changed: [...new Set(changed.filter((path) => path && shipped(path)))].sort() };
        }
        if (!descend) return null;
        tip = descend;
    }

    return null;
}

/** `classifyReleaseState` for the checkout at `root`, reading the base versions and the history from git. */
export function releaseState(root = repoRoot, { config = loadReleaseConfig({ root }), base = mainMergeBase(root) } = {})
{
    const pendingChangesets = readdirSync(join(root, '.changeset')).filter((file) => file.endsWith('.md') && file !== 'README.md');
    const currentVersions = Object.fromEntries(config.packages.map((pkg) => [pkg.workspaceName, readJson(join(root, pkg.dir, 'package.json')).version]));
    const baseVersions = base ? versionsAt(root, base, config) : null;
    // Whether the versions were bumped above main, before looking at history or pending changesets.
    const looksVersioned = classifyReleaseState({ pendingChangesets: [], currentVersions, baseVersions, afterVersion: { commit: null, merges: [], changed: [] } }).versioned;
    const afterVersion = looksVersioned ? versionCommitHistory(root, { base, config, currentVersions }) : null;

    return { ...classifyReleaseState({ pendingChangesets, currentVersions, baseVersions, afterVersion }), base, versionCommit: afterVersion?.commit ?? null };
}

/** An empty plan: nothing pending. */
export const EMPTY_PLAN = Object.freeze({ changesets: [], releases: [] });

/**
 * The release plan of the checkout: empty for an already-versioned release commit (`changeset status` would fail
 * there: the manifests changed and the changesets are consumed), otherwise `changeset status`. Returns the state too.
 */
export function currentPlan(root = repoRoot, options = {})
{
    const state = releaseState(root, options);

    if (state.blocked.length) throw new Error(`the versions are bumped above main, but this is not the versioning result itself:\n  - ${state.blocked.join('\n  - ')}`);

    return { state, plan: state.versioned ? EMPTY_PLAN : readPlan(root) };
}

/**
 * What a versioned release commit must also hold, beyond the policy on an empty plan (which checks lockstep, the
 * Pixi major, exact dependencies, version constants and the generated table and pins): the released ABI recorded and
 * current, and a CHANGELOG entry for the release version in every package.
 */
export function versionedProblems({ root = repoRoot, config, version })
{
    const problems = [];
    const current = readAbiDeclarations(root);

    if (!config.releasedAbi?.core) problems.push('versioned release: release.packages.json abi.released is not recorded (run pnpm release:version, not changeset version alone)');
    else
    {
        const changes = abiChanges(config.releasedAbi, current);

        if (changes.length) problems.push(`versioned release: abi.released differs from the source (${changes.join('; ')}); cut a new release branch from main and run pnpm release:version there`);
    }
    for (const pkg of config.packages)
    {
        const file = join(root, pkg.dir, 'CHANGELOG.md');
        const text = existsSync(file) ? readFileSync(file, 'utf8') : '';

        if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}\\s*$`, 'm').test(text)) problems.push(`versioned release: ${pkg.dir}/CHANGELOG.md has no "## ${version}" entry`);
    }

    return problems;
}

const major = (version) => Number(String(version).split('.')[0]);

/** Every policy violation for the workspace at `root` and the release `plan`. Pure apart from reading files. */
export function checkPolicy({ root = repoRoot, plan, config = loadReleaseConfig({ root }), state = null })
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

    // 7. An already-versioned release commit (currentPlan): the released ABI and the changelogs.
    if (state?.versioned) problems.push(...versionedProblems({ root, config, version }));

    return { problems, coreAbi, version, plan: (plan?.releases ?? []).filter((release) => release.type !== 'none').map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion })) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const args = process.argv.slice(2);
    const index = args.indexOf('--plan');
    let current;

    try
    {
        current = index >= 0 ? { state: null, plan: readJson(resolve(args[index + 1])) } : currentPlan();
    }
    catch (error)
    {
        console.error(error.message);
        process.exit(1);
    }
    const result = checkPolicy({ plan: current.plan, state: current.state });

    if (current.state?.versioned) console.log(`versioned release commit: every package is at ${current.state.version}, above main; changeset status is skipped (the changesets were consumed)`);

    for (const release of result.plan) console.log(`plan: ${release.name} ${release.oldVersion} -> ${release.newVersion} (${release.type})`);
    if (result.problems.length)
    {
        console.error(`\nRelease policy violations:\n  - ${result.problems.join('\n  - ')}`);
        process.exit(1);
    }
    console.log(`\npolicy: ok (ABI ${result.coreAbi.major}.${result.coreAbi.minor}; every package at ${result.version} after the plan)`);
}
