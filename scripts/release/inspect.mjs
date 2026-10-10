#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Inspects staged release tarballs (issue 15) without installing them. Every check reads the tarball's own files:
 *
 * - names and versions follow release.packages.json; no `workspace:` range, no provisional or never-published name;
 * - every staged package has one version (lockstep, issue 62), and a dependency on another publishable package is
 *   that exact version: never a `^` or `~` range, so mixing versions installs a second core instead of silently
 *   sharing one (the runtime ABI check then rejects the mix with a clear error);
 * - peers stay peers: react, react-dom and pixi.js are never ordinary dependencies; react-reconciler and its-fine are
 *   exact versions and only the React adapters and the facade depend on them; the facade depends on no modular package;
 * - every `exports` subpath resolves for `import` and `require` to a JS file and a declaration file that exist, and
 *   `main`, `module` and `types` exist;
 * - every bare specifier in the JS and declarations is the package itself, a declared dependency or peer (for a
 *   declaration, also a peer's `@types/` package), a `#` import the manifest maps, or a Node built-in;
 * - no install lifecycle script, `bin`, or `binding.gyp`: installing runs nothing.
 *
 * Usage: node scripts/release/inspect.mjs [--tarballs <dir>]   (default .release/tarballs, from stage.mjs)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { loadReleaseConfig, repoRoot } from './config.mjs';
import { walk } from './stage.mjs';

const PEERS_NEVER_DEPENDENCIES = ['react', 'react-dom', 'pixi.js', '@types/react', '@types/react-dom'];
const PINNED_IN_REACT_ADAPTERS = ['react-reconciler', 'its-fine'];
const EXACT = /^\d+\.\d+\.\d+$/;
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare'];
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])([^'"\s]+)\1/g;
const SCRIPT = /\.(?:[cm]?js|d\.[cm]?ts)$/;
const PACKAGE_SPECIFIER = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w./-]*)?$/i;
/** Block comments and whole-line comments: usage examples in JSDoc name packages a consumer composes, not imports. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** First target of an `exports` value under `conditions` (in the object's own key order, as Node and TypeScript do). */
export function resolveExport(value, conditions)
{
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((item) => resolveExport(item, conditions)).find(Boolean) ?? null;
    if (!value || typeof value !== 'object') return null;
    for (const [key, item] of Object.entries(value))
    {
        if (key === 'default' || conditions.includes(key))
        {
            const found = resolveExport(item, conditions);

            if (found) return found;
        }
    }

    return null;
}

const packageOf = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);

