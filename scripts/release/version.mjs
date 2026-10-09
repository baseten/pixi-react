#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * The release "version" step (issue 15): use this instead of `changeset version` alone.
 *
 * 1. Checks the release policy against the pending plan (policy.mjs) and stops on any violation.
 * 2. Runs `changeset version`, which consumes the changesets, bumps package.json versions and writes CHANGELOG.md.
 * 3. Copies each new version into the source constant the adapter manifests report (release.packages.json
 *    `versionConstant`), which `changeset version` cannot see; each package's unit test keeps them equal.
 * 4. Records the ABI this release implements as `abi.released` in release.packages.json, the baseline the next
 *    policy check compares CORE_ABI against.
 * 5. Regenerates the release compatibility table (compat-table.mjs) and the docs pins (docs-pins.mjs) for the new
 *    versions, so the "Version packages" commit carries them.
 *
 * It never builds, packs or publishes. Usage: node scripts/release/version.mjs [--root <checkout>]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCompatibilityTable } from './compat-table.mjs';
import { loadReleaseConfig, readJson, repoRoot } from './config.mjs';
import { writeDocsPins } from './docs-pins.mjs';
import { checkPolicy, readCoreAbi, readPlan } from './policy.mjs';

export function syncVersionConstants(root, config = loadReleaseConfig({ root }))
{
    const changed = [];

    for (const pkg of config.packages.filter((item) => item.versionConstant))
    {
        const { version } = readJson(join(root, pkg.dir, 'package.json'));
        const file = join(root, pkg.dir, pkg.versionConstant.file);
        const source = readFileSync(file, 'utf8');
        const pattern = new RegExp(pkg.versionConstant.pattern);
        const match = source.match(pattern);

        if (!match) throw new Error(`${pkg.dir}/${pkg.versionConstant.file}: no match for ${pkg.versionConstant.pattern}`);
        if (match.groups.version === version) continue;
        writeFileSync(file, source.replace(pattern, (text) => text.replace(match.groups.version, version)));
        changed.push(`${pkg.dir}/${pkg.versionConstant.file}: ${match.groups.version} -> ${version}`);
    }

    return changed;
}

export function recordReleasedAbi(root)
{
    const file = join(root, 'release.packages.json');
    const raw = readJson(file);
    const abi = readCoreAbi(root);

    raw.abi.released = abi;
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);

    return abi;
}

export function version(root = repoRoot, { log = console.log } = {})
{
    const before = checkPolicy({ root, plan: readPlan(root), config: loadReleaseConfig({ root }) });

    if (before.problems.length) throw new Error(`release policy violations; nothing was versioned:\n  - ${before.problems.join('\n  - ')}`);
    execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const line of syncVersionConstants(root)) log(`version constant: ${line}`);
    const abi = recordReleasedAbi(root);

    log(`released ABI recorded: ${abi.major}.${abi.minor}`);
    log(`generated: ${writeCompatibilityTable({ root })}`);
    for (const file of writeDocsPins({ root })) log(`docs pins: ${file}`);

    return before.plan;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    const args = process.argv.slice(2);
    const index = args.indexOf('--root');
    const root = resolve(index >= 0 ? args[index + 1] : repoRoot);

    for (const release of version(root)) console.log(`versioned ${release.name}: ${release.oldVersion} -> ${release.newVersion}`);
}
