// Fast type/API probes at Pixi (and React) boundaries: the #3 audit runner, re-run against the registry and compared with
// the checked-in evidence and the seed's pinned digests. Drift in the observed API, the retained declaration surfaces or the
// type diagnostics fails the probe, so a changed minor or patch cannot silently widen the support range.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactAbiSha256 } from '../react-abi.mjs';
import { resolvedPackagesSha256 } from '../resolved-packages.mjs';
import { surfaceMapSha256 } from '../surface-map.mjs';

const compatibility = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = JSON.parse(readFileSync(join(compatibility, 'evidence.json'), 'utf8'));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Compares a freshly summarised tuple with its checked-in evidence row and pinned digests. Returns drift descriptions. */
export function compareWithEvidence(seed, summary)
{
    const tuple = seed.probes.find((probe) => probe.id === summary.id);
    const row = evidence.results.find((candidate) => candidate.id === summary.id);
    const known = seed.knownFailures.find((failure) => failure.tupleId === summary.id && failure.expectedRuntimeExit !== 0);
    const drift = [];
    const warnings = [];

    assert.ok(tuple && row, `${summary.id}: not in the seed or the evidence`);
    for (const field of ['installExit', 'runtimeExit', 'typeExit'])
    {
        if (summary[field] !== row[field]) drift.push(`${field} is ${summary[field]}, the audit recorded ${row[field]}`);
    }
    if (known)
    {
        if (!(summary.failure ?? '').includes(known.signature)) drift.push(`expected known failure "${known.signature}" (${known.id}) is gone or changed: ${(summary.failure ?? 'the probe passed').split('\n').slice(0, 3).join(' | ')}`);
    }
    else if (!same(summary.observation, row.observation))
    {
        const changed = Object.keys({ ...row.observation, ...summary.observation }).filter((key) => !same(summary.observation?.[key], row.observation?.[key]));

        drift.push(`runtime observation changed (${changed.join(', ')}): ${JSON.stringify(summary.observation?.[changed[0]])} instead of ${JSON.stringify(row.observation?.[changed[0]])}`);
    }
    if ((summary.typeDiagnostics ?? '') !== (row.typeDiagnostics ?? '')) drift.push(`type diagnostics changed:\n${summary.typeDiagnostics ?? '(none)'}`);
    if (surfaceMapSha256(summary.surfaces) !== tuple.surfacesSha256)
    {
        const paths = Object.keys({ ...summary.surfaces, ...row.surfaces }).filter((path) => !same(summary.surfaces[path], row.surfaces[path]));

        drift.push(`declaration/source surface digest differs from the seed pin; changed files: ${paths.slice(0, 5).join(', ') || '(set of files)'}`);
    }
    if (summary.packages.react && !known && reactAbiSha256(summary.observation) !== tuple.reactAbiSha256) drift.push('React host/root ABI digest differs from the seed pin');
    if (resolvedPackagesSha256(summary.resolvedPackages) !== tuple.resolvedPackagesSha256) warnings.push('transitive dependency resolution differs from the seed pin (review before refreshing the pins)');

    return { drift, warnings };
}

/** Runs one probe tuple with the #3 runner, then compares. */
export function runProbe(seed, probe, { out, npmCache })
{
    const workdir = join(out, probe.id);

    rmSync(workdir, { recursive: true, force: true });
    mkdirSync(workdir, { recursive: true });
    const env = { ...process.env, AUDIT_WORKDIR: workdir, ...(npmCache ? { AUDIT_NPM_CACHE: npmCache } : {}) };
    const run = spawnSync(process.execPath, [join(compatibility, 'run.mjs'), `=${probe.id}`], { encoding: 'utf8', env, timeout: 600_000 });
    const summarize = spawnSync(process.execPath, [join(compatibility, 'summarize.mjs'), join(workdir, 'results.json'), join(workdir, 'summary.json')], { encoding: 'utf8', timeout: 120_000 });

    if (summarize.status !== 0) return { id: probe.id, status: 'fail', message: `The audit runner produced no usable result:\n${run.stdout}${run.stderr}${summarize.stderr}` };
    const summary = JSON.parse(readFileSync(join(workdir, 'summary.json'), 'utf8')).results[0];
    const { drift, warnings } = compareWithEvidence(seed, summary);
    const known = seed.knownFailures.find((failure) => failure.tupleId === probe.id && failure.expectedRuntimeExit !== 0);

    if (drift.length)
    {
        return { id: probe.id, status: 'fail', message: `Unexpected API/type drift at ${probe.id}; do not widen the support range until it is reviewed (design/compatibility/README.md):\n- ${drift.join('\n- ')}`, warning: warnings.join('\n') };
    }

    return { id: probe.id, status: known ? 'expected-fail' : 'pass', message: known ? `known failure confirmed: ${known.id} (${known.decision})` : undefined, warning: warnings.join('\n') || undefined };
}