/** Checks one unpacked package. Returns `{ problems, exports }`. */
export function inspectPackage(dir, entry, staged, config)
{
    const problems = [];
    const fail = (message) => problems.push(`${entry.publicName}: ${message}`);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = new Set(walk(dir));
    const deps = manifest.dependencies ?? {};
    const peers = manifest.peerDependencies ?? {};
    const isReactAdapter = (/^packages\/react-1\d/).test(entry.dir);
    const pkg = config.packages.find((candidate) => candidate.dir === entry.dir);

    // Names and versions.
    if (manifest.name !== pkg.publicName) fail(`name ${manifest.name}, expected ${pkg.publicName}`);
    // Publishing enabled: stage.mjs drops `private`; only `private: true` blocks it. Disabled: it must be true.
    if ((manifest.private === true) === config.publishEnabled) fail(`"private" is ${manifest.private}; publishing is ${config.publishEnabled ? 'enabled' : 'disabled'}`);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'])
    {
        for (const [name, spec] of Object.entries(manifest[field] ?? {}))
        {
            if (String(spec).startsWith('workspace:')) fail(`${field}.${name} is ${spec}`);
            if (name.startsWith(config.provisionalScope) || config.isNeverPublished(name)) fail(`${field} names ${name}, which is not published`);
        }
    }
    if (manifest.devDependencies) fail('ships devDependencies');

    // Inter-package dependencies: the exact same version (lockstep), never a range.
    if (manifest.version !== entry.version) fail(`version ${manifest.version}, the release manifest says ${entry.version}`);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'])
    {
        for (const [name, spec] of Object.entries(manifest[field] ?? {}))
        {
            const target = staged.find((candidate) => candidate.publicName === name);

            if (!target) continue;
            if (field === 'peerDependencies') fail(`${name} is a peer; it must be an exact dependency`);
            else if (spec !== target.version || spec !== manifest.version) fail(`${field}.${name} is ${spec}; packages of this release depend on each other at exactly the same version ${manifest.version}${(/^[~^]/).test(String(spec)) ? ' (no ^ or ~ ranges)' : ''}`);
        }
    }

    // Peers stay external; reconcilers stay pinned in their owning adapter.
    for (const name of PEERS_NEVER_DEPENDENCIES) if (deps[name]) fail(`${name} is a dependency; it must be a peer`);
    for (const name of PINNED_IN_REACT_ADAPTERS)
    {
        if (!deps[name]) continue;
        if (!isReactAdapter && !pkg.facade) fail(`depends on ${name}; only the React adapters and the facade may`);
        if (!EXACT.test(deps[name])) fail(`${name} is ${deps[name]}, expected an exact version`);
    }
    if (isReactAdapter)
    {
        for (const name of PINNED_IN_REACT_ADAPTERS) if (!deps[name]) fail(`React adapter without an exact ${name} dependency`);
        const range = peers.react ?? '';

        if (!range || !range.split('||').every((part) => EXACT.test(part.trim()))) fail(`React peer ${range || '(none)'} is not a list of exact versions (D5)`);
    }
    if (pkg.facade)
    {
        const modular = Object.keys(deps).filter((name) => staged.some((candidate) => candidate.publicName === name));

        if (modular.length) fail(`the facade depends on modular packages: ${modular.join(', ')}`);
        if (!peers.react || !peers['pixi.js']) fail('the facade must declare react and pixi.js peers');
    }

    // Installing runs nothing.
    for (const name of LIFECYCLE) if (manifest.scripts?.[name]) fail(`lifecycle script "${name}"`);
    if (manifest.bin) fail('declares "bin"');
    if (files.has('binding.gyp')) fail('ships binding.gyp (npm would run node-gyp on install)');

    // Entry points.
    for (const field of ['main', 'module', 'types', 'typings'])
    {
        if (manifest[field] && !files.has(posix.normalize(manifest[field]))) fail(`"${field}" points to missing ${manifest[field]}`);
    }
    const exportRows = [];

    for (const [subpath, value] of Object.entries(manifest.exports ?? {}))
    {
        if (subpath === './package.json') continue;
        const row = { subpath };

        for (const mode of ['import', 'require'])
        {
            const js = resolveExport(value, [mode, 'node']);
            const types = resolveExport(value, ['types', mode, 'node']);

            row[mode] = js;
            row[`${mode}Types`] = types;
            if (!js || !files.has(posix.normalize(js))) fail(`exports["${subpath}"] (${mode}) -> ${js ?? 'nothing'}, not in the tarball`);
            if (!types || !(/\.d\.[cm]?ts$/).test(types) || !files.has(posix.normalize(types))) fail(`exports["${subpath}"] (${mode}) has no declaration file (${types ?? 'none'})`);
        }
        exportRows.push(row);
    }
    if (!manifest.exports) fail('has no "exports"');

    // Every bare specifier the shipped code or declarations name is declared.
    const imports = manifest.imports ?? {};
    const allowed = new Set([manifest.name, ...Object.keys(deps), ...Object.keys(peers)]);
    const allowedTypes = new Set([...allowed, ...Object.keys(peers).filter((name) => name.startsWith('@types/')).map((name) => name.slice('@types/'.length))]);
    const builtins = new Set(builtinModules);

    for (const file of files)
    {
        if (!SCRIPT.test(file)) continue;
        const declaration = (/\.d\.[cm]?ts$/).test(file);
        const text = stripComments(readFileSync(join(dir, file), 'utf8'));

        for (const [, , specifier] of text.matchAll(SPECIFIERS))
        {
            if (!specifier.startsWith('#') && !specifier.startsWith('.') && !PACKAGE_SPECIFIER.test(specifier)) continue;
            if (specifier.startsWith('.') || specifier.startsWith('node:') || builtins.has(specifier)) continue;
            if (specifier.startsWith('#'))
            {
                const target = resolveExport(imports[specifier], ['import', 'require', 'node']);

                if (!target) fail(`${file} imports ${specifier}, which "imports" does not map`);
                else if (!target.startsWith('.') && !allowed.has(packageOf(target))) fail(`"imports".${specifier} maps to undeclared ${target}`);
                continue;
            }
            const name = packageOf(specifier);

            if (!(declaration ? allowedTypes : allowed).has(name)) fail(`${file} imports undeclared ${specifier}`);
        }
    }

    return { problems, exports: exportRows, manifest };
}

