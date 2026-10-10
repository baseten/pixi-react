// Release facts derived from the compatibility manifest (design/compatibility/seed.json) and release.packages.json
// (issue 40): the facade's tested React and Pixi lines, the Pixi peer range the evidence supports, each package's
// release version and peers. The release rules in policy.mjs, the generated compatibility table (compat-table.mjs)
// and the docs pins (docs-pins.mjs) all read these facts from here, so none of them repeats a version by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, pixiMinors, reactVersions } from '../../design/compatibility/cells/matrix.mjs';
import { loadReleaseConfig, readJson, repoRoot } from './config.mjs';

/** The source of the facade's tested React constant (the runtime warning reads it). */
export const FACADE_REACT_SOURCE = 'packages/react/src/runtime/reactVersion.ts';

/** Upstream's last release, shown in the table for comparison. Facts about a published package, not manifest data. */
export const UPSTREAM_ROW = Object.freeze({
    version: '8.0.5',
    react: '>=19.0.0',
    pixi: '^8.2.6',
    composes: 'react-reconciler 0.31.0 (the React 19.0 epoch), its-fine ^2.0.0',
});

const parts = (version) => version.split('.').map(Number);

/**
 * The release configuration with the namespace committed in release.packages.json. Generated files always use it, so
 * a one-run namespace override (PIXI_REACT_RELEASE_NAMESPACE) never makes them stale.
 */
export const committedConfig = (root = repoRoot) => loadReleaseConfig({ root, namespace: readJson(join(root, 'release.packages.json')).namespace });

export const loadSeedAt = (root = repoRoot) => readJson(join(root, 'design/compatibility/seed.json'));

/** The exact versions of a declared peer such as `19.0.0 || 19.0.8`, oldest first; null if it is not a list of exact versions. */
export function exactList(range)
{
    const versions = String(range).split('||').map((item) => item.trim());

    return versions.every((version) => (/^\d+\.\d+\.\d+$/).test(version)) ? versions.sort(compareVersions) : null;
}

/**
 * The pixi.js peer range the manifest's evidence supports: from `pixiEpochs.pixi8.minimum` up to (excluding) the
 * minor after `current`, with each of the adapter's `excludedVersions` cut out. A wider range needs a newer
 * `current`, which needs audited probe tuples and matrix cells for it (validate.mjs, the nightly matrix).
 */
export function supportedPixiRange(seed, adapterKey = 'pixi8')
{
    const epoch = seed.pixiEpochs.find((candidate) => candidate.id === 'pixi8');
    const adapter = seed.adapterMatrix.pixiAdapters[adapterKey];
    const [major, minor] = parts(epoch.current);
    const upper = `<${major}.${minor + 1}.0`;
    const segments = [];
    let lower = epoch.minimum;

    for (const excluded of [...adapter.excludedVersions].sort(compareVersions))
    {
        if (compareVersions(excluded, lower) < 0 || compareVersions(excluded, `${major}.${minor + 1}.0`) >= 0) continue;
        if (compareVersions(excluded, lower) > 0) segments.push(`>=${lower} <${excluded}`);
        const [a, b, c] = parts(excluded);

        lower = `${a}.${b}.${c + 1}`;
    }
    segments.push(`>=${lower} ${upper}`);

    return segments.join(' || ');
}

/** The version a package releases next: its Release 1 version until anything is released, then its package.json version. */
export function releaseVersion(pkg, manifest, config)
{
    return config.releasedAbi === null && pkg.release1 ? pkg.release1 : manifest.version;
}

