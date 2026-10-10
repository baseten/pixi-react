#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * The full release dry run (issue 15), in a disposable checkout. It never publishes and never touches this checkout.
 *
 * 1. Copies the working tree (tracked and untracked, not ignored files) to `<work>/checkout`, makes it a one-commit
 *    git repository on `main` (Changesets reads git), and installs it from the lockfile (`--frozen-lockfile`).
 * 2. `changeset status --output`: the release plan before versioning.
 * 3. `scripts/release/version.mjs`: policy check, `changeset version`, version constants, released ABI.
 * 4. Checks the result: every package at its planned version, the changesets consumed, a CHANGELOG per released
 *    package, and the policy clean against the now-empty plan. With no release planned (no pending changesets: any
 *    pull request without one, and main after a release) nothing is versioned or committed; the checkout must be
 *    unchanged and the policy clean, and the steps below run on the current versions. When the source is an
 *    already-versioned release commit (policy.mjs `releaseState`, decided against the source's history), it also
 *    checks abi.released and every CHANGELOG, and stages the versioned packages.
 * 5. `pnpm build`, then stage.mjs (tarballs with public names), inspect.mjs, consumers.mjs and bundles.mjs.
 *
 * Usage: node scripts/release/dry-run.mjs [--work <dir>] [--namespace target|fallback] [--keep]
 * Output: `<work>/tarballs` (tarballs, release-manifest.json, consumers.json, bundles.json, dry-run.json, dry-run.md).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadReleaseConfig, outputDirProblem, readJson, repoRoot, resetOutputDir } from './config.mjs';
import { releaseState, versionedProblems } from './policy.mjs';

const args = process.argv.slice(2);
const option = (name) =>
{
    const index = args.indexOf(name);

    return index >= 0 ? args[index + 1] : undefined;
};
const work = resolve(option('--work') ?? join(tmpdir(), 'pixi-react-release-dry-run'));
const unsafeWork = outputDirProblem(work);

if (unsafeWork)
{
    console.error(`refusing --work: ${unsafeWork}`);
    process.exit(1);
}
const namespace = option('--namespace');
const checkout = join(work, 'checkout');
const tarballs = join(work, 'tarballs');
const env = { ...process.env, HUSKY: '0', CI: 'true', PIXI_REACT_RELEASE_CONSUMERS: process.env.PIXI_REACT_RELEASE_CONSUMERS ?? join(work, 'consumers'), ...(namespace ? { PIXI_REACT_RELEASE_NAMESPACE: namespace } : {}) };
// The disposable checkout is a one-commit repository, so whether the source is an already-versioned release commit
// (every package above main, changesets consumed) is decided here, against the source's own history.
const sourceState = releaseState(repoRoot);
const report = { started: new Date().toISOString(), source: repoRoot, checkout, namespace: namespace ?? loadReleaseConfig().namespace, versionedRelease: sourceState.versioned ? sourceState.version : null, steps: [] };

