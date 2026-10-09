// Reads release.packages.json, the single source of truth for public package names (issue 15), and resolves the
// selected namespace. Every release script goes through this module; nothing else maps workspace names to public ones.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** `*` matches any run of characters within a package name; nothing else is special. */
const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`);

/**
 * The resolved release configuration. `namespace` defaults to the file's `namespace`; the environment variable
 * PIXI_REACT_RELEASE_NAMESPACE (or the `namespace` argument) switches it, for example to `fallback`.
 */
export function loadReleaseConfig({ root = repoRoot, namespace = process.env.PIXI_REACT_RELEASE_NAMESPACE } = {})
{
    const raw = readJson(join(root, 'release.packages.json'));
    const selected = namespace || raw.namespace;
    const ns = raw.namespaces[selected];

    if (!ns) throw new Error(`release.packages.json has no namespace "${selected}" (known: ${Object.keys(raw.namespaces).join(', ')})`);
    if (!ns.modulePrefix || !ns.facade) throw new Error(`namespace "${selected}" needs "facade" and "modulePrefix"`);

    const packages = Object.entries(raw.packages).map(([dir, entry]) => ({
        dir,
        workspaceName: entry.workspaceName,
        publicName: entry.facade ? ns.facade : `${ns.modulePrefix}${entry.suffix}`,
        facade: Boolean(entry.facade),
        release1: entry.release1,
        versionConstant: entry.versionConstant ?? null,
    }));
    const byWorkspaceName = new Map(packages.map((pkg) => [pkg.workspaceName, pkg]));
    const neverPatterns = [...raw.neverPublished.names.map((name) => new RegExp(`^${name.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')}$`)), ...raw.neverPublished.patterns.map(globToRegExp)];
    const fill = (text) => text.replaceAll('{modulePrefix}', ns.modulePrefix).replaceAll('{facade}', ns.facade);

    return {
        raw,
        namespace: selected,
        names: ns,
        packages,
        byWorkspaceName,
        publishEnabled: raw.publish.enabled === true && typeof raw.publish.registry === 'string' && raw.publish.registry.length > 0,
        provisionalScope: raw.provisionalScope,
        textRewrites: Object.fromEntries(Object.entries(raw.textRewrites).filter(([key]) => !key.startsWith('$')).map(([from, to]) => [from, fill(to)])),
        isNeverPublished: (name) => neverPatterns.some((pattern) => pattern.test(name)),
        neverPublishedGlobs: [...raw.neverPublished.names, ...raw.neverPublished.patterns],
        releasedAbi: raw.abi.released,
    };
}

/**
 * Builds the function that rewrites provisional names in packed text. Package names are replaced only as whole
 * names: the next character must not continue a name (`@…/react-19` never matches inside `@…/react-19.3`, and
 * `@…/react-18` never matches inside a fixture name). Longer tokens are tried first.
 */
export function makeRewriter(config)
{
    const map = new Map([
        ...config.packages.filter((pkg) => pkg.workspaceName !== pkg.publicName).map((pkg) => [pkg.workspaceName, pkg.publicName]),
        ...Object.entries(config.textRewrites),
    ]);
    const tokens = [...map.keys()].sort((a, b) => b.length - a.length);

    if (!tokens.length) return (text) => text;
    // A token that ends inside a name (`…/core`) must not be followed by more name; one that ends in syntax (`react-${`) may.
    const alternatives = tokens.map((token) => token.replace(/[.+?^${}()|[\]\\/]/g, '\\$&') + ((/[A-Za-z0-9._-]$/).test(token) ? '(?![A-Za-z0-9_-]|\\.[0-9])' : ''));
    const pattern = new RegExp(alternatives.join('|'), 'g');

    return (text) => text.replace(pattern, (match) => map.get(match));
}

function subdirectories(dir)
{
    try
    {
        return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
    }
    catch
    {
        return [];
    }
}

/** The package manager's view of the workspace: `{ name, dir, private, manifest }` for every package, root included. */
export function listWorkspace(root = repoRoot)
{
    const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [...yaml.split(/\n(?=\S)/)[0].matchAll(/^\s+-\s+['"]?([^'"\n]+)['"]?\s*$/gm)].map(([, glob]) => glob.trim());
    const dirs = [''];

    for (const glob of globs)
    {
        const parts = glob.split('/');
        let current = [''];

        for (const part of parts)
        {
            const next = [];

            for (const base of current)
            {
                if (!part.includes('*'))
                {
                    next.push(join(base, part));
                    continue;
                }
                const matcher = globToRegExp(part);

                for (const entry of subdirectories(join(root, base))) if (matcher.test(entry)) next.push(join(base, entry));
            }
            current = next;
        }
        dirs.push(...current);
    }

    return dirs.flatMap((dir) =>
    {
        let manifest;

        try { manifest = readJson(join(root, dir, 'package.json')); }
        catch { return []; }

        return [{ name: manifest.name, dir: dir || '.', private: manifest.private === true, manifest }];
    });
}