/** The value of the facade's tested-React constant: `TESTED_REACT = Object.freeze({ minor, versions })`. */
export function readFacadeTestedReact(root = repoRoot)
{
    const source = readFileSync(join(root, FACADE_REACT_SOURCE), 'utf8');
    const match = source.match(/TESTED_REACT = Object\.freeze\(\{ minor: '([^']+)', versions: Object\.freeze\(\[([^\]]*)\]\) \}\)/);

    if (!match) return null;

    return { minor: match[1], versions: [...match[2].matchAll(/'([^']+)'/g)].map(([, version]) => version) };
}

/**
 * Everything the release rules, the table and the docs pins need, derived from the manifest, release.packages.json
 * and the workspace package.json files.
 */
export function releaseFacts({ root = repoRoot, config, seed = loadSeedAt(root) })
{
    const matrix = seed.adapterMatrix;
    const manifestOf = (dir) => readJson(join(root, dir, 'package.json'));
    const facadePkg = config.packages.find((pkg) => pkg.facade);
    const facadeManifest = manifestOf(facadePkg.dir);
    const devDependencies = Object.keys(facadeManifest.devDependencies ?? {});
    const composed = Object.entries(matrix.reactAdapters).filter(([, adapter]) => devDependencies.includes(matrix.artifacts[adapter.artifact].package));

    if (composed.length !== 1) throw new Error(`the facade must build in exactly one React adapter of the manifest; found ${composed.map(([key]) => key).join(', ') || 'none'}`);
    const [epochKey, reactAdapter] = composed[0];
    const epoch = seed.reactEpochs.find((candidate) => candidate.id === epochKey);
    const tested = exactList(reactAdapter.declaredPeers.react);

    if (!tested) throw new Error(`${epochKey}: declaredPeers.react must list exact versions, found ${reactAdapter.declaredPeers.react}`);
    const pixiAdapter = matrix.pixiAdapters.pixi8;
    const pixiEpoch = seed.pixiEpochs.find((candidate) => candidate.id === 'pixi8');
    const prPixi = matrix.tiers.pr.pixi.versions.map((which) => (which === 'minimum' ? pixiEpoch.minimum : pixiEpoch.current));
    const nightlyPixi = pixiMinors(seed, 'pixi8').map((minor) => minor.latest.version);
    const byDir = new Map(Object.entries(matrix.reactAdapters).map(([key, adapter]) => [matrix.artifacts[adapter.artifact].dir, { key, adapter }]));
    const packages = config.packages.map((pkg) =>
    {
        const manifest = manifestOf(pkg.dir);
        const react = byDir.get(pkg.dir);
        const reactPr = react ? reactVersions(seed, react.key).latest.version : null;

        return {
            dir: pkg.dir,
            facade: pkg.facade,
            workspaceName: pkg.workspaceName,
            publicName: pkg.publicName,
            version: releaseVersion(pkg, manifest, config),
            pending: config.releasedAbi === null && Boolean(pkg.release1),
            peers: manifest.peerDependencies ?? {},
            reconciler: manifest.dependencies?.['react-reconciler'] ?? null,
            itsFine: manifest.dependencies?.['its-fine'] ?? null,
            // Our packages it depends on; each at exactly this release's version (lockstep, issue 62).
            internal: Object.keys(manifest.dependencies ?? {}).filter((name) => config.byWorkspaceName.has(name)).map((name) => config.byWorkspaceName.get(name).publicName),
            reactEpoch: react?.key ?? null,
            // The PR tier runs each React adapter at its newest audited patch against every PR-tier pixi.js version.
            prCells: react ? prPixi.map((pixi) => ({ react: reactPr, pixi })) : null,
        };
    });
    const facade = packages.find((pkg) => pkg.facade);
    const newestReact = tested.at(-1);

    return {
        namespace: config.namespace,
        facade: {
            ...facade,
            reactEpoch: epochKey,
            reactMinor: epoch.reactMinor,
            reactTested: tested,
            newestReact,
            expectedReactPeer: `^${newestReact}`,
            composedPackages: packages.filter((pkg) => devDependencies.includes(pkg.workspaceName)),
        },
        pixi: {
            range: pixiAdapter.declaredPeers['pixi.js'],
            supportedRange: supportedPixiRange(seed),
            minimum: pixiEpoch.minimum,
            newest: pixiEpoch.current,
            excluded: pixiAdapter.excludedVersions,
            pr: prPixi,
            nightly: nightlyPixi,
        },
        newestReactEpoch: [...seed.reactEpochs].sort((a, b) => compareVersions(`${a.reactMinor}.0`, `${b.reactMinor}.0`)).at(-1).id,
        packages,
    };
}

/** The pixi.js majors a peer range names; the facade's major must equal the single one (it tracks the Pixi major). */
export function pixiMajors(range)
{
    return [...new Set([...String(range).matchAll(/(\d+)\.\d+\.\d+/g)].map(([, major]) => Number(major)))];
}

/**
 * Release rules that are not enforced elsewhere (issue 40). Returns problems; empty when the rules hold.
 *
 * - The Pixi adapter's declared range is exactly the range the manifest's evidence supports (no widening without it).
 * - The facade's peers equal the manifest's: pixi.js is the Pixi adapter's declared range, react is `^<newest tested>`
 *   of the epoch it builds in, and that epoch is the newest React epoch (D1).
 * - The facade's runtime warning names exactly the tested React versions.
 * - The facade's react-reconciler and its-fine equal those of the adapter package it builds in.
 * - The facade's major equals the Pixi major of its pixi.js peer (the facade major tracks the Pixi major).
 */
export function checkReleaseRules({ root = repoRoot, config, plan, seed = loadSeedAt(root) })
{
    const problems = [];
    const fail = (message) => problems.push(message);
    const facts = releaseFacts({ root, config, seed });
    const { facade, pixi } = facts;

    if (pixi.range !== pixi.supportedRange) fail(`seed.json pixiAdapters.pixi8.declaredPeers["pixi.js"] is "${pixi.range}", but the manifest's evidence (pixiEpochs.pixi8 minimum/current, excludedVersions) supports "${pixi.supportedRange}": widen the range only by promoting new audited tuples and matrix cells`);
    if (facade.peers['pixi.js'] !== pixi.range) fail(`the facade's pixi.js peer is "${facade.peers['pixi.js']}", the manifest's tested range is "${pixi.range}"`);
    if (facade.peers.react !== facade.expectedReactPeer) fail(`the facade's react peer is "${facade.peers.react}", expected "${facade.expectedReactPeer}" (the newest tested React of the ${facade.reactEpoch} epoch it builds in)`);
    if (facade.reactEpoch !== facts.newestReactEpoch) fail(`the facade builds in the ${facade.reactEpoch} adapter, but the newest React epoch in the manifest is ${facts.newestReactEpoch} (D1)`);
    const constant = readFacadeTestedReact(root);

    if (!constant) fail(`${FACADE_REACT_SOURCE}: TESTED_REACT = Object.freeze({ minor, versions: Object.freeze([...]) }) not found`);
    else if (constant.minor !== facade.reactMinor || JSON.stringify(constant.versions) !== JSON.stringify(facade.reactTested))
    {
        fail(`${FACADE_REACT_SOURCE}: TESTED_REACT is ${constant.minor} ${JSON.stringify(constant.versions)}, the manifest says ${facade.reactMinor} ${JSON.stringify(facade.reactTested)}`);
    }
    const adapterPackage = facade.composedPackages.find((pkg) => pkg.reactEpoch === facade.reactEpoch);

    for (const [field, name] of [['reconciler', 'react-reconciler'], ['itsFine', 'its-fine']])
    {
        if (adapterPackage && facade[field] !== adapterPackage[field]) fail(`the facade's ${name} is ${facade[field]}, the ${adapterPackage.workspaceName} adapter it builds in pins ${adapterPackage[field]}`);
    }
    const planned = (plan?.releases ?? []).find((release) => release.name === facade.workspaceName)?.newVersion ?? facade.version;
    const majors = pixiMajors(facade.peers['pixi.js']);

    if (majors.length !== 1 || Number(planned.split('.')[0]) !== majors[0]) fail(`the facade would release ${planned}, but its major must equal the Pixi major of its pixi.js peer (${majors.join(', ') || 'none'})`);

    return problems;
}

