#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * The generated release compatibility table (issue 40): facade version -> tested React and pixi.js ranges, plus the
 * modular package versions. Generated from design/compatibility/seed.json and release.packages.json; nothing in it is
 * written by hand. policy.mjs (and so `pnpm test:release` and the dry run) fails while the checked-in file is stale.
 *
 * Usage: node scripts/release/compat-table.mjs [--write | --check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../design/compatibility/cells/matrix.mjs';
import { currentRecords, loadRecords, recordGate, recordId } from '../../design/compatibility/verification.mjs';
import { committedConfig, loadSeedAt, releaseFacts, UPSTREAM_ROW } from './compat.mjs';
import { repoRoot } from './config.mjs';

export const TABLE_FILE = 'design/release-compatibility.md';

const code = (text) => `\`${String(text).replaceAll('|', '\\|')}\``;
const BACKEND_LABEL = { webgl: 'WebGL', webgpu: 'WebGPU' };

/** `8.2.6 … 8.22.0 (21 versions)`, or the versions themselves when there are at most three. */
function versionSpan(versions)
{
    const sorted = [...new Set(versions)].sort(compareVersions);

    return sorted.length <= 3 ? sorted.join(', ') : `${sorted[0]} … ${sorted.at(-1)} (${sorted.length} versions)`;
}

/**
 * What the dated verification records verified for a package, per render backend, as exact pairings: per Pixi adapter,
 * the React versions that share the same set of verified pixi.js versions, with that set. Sparse evidence is never
 * widened into a cross product. `not verified` for a backend without a verified tuple.
 */
export function verifiedLabel(verified, backends, applicable = backends)
{
    const parts = backends.map((backend) =>
    {
        const tuples = verified?.backends[backend] ?? [];

        if (!applicable.includes(backend)) return `${BACKEND_LABEL[backend] ?? backend}: not applicable`;

        if (!tuples.length) return `${BACKEND_LABEL[backend] ?? backend}: not verified`;
        // Pixi adapter -> React version -> the pixi.js versions verified with it.
        const byAdapter = new Map();

        for (const tuple of tuples)
        {
            const reacts = byAdapter.get(tuple.pixiAdapter) ?? new Map();

            reacts.set(tuple.react, new Set([...(reacts.get(tuple.react) ?? []), tuple.pixi]));
            byAdapter.set(tuple.pixiAdapter, reacts);
        }
        const statements = [];

        for (const reacts of byAdapter.values())
        {
            // React versions with an identical pixi.js set share one statement; every pair it names is verified.
            const groups = new Map();

            for (const [react, pixi] of reacts)
            {
                const sorted = [...pixi].sort(compareVersions);
                const key = sorted.join(',');
                const group = groups.get(key) ?? { react: [], pixi: sorted };

                group.react.push(react);
                groups.set(key, group);
            }
            for (const group of [...groups.values()].sort((a, b) => compareVersions(a.react.sort(compareVersions)[0], b.react.sort(compareVersions)[0])))
            {
                statements.push(`React ${versionSpan(group.react)} × pixi.js ${versionSpan(group.pixi)}`);
            }
        }

        return `${BACKEND_LABEL[backend] ?? backend}: ${statements.join('; ')}`;
    });
    const records = verified?.records ?? [];

    return `${parts.join('. ')}${records.length ? ` (${records.length === 1 ? 'record' : 'records'} ${records.map((id) => `[${id}](compatibility/verification/${id}.md)`).join(', ')})` : ''}`;
}
const versionLabel = (pkg) => `${pkg.version}${pkg.pending ? ' (Release 1, not yet published)' : ''}`;

/** The table's Markdown for the workspace at `root`. */
export function renderCompatibilityTable({ root = repoRoot } = {})
{
    const config = committedConfig(root);
    const facts = releaseFacts({ root, config });
    const seed = loadSeedAt(root);
    const backends = Object.keys(seed.adapterMatrix.renderers);
    // How each record rendered (software here; a real-GPU record adds evidence), and the expected blank renders.
    // Only the current records (the newest per machine and GPU profile) count; a record whose probes and incompatible
    // pairs did not all run (a partial run) verifies nothing and is named as evidence only.
    const records = currentRecords(loadRecords(join(root, 'design/compatibility/verification')));
    const renderingLine = records.map((record) => `Record [${recordId(record)}](compatibility/verification/${recordId(record)}.md)${recordGate(record) ? '' : ` (${record.scope === 'partial' ? 'partial run' : 'incomplete gate'}: evidence only, verifies nothing)`}: ${record.rendering.note}`).join(' ');
    const blankLines = (seed.adapterMatrix.expectedBlankRender ?? []).map((entry) => `${BACKEND_LABEL[entry.renderer] ?? entry.renderer} with pixi.js ${versionSpan(entry.pixi)} (${seed.adapterMatrix.pixiAdapters[entry.pixiAdapter].id}, ${entry.gpuProfile} rendering) is an **expected blank render, unverified**: ${entry.reason} ${entry.evidence.narrowed} ${entry.evidence.realGpu}`);
    const { facade, pixi } = facts;
    const composed = facade.composedPackages.filter((pkg) => !['packages/core', 'packages/renderer'].includes(pkg.dir));
    const lines = [
        '# Release compatibility table',
        '',
        '<!-- Generated by `node scripts/release/compat-table.mjs --write` from design/compatibility/seed.json and release.packages.json; do not edit. -->',
        '',
        `Names are the \`${facts.namespace}\` namespace of release.packages.json (pending [issue 41](https://github.com/baseten/pixi-react/issues/41)). `
            + '**Tested** means: covered by the PR-tier cells of the [#13 matrix](compatibility/cells/COMPATIBILITY.md), the required check on every pull request. '
            + '**Verified** means, per render backend (WebGL and WebGPU are checked separately): the tuple\'s nightly cell passed on that backend in a dated '
            + '[verification record](compatibility/verification/) whose boundary probes and incompatible pairs all behaved as expected; the exact tuples are `verifiedRanges` in the manifest. '
            + 'Verification is evidence, not a support guarantee, and never widens a peer range '
            + '(see [release.md](release.md#tested-and-verified)).',
        '',
        `**Rendering.** ${renderingLine}`,
        '',
        ...blankLines.flatMap((line) => [line, '']),
        '## The facade',
        '',
        `| ${code(facade.publicName)} | React peer | React tested | pixi.js peer | pixi.js tested on every PR | pixi.js in the nightly cells | Verified (the adapter packages it builds in) | Builds in |`,
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        `| ${versionLabel(facade)} | ${code(facade.peers.react)} | ${facade.reactTested.join(', ')} | ${code(facade.peers['pixi.js'])} | ${pixi.pr.join(', ')} | ${pixi.nightly.length} versions: the newest audited patch of each minor, ${pixi.nightly[0]} … ${pixi.nightly.at(-1)} | ${verifiedLabel(facade.verified, backends)} | ${composed.map((pkg) => `${code(pkg.publicName)} ${pkg.version}`).join(', ')}; react-reconciler ${facade.reconciler}, its-fine ${facade.itsFine} |`,
        `| ${UPSTREAM_ROW.version} (upstream, for comparison) | ${code(UPSTREAM_ROW.react)} | - | ${code(UPSTREAM_ROW.pixi)} | - | - | - | ${UPSTREAM_ROW.composes} |`,
        '',
        `On a React 19 minor other than ${facade.reactMinor} the facade installs (its peer is a caret range), runs and logs one warning; `
            + `pixi.js ${pixi.excluded.join(', ')} ${pixi.excluded.length === 1 ? 'is' : 'are'} excluded from the range.`,
        '',
        '## The modular packages',
        '',
        '| Package | Version | Peers | Exact dependencies | Tested on every PR | Verified |',
        '| --- | --- | --- | --- | --- | --- |',
    ];

    for (const pkg of facts.packages.filter((item) => !item.facade))
    {
        const peers = Object.entries(pkg.peers).filter(([name]) => !name.startsWith('@types/')).map(([name, range]) => `${name} ${code(range)}`).join(', ') || '-';
        const exact = [...pkg.internal.map((name) => `${code(name)} ${pkg.version}`), pkg.reconciler && `react-reconciler ${pkg.reconciler}`, pkg.itsFine && `its-fine ${pkg.itsFine}`].filter(Boolean).join(', ') || '-';
        let cells = 'in every cell';

        if (pkg.prCells?.length) cells = `React ${pkg.prCells[0].react} with pixi.js ${pkg.prCells.map((cell) => cell.pixi).join(' and ')}`;
        else if (pkg.prCells) cells = 'no PR-tier cell: its package fixtures on every PR, the cells nightly';
        else if (pkg.pixiAdapter?.isDefault) cells = 'with every React adapter row above';
        else if (pkg.pixiAdapter) cells = `${pkg.pixiAdapter.prCells.map((cell) => `React ${cell.react} with pixi.js ${cell.pixi}`).join(', ')}; every React adapter nightly`;

        lines.push(`| ${code(pkg.publicName)} | ${versionLabel(pkg)} | ${peers} | ${exact} | ${cells} | ${pkg.verified ? verifiedLabel(pkg.verified, backends, pkg.pixiAdapter?.renderers ?? backends) : 'in every verified tuple above'} |`);
    }
    lines.push('', `Every package releases at the facade's version (${facade.version}), and a dependency between our packages names exactly that version: install all \`${config.names.modulePrefix}*\` packages at the same version (see [release.md](release.md#lockstep-versions)).`);
    for (const pkg of facts.packages.filter((item) => item.pixiAdapter && !item.pixiAdapter.isDefault))
    {
        lines.push('', `${code(pkg.publicName)} targets pixi.js ${code(pkg.peers['pixi.js'])} but releases at the facade's version like every package; the facade itself composes the default Pixi adapter and stays on its Pixi major.`);
    }
    lines.push('');

    return lines.join('\n');
}

/** Problems if the checked-in table differs from a fresh rendering. */
export function checkCompatibilityTable({ root = repoRoot } = {})
{
    const file = join(root, TABLE_FILE);
    const expected = renderCompatibilityTable({ root });

    if (!existsSync(file)) return [`${TABLE_FILE} is missing: run node scripts/release/compat-table.mjs --write`];

    return readFileSync(file, 'utf8') === expected ? [] : [`${TABLE_FILE} is stale: run node scripts/release/compat-table.mjs --write`];
}

export function writeCompatibilityTable({ root = repoRoot } = {})
{
    writeFileSync(join(root, TABLE_FILE), renderCompatibilityTable({ root }));

    return TABLE_FILE;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
{
    if (process.argv.includes('--write')) console.log(`wrote ${writeCompatibilityTable()}`);
    else if (process.argv.includes('--check'))
    {
        const problems = checkCompatibilityTable();

        if (problems.length)
        {
            console.error(problems.join('\n'));
            process.exit(1);
        }
        console.log(`${TABLE_FILE} is current`);
    }
    else process.stdout.write(renderCompatibilityTable());
}