export function inspectStaged(tarballDir, { root = repoRoot } = {})
{
    const report = JSON.parse(readFileSync(join(tarballDir, 'release-manifest.json'), 'utf8'));
    const config = loadReleaseConfig({ root, namespace: report.namespace });
    const problems = [];
    const rows = [];
    const scratch = mkdtempSync(join(tmpdir(), 'pixi-react-inspect-'));

    try
    {
        const expected = new Set(config.packages.map((pkg) => pkg.publicName));
        const actual = new Set(report.packages.map((entry) => entry.publicName));

        const versions = [...new Set(report.packages.map((entry) => entry.version))];

        if (versions.length > 1) problems.push(`lockstep: the staged packages have ${versions.length} versions (${report.packages.map((entry) => `${entry.publicName}@${entry.version}`).join(', ')}); every package releases at the facade's version`);
        for (const name of expected) if (!actual.has(name)) problems.push(`missing tarball for ${name}`);
        for (const name of actual) if (!expected.has(name)) problems.push(`unexpected tarball ${name}`);
        for (const entry of report.packages)
        {
            const file = join(tarballDir, entry.file);

            if (!existsSync(file))
            {
                problems.push(`${entry.file} is missing`);
                continue;
            }
            const dir = join(scratch, entry.file);

            execFileSync('mkdir', ['-p', dir]);
            execFileSync('tar', ['-xzf', file, '-C', dir, '--strip-components=1']);
            const result = inspectPackage(dir, entry, report.packages, config);

            problems.push(...result.problems);
            rows.push({ ...entry, exports: result.exports });
        }
    }
    finally
    {
        rmSync(scratch, { recursive: true, force: true });
    }

    return { namespace: report.namespace, problems, packages: rows };
}

export function renderTarballTable(result)
{
    const lines = ['| Tarball | Public name | Version | Dependencies | Peers |', '| --- | --- | --- | --- | --- |'];
    const list = (object) => Object.entries(object).map(([name, spec]) => `\`${name}@${spec}\``).join('<br>') || '—';

    for (const entry of result.packages) lines.push(`| \`${entry.file}\` | \`${entry.publicName}\` | ${entry.version} | ${list(entry.dependencies)} | ${list(entry.peerDependencies)} |`);

    return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
{
    const args = process.argv.slice(2);
    const index = args.indexOf('--tarballs');
    const dir = resolve(index >= 0 ? args[index + 1] : join(repoRoot, '.release', 'tarballs'));
    const result = inspectStaged(dir);

    console.log(renderTarballTable(result));
    for (const entry of result.packages)
    {
        for (const row of entry.exports) console.log(`${entry.publicName}${row.subpath.slice(1)}: import ${row.import} (${row.importTypes}); require ${row.require} (${row.requireTypes})`);
    }
    if (result.problems.length)
    {
        console.error(`\nTarball inspection failed:\n  - ${result.problems.join('\n  - ')}`);
        process.exit(1);
    }
    console.log(`\ninspect: ok (${result.packages.length} tarballs, namespace ${result.namespace})`);
}
