// Packs the workspace artifacts the way a registry would serve them and records content hashes for cache keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileSetHash } from './matrix.mjs';

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** JSON with object keys sorted at every depth: `pnpm pack` does not keep the order of rewritten workspace dependencies stable. */
const canonical = (value) => JSON.stringify(value, (key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))) : item));

function walk(dir, base = dir)
{
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        (entry.isDirectory() ? walk(join(dir, entry.name), base) : [join(dir, entry.name).slice(base.length + 1).split('\\').join('/')]));
}

/** Every string leaf of an `exports` entry: the files a consumer can be sent to. */
function exportTargets(value)
{
    if (typeof value === 'string') return [value];

    return value && typeof value === 'object' ? Object.values(value).flatMap(exportTargets) : [];
}

const SCRIPT = /\.(?:[cm]?js|d\.[cm]?ts)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]*)['"]/g;

/**
 * Files an export `entry` can reach: its targets plus everything they import relatively (a `.js` specifier in a
 * declaration means the sibling `.d.ts`). Throws when a relative import cannot be resolved, so the caller falls back
 * to hashing the whole package rather than under-invalidating.
 */
export function entryClosure(files, manifest, entry)
{
    const known = new Set(files);
    const targets = exportTargets(manifest.exports?.[entry]).map((target) => posix.normalize(target));

    assert.ok(targets.length > 0, `package ${manifest.name} has no export entry ${entry}`);
    const seen = new Set();
    const queue = [...targets];

    while (queue.length)
    {
        const file = queue.pop();

        if (seen.has(file)) continue;
        assert.ok(known.has(file), `${manifest.name}: export target ${file} is not in the tarball`);
        seen.add(file);
        if (!SCRIPT.test(file)) continue;
        const text = readFileSync(join(manifest.__root, file), 'utf8');

        for (const [, specifier] of text.matchAll(SPECIFIER))
        {
            const base = posix.join(posix.dirname(file), specifier);
            const stem = base.replace(/\.[cm]?js$/, '');
            const candidates = [base, `${stem}.d.ts`, `${stem}.d.mts`, `${stem}.d.cts`, `${stem}.js`, `${stem}.mjs`, `${stem}.cjs`, `${base}.js`, `${base}.d.ts`, `${base}/index.js`, `${base}/index.d.ts`];
            const found = candidates.find((candidate) => known.has(candidate));

            assert.ok(found, `${manifest.name}: ${file} imports ${specifier}, which is not in the tarball`);
            queue.push(found);
        }
    }

    return [...seen].sort();
}

/** The manifest fields that decide how one entry installs and resolves; everything else (scripts, devDependencies) is noise. */
const installView = (manifest, entry) => ({ name: manifest.name, version: manifest.version, type: manifest.type, entry: manifest.exports?.[entry], dependencies: manifest.dependencies ?? {}, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });

/**
 * Packs every artifact into `dest` and writes `<dest>/artifacts.json`:
 * `{ [id]: { file, package, version, hash, files, entries: { [entry]: { hash, files } } } }`.
 * `hash` covers the whole package. `entries[entry].hash` covers only the files that entry reaches plus its install-relevant
 * manifest view, so an edit to a sibling entry of a multi-entry package leaves it unchanged.
 */
export function packArtifacts(seed, dest, root)
{
    const matrix = seed.adapterMatrix;
    const entriesWanted = new Map();

    for (const adapter of [...Object.values(matrix.reactAdapters), ...Object.values(matrix.pixiAdapters)]) entriesWanted.set(adapter.artifact, [...(entriesWanted.get(adapter.artifact) ?? []), adapter.entry]);
    mkdirSync(dest, { recursive: true });
    const result = {};
    const scratch = mkdtempSync(join(tmpdir(), 'compat-pack-'));

    try
    {
        for (const [id, artifact] of Object.entries(matrix.artifacts))
        {
            const dir = resolve(root, artifact.dir);

            if (artifact.role !== 'harness' && !existsSync(join(dir, 'dist'))) throw new Error(`${artifact.package} is not built (no ${join(dir, 'dist')}); run "pnpm build" first.`);
            const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', dest], { cwd: dir, encoding: 'utf8' });
            const { filename } = JSON.parse(output.slice(output.indexOf('{')));
            const extracted = join(scratch, id);

            mkdirSync(extracted, { recursive: true });
            execFileSync('tar', ['-xzf', filename, '-C', extracted, '--strip-components=1']);
            const files = walk(extracted);
            const manifest = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8'));
            const hashes = Object.fromEntries(files.map((file) => [file, file === 'package.json' ? sha(canonical(manifest)) : sha(readFileSync(join(extracted, file)))]));

            assert.equal(manifest.name, artifact.package, `${id}: packed name`);
            const entries = {};

            for (const entry of entriesWanted.get(id) ?? [])
            {
                try
                {
                    const reach = entryClosure(files, { ...manifest, __root: extracted }, entry);

                    entries[entry] = { files: reach, hash: sha(JSON.stringify([fileSetHash(Object.fromEntries(reach.map((file) => [file, hashes[file]]))), canonical(installView(manifest, entry))])) };
                }
                catch (error)
                {
                    // Unresolvable: scoping is unsafe, so this entry is hashed as the whole package.
                    process.stderr.write(`pack: ${id} ${entry}: ${error.message}; hashing the whole package\n`);
                    entries[entry] = { files, hash: sha(JSON.stringify([fileSetHash(hashes), canonical(manifest)])) };
                }
            }
            result[id] = { file: filename, package: artifact.package, version: manifest.version, hash: sha(JSON.stringify([fileSetHash(hashes), canonical(manifest)])), files: hashes, entries };
        }
    }
    finally
    {
        rmSync(scratch, { recursive: true, force: true });
    }
    writeFileSync(join(dest, 'artifacts.json'), `${JSON.stringify(result, null, 2)}\n`);

    return result;
}

export const readArtifacts = (dir) =>
{
    const artifacts = JSON.parse(readFileSync(join(dir, 'artifacts.json'), 'utf8'));

    for (const artifact of Object.values(artifacts)) artifact.file = join(dir, posix.basename(artifact.file.split('\\').join('/')));

    return artifacts;
};
