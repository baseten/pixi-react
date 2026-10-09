// Dependency-tree check, run inside one isolated cell. The tree must contain only the React, react-dom, reconciler and
// Pixi versions the cell selected: one copy of each, none of what an adapter bundles, no stray second Pixi or React.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const cell = JSON.parse(readFileSync('cell.json', 'utf8'));
const problems = [];
const ls = spawnSync('npm', ['ls', '--all', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

writeFileSync('npm-ls.json', ls.stdout);
const tree = JSON.parse(ls.stdout || '{}');

if (ls.status !== 0)
{
    const detail = (tree.problems ?? [ls.stderr]).join('\n    ');

    problems.push(`npm ls reports an invalid, missing or extraneous dependency (a peer range the selected versions do not satisfy?):\n    ${detail}`);
}

/** name -> versions, over every depth. */
const found = new Map();
const walk = (node) =>
{
    for (const [name, child] of Object.entries(node.dependencies ?? {}))
    {
        if (child.version) found.set(name, new Set([...(found.get(name) ?? []), child.version]));
        walk(child);
    }
};

walk(tree);
const versionsOf = (name) => [...(found.get(name) ?? [])].sort();
const describe = (name) => (found.has(name) ? versionsOf(name).join(', ') : 'absent');

for (const [name, version] of Object.entries(cell.tree.exact))
{
    const versions = versionsOf(name);

    if (versions.length !== 1 || versions[0] !== version)
    {
        problems.push(`${name}: the cell selected ${version} but the tree contains ${describe(name)}. Exactly one copy at the selected version is required.`);
    }
}

for (const name of cell.tree.absent)
{
    if (found.has(name)) problems.push(`${name} ${describe(name)} is in the tree, but the adapter bundles it (the manifest lists it as bundled). A second copy means the adapter now depends on it: update the manifest row deliberately.`);
}

if (cell.tree.reconciler)
{
    const versions = versionsOf('react-reconciler');

    if (versions.length !== 1 || versions[0] !== cell.tree.reconciler) problems.push(`react-reconciler: expected exactly ${cell.tree.reconciler} (exact dependency of the adapter), found ${describe('react-reconciler')}.`);
}

for (const name of [...found.keys()].filter((candidate) => ['scheduler', 'pixi.js'].includes(candidate) || candidate.startsWith('@pixi/')))
{
    if (versionsOf(name).length > 1) problems.push(`${name} resolves to more than one version (${describe(name)}).`);
}

// Declared ranges: what the packed manifests promise must be what the manifest says CI certifies.
const packed = {};

for (const [name, expected] of Object.entries(cell.packed))
{
    const manifest = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));

    packed[name] = { version: manifest.version, dependencies: manifest.dependencies ?? {}, peerDependencies: manifest.peerDependencies ?? {} };
    if (expected.peers)
    {
        const actual = JSON.stringify(Object.entries(manifest.peerDependencies ?? {}).sort());

        if (actual !== JSON.stringify(Object.entries(expected.peers).sort())) problems.push(`${name}: packed peerDependencies ${JSON.stringify(manifest.peerDependencies ?? {})} differ from the manifest's declaredPeers ${JSON.stringify(expected.peers)}. Update one of them deliberately.`);
    }
    for (const forbidden of expected.forbiddenDependencies ?? [])
    {
        if (forbidden in (manifest.dependencies ?? {})) problems.push(`${name} declares ${forbidden} as a dependency, but the manifest says the adapter bundles it.`);
    }
}

const report = { cell: cell.id, found: Object.fromEntries([...found].filter(([name]) => /^(react|react-dom|react-reconciler|scheduler|its-fine|pixi\.js|@pixi\/.*|@pixi-react-provisional\/.*|@types\/react.*)$/.test(name)).map(([name, versions]) => [name, [...versions]])), packed, problems };

writeFileSync('tree-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`tree: ${Object.entries(report.found).map(([name, versions]) => `${name}@${versions.join('|')}`).join(' ')}`);
if (problems.length)
{
    console.error(`Dependency tree check failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
}
console.log('tree: ok');