/** Per-command identity for the disposable repository only; no git configuration is written. */
const IDENTITY = ['-c', 'user.name=release dry run', '-c', 'user.email=release-dry-run@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

function sh(command, commandArgs, options = {})
{
    return execFileSync(command, commandArgs, { cwd: checkout, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...options });
}

function step(name, fn)
{
    const started = Date.now();

    console.log(`\n== ${name}`);
    try
    {
        const detail = fn();

        report.steps.push({ name, ok: true, seconds: Math.round((Date.now() - started) / 1000), detail });

        return detail;
    }
    catch (error)
    {
        const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n').trim();

        report.steps.push({ name, ok: false, seconds: Math.round((Date.now() - started) / 1000), detail: detail.slice(0, 8000) });
        console.error(detail);
        finish(1);
    }

    return undefined;
}

function finish(code)
{
    report.finished = new Date().toISOString();
    mkdirSync(tarballs, { recursive: true });
    writeFileSync(join(tarballs, 'dry-run.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!args.includes('--keep') && code === 0) rmSync(checkout, { recursive: true, force: true });
    console.log(`\ndry run ${code === 0 ? 'passed' : 'FAILED'}; report: ${join(tarballs, 'dry-run.json')}`);
    process.exit(code);
}

step('disposable checkout', () =>
{
    // Versions bumped above main, but published inputs changed (or a branch was merged) after the version commit.
    if (sourceState.blocked.length) throw new Error(`the source is not a releasable state:\n  - ${sourceState.blocked.join('\n  - ')}`);
    resetOutputDir(work);
    mkdirSync(checkout, { recursive: true });
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
    let copied = 0;

    for (const file of files)
    {
        if (!existsSync(join(repoRoot, file))) continue;
        mkdirSync(dirname(join(checkout, file)), { recursive: true });
        cpSync(join(repoRoot, file), join(checkout, file));
        copied += 1;
    }
    sh('git', ['init', '-q', '-b', 'main']);
    sh('git', ['add', '-A']);
    sh('git', [...IDENTITY, 'commit', '-q', '-m', 'release dry run snapshot']);
    sh('pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);

    return `${copied} files; pnpm install --frozen-lockfile`;
});

const plan = step('changeset status (release plan)', () =>
{
    sh('pnpm', ['exec', 'changeset', 'status', '--output', join(work, 'plan.json')]);
    const status = readJson(join(work, 'plan.json'));
    const releases = status.releases.filter((release) => release.type !== 'none').map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion }));

    for (const release of releases) console.log(`  ${release.name}: ${release.oldVersion} -> ${release.newVersion} (${release.type})`);

    return { changesets: status.changesets.map((changeset) => changeset.id), releases };
});

step('version (policy, changeset version, version constants, released ABI)', () =>
{
    const output = sh(process.execPath, ['scripts/release/version.mjs']);

    console.log(output.trim().replace(/^/gm, '  '));

    return output.trim().split('\n');
});

step('verify the versioned checkout', () =>
{
    const problems = [];
    const config = loadReleaseConfig({ root: checkout });

    for (const release of plan.releases)
    {
        const pkg = config.byWorkspaceName.get(release.name);
        const manifest = readJson(join(checkout, pkg.dir, 'package.json'));

        if (manifest.version !== release.newVersion) problems.push(`${release.name} is ${manifest.version}, planned ${release.newVersion}`);
        if (!existsSync(join(checkout, pkg.dir, 'CHANGELOG.md'))) problems.push(`${release.name} has no CHANGELOG.md`);
    }
    const left = readdirSync(join(checkout, '.changeset')).filter((file) => file.endsWith('.md') && file !== 'README.md');

    if (left.length) problems.push(`changesets not consumed: ${left.join(', ')}`);
    const diff = sh('git', ['status', '--short']).trim();

    if (!plan.releases.length && diff) problems.push(`no release was planned, but versioning changed the checkout:\n${diff}`);
    if (problems.length) throw new Error(problems.join('\n'));
    if (plan.releases.length)
    {
        // The "Version packages" commit of the real flow; Changesets compares later status runs against it.
        sh('git', ['add', '-A']);
        sh('git', [...IDENTITY, 'commit', '-q', '-m', 'Version packages (dry run)']);
    }
    else if (sourceState.versioned)
    {
        // An already-versioned release commit: check what `pnpm release:version` must have left, then stage it.
        const versioned = versionedProblems({ root: checkout, config, version: sourceState.version });

        if (versioned.length) throw new Error(versioned.join('\n'));
        console.log(`  already-versioned release commit at ${sourceState.version}: abi.released and every CHANGELOG are current; staging the versioned packages`);
    }
    else console.log('  no release planned: nothing versioned, nothing to commit; staging the current versions');
    const policy = sh(process.execPath, ['scripts/release/policy.mjs']);

    console.log(diff.replace(/^/gm, '  '));
    console.log(policy.trim().split('\n').pop());

    return { releasePlanned: plan.releases.length > 0, changed: diff ? diff.split('\n') : [], policy: policy.trim().split('\n').pop() };
});

step('build', () =>
{
    sh('pnpm', ['build']);

    return 'pnpm build';
});

step('stage tarballs', () => sh(process.execPath, ['scripts/release/stage.mjs', '--out', tarballs, ...(namespace ? ['--namespace', namespace] : [])]).trim().split('\n'));

step('inspect tarballs', () =>
{
    const output = sh(process.execPath, ['scripts/release/inspect.mjs', '--tarballs', tarballs]);

    console.log(output.trim());

    return output.trim().split('\n');
});

step('packed consumers', () =>
{
    const output = sh(process.execPath, ['scripts/release/consumers.mjs', '--tarballs', tarballs], { stdio: ['ignore', 'pipe', 'inherit'] });

    console.log(output.trim());

    return readJson(join(tarballs, 'consumers.json')).map((item) => ({ id: item.id, ok: item.ok, steps: item.steps.map((entry) => `${entry.name}: ${entry.ok ? 'ok' : 'FAILED'}`) }));
});

step('bundle assertions', () =>
{
    const output = sh(process.execPath, ['scripts/release/bundles.mjs', '--tarballs', tarballs]);

    console.log(output.trim());

    return output.trim().split('\n');
});

const manifest = readJson(join(tarballs, 'release-manifest.json'));
const ours = new Set(manifest.packages.map((entry) => entry.publicName));
const lines = [
    `# Release dry run (${report.namespace} namespace)`,
    '',
    `Source: ${repoRoot} at ${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()} (plus uncommitted changes)`,
    '',
    '## Release plan',
    '',
    ...(plan.releases.length
        ? plan.releases.map((release) => `- \`${release.name}\` ${release.oldVersion} → ${release.newVersion} (${release.type})`)
        : [sourceState.versioned
            ? `Already-versioned release commit (every package at ${sourceState.version}, above main; the changesets were consumed): nothing was versioned again. The tarballs, consumers and bundles below are the versioned packages.`
            : 'No release planned (no pending changesets): nothing was versioned. The tarballs, consumers and bundles below are the current versions.']),
    '',
    '## Tarballs',
    '',
    ...manifest.packages.map((entry) => `- \`${entry.file}\` \`${entry.publicName}@${entry.version}\` (${entry.workspaceName}), ${entry.size} bytes, ${entry.sha512.slice(0, 22)}…, private: ${entry.private}`),
    '',
    '## Dependencies between our packages (lockstep: exact versions)',
    '',
    `Versions: ${[...new Set(manifest.packages.map((entry) => entry.version))].join(', ')}`,
    '',
    ...manifest.packages.flatMap((entry) => Object.entries(entry.dependencies).filter(([name]) => ours.has(name)).map(([name, spec]) => `- \`${entry.publicName}@${entry.version}\` → \`${name}@${spec}\``)),
    '',
    `Consumers and bundles: see consumers.json and bundles.json in ${tarballs}.`,
];

writeFileSync(join(tarballs, 'dry-run.md'), `${lines.join('\n')}\n`);
finish(0);
