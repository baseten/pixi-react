#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Stages release tarballs for every publishable package (issue 15). It never publishes.
 *
 * For each package in release.packages.json:
 * 1. `pnpm pack` in the package directory, so the tarball holds exactly what a registry would serve and every
 *    `workspace:` range is replaced by the version range pnpm publishes (`workspace:^` becomes `^<version>`).
 * 2. The packed manifest gets the package's public name in the selected namespace, its dependencies on other
 *    publishable packages are renamed the same way, and `scripts` and `devDependencies` are dropped (a consumer
 *    never runs or installs them). `private` stays true unless release.packages.json enables publishing.
 * 3. Every text file (JS, declarations, source maps, README, package.json) has its provisional names rewritten by
 *    `makeRewriter` (whole names only). Any `@pixi-react-provisional` left afterwards fails the run.
 * 4. The files are re-packed as `<out>/<public name>-<version>.tgz` and listed in `<out>/release-manifest.json`.
 *
 * Usage: node scripts/release/stage.mjs [--out <dir>] [--namespace target|fallback]
 * Run `pnpm build` first.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadReleaseConfig, makeRewriter, repoRoot } from './config.mjs';

const TEXT = /\.(?:[cm]?js|d\.[cm]?ts|map|json|md|txt)$|(?:^|\/)(?:LICENSE|README)[^/]*$/;
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies'];

export function walk(dir, base = dir)
{
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        (entry.isDirectory() ? walk(join(dir, entry.name), base) : [join(dir, entry.name).slice(base.length + 1).split('\\').join('/')]));
}

export const tarballName = (name, version) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/** The packed manifest of `pkg`, renamed and stripped for release. Throws when it depends on a never-published package. */
export function releaseManifest(manifest, pkg, config)
{
    const out = { ...manifest, name: pkg.publicName };

    for (const field of DEPENDENCY_FIELDS)
    {
        const value = manifest[field];

        if (!value || Array.isArray(value)) continue;
        out[field] = Object.fromEntries(Object.entries(value).map(([name, spec]) =>
        {
            if (config.isNeverPublished(name)) throw new Error(`${pkg.workspaceName}: ${field} names ${name}, which is never published`);
            const target = config.byWorkspaceName.get(name);

            if (typeof spec === 'string' && spec.startsWith('workspace:')) throw new Error(`${pkg.workspaceName}: ${field}.${name} is still ${spec} after pnpm pack`);

            return [target ? target.publicName : name, spec];
        }));
    }
    delete out.scripts;
    delete out.devDependencies;
    if (config.publishEnabled)
    {
        delete out.private;
        out.publishConfig = { ...out.publishConfig, access: 'public', registry: config.raw.publish.registry };
    }
    else
    {
        // Fail closed: npm refuses to publish a private package, with or without lifecycle scripts.
        out.private = true;
        out.publishConfig = { ...out.publishConfig, access: 'public' };
    }

    return out;
}

function integrity(file)
{
    const buffer = readFileSync(file);

    return { sha512: `sha512-${createHash('sha512').update(buffer).digest('base64')}`, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
}

export function stage({ out, namespace, root = repoRoot, log = console.log } = {})
{
    const config = loadReleaseConfig({ root, namespace });
    const rewrite = makeRewriter(config);
    const scratch = mkdtempSync(join(tmpdir(), 'pixi-react-stage-'));
    const results = [];

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    try
    {
        for (const pkg of config.packages)
        {
            const dir = join(root, pkg.dir);
            const workspaceManifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

            if (workspaceManifest.name !== pkg.workspaceName) throw new Error(`${pkg.dir}: package.json name is ${workspaceManifest.name}, release.packages.json says ${pkg.workspaceName}`);
            for (const built of workspaceManifest.files ?? [])
            {
                if (!existsSync(join(dir, built))) throw new Error(`${pkg.workspaceName} is not built (no ${pkg.dir}/${built}); run "pnpm build" first.`);
            }
            const raw = join(scratch, 'raw', pkg.dir.replace(/\W+/g, '-'));
            const unpacked = join(scratch, 'unpacked', pkg.dir.replace(/\W+/g, '-'));

            mkdirSync(raw, { recursive: true });
            mkdirSync(unpacked, { recursive: true });
            execFileSync('pnpm', ['pack', '--pack-destination', raw], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
            const [packed] = readdirSync(raw).filter((file) => file.endsWith('.tgz'));

            if (!packed) throw new Error(`pnpm pack produced no tarball for ${pkg.workspaceName}`);
            execFileSync('tar', ['-xzf', join(raw, packed), '-C', unpacked]);
            const packageDir = join(unpacked, 'package');
            const manifest = releaseManifest(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')), pkg, config);
            const files = walk(packageDir);
            const residue = [];

            writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
            for (const file of files)
            {
                if (!TEXT.test(file)) continue;
                const path = join(packageDir, file);
                const before = readFileSync(path, 'utf8');
                const after = rewrite(before);

                if (after !== before) writeFileSync(path, after);
                for (const [index, line] of after.split('\n').entries())
                {
                    if (line.includes(config.provisionalScope)) residue.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
                }
            }
            if (residue.length) throw new Error(`${pkg.workspaceName}: provisional names left after rewriting:\n  ${residue.join('\n  ')}`);
            const file = tarballName(manifest.name, manifest.version);

            // npm's own fixed mtime and ownership, sorted entries: the same inputs give the same bytes.
            const archive = execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=1985-10-26T08:15:00Z', '-cf', '-', '-C', unpacked, 'package'], { maxBuffer: 1 << 30 });

            writeFileSync(join(out, file), gzipSync(archive, { level: 9 }));
            const entry = {
                dir: pkg.dir,
                workspaceName: pkg.workspaceName,
                publicName: manifest.name,
                version: manifest.version,
                file,
                private: manifest.private === true,
                fileCount: files.length,
                unpackedSize: files.reduce((sum, name) => sum + statSync(join(packageDir, name)).size, 0),
                dependencies: manifest.dependencies ?? {},
                peerDependencies: manifest.peerDependencies ?? {},
                ...integrity(join(out, file)),
            };

            results.push(entry);
            log(`staged ${entry.publicName}@${entry.version} (${pkg.workspaceName}) -> ${file}`);
        }
    }
    finally
    {
        rmSync(scratch, { recursive: true, force: true });
    }
    const report = { namespace: config.namespace, publishEnabled: config.publishEnabled, packages: results };

    writeFileSync(join(out, 'release-manifest.json'), `${JSON.stringify(report, null, 2)}\n`);

    return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
{
    const args = process.argv.slice(2);
    const option = (name) =>
    {
        const index = args.indexOf(name);

        return index >= 0 ? args[index + 1] : undefined;
    };
    const out = resolve(option('--out') ?? join(repoRoot, '.release', 'tarballs'));

    stage({ out, namespace: option('--namespace') });
    console.log(`release manifest: ${join(out, 'release-manifest.json')}`);
}
