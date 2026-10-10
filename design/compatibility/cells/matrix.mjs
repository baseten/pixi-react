// Pure functions over the #3 seed manifest: generate adapter compatibility cells, validate the `adapterMatrix` section,
// derive cache keys and render the compatibility table. Nothing here touches the network, npm or the file system
// beyond reading the seed, so `cells.test.mjs` can exercise all of it offline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const here = new URL('.', import.meta.url);
export const seedPath = new URL('../seed.json', import.meta.url);

export const loadSeed = () => JSON.parse(readFileSync(seedPath, 'utf8'));

const parts = (version) => version.split('.').map(Number);
export const compareVersions = (a, b) =>
{
    const [x, y] = [parts(a), parts(b)];

    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const minorOf = (version) => parts(version).slice(0, 2).join('.');
const majorOf = (version) => parts(version)[0];
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/** Audited probe tuples of one package, as `{ version, tuple }`, oldest first. */
function audited(seed, name)
{
    return seed.probes
        .filter((tuple) => tuple.packages[name] && (name !== 'pixi.js' || tuple.kind === 'pixi'))
        .map((tuple) => ({ version: tuple.packages[name], tuple }))
        .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * React versions of one epoch from the audited tuples: the lowest and the highest audited patch of the epoch's minor.
 * The tuple supplies the exact `@types/react` (and the reconciler the epoch expects).
 */
export function reactVersions(seed, epochId)
{
    const epoch = seed.reactEpochs.find((candidate) => candidate.id === epochId);

    assert.ok(epoch, `unknown React epoch ${epochId}`);
    const tuples = audited(seed, 'react').filter(({ version }) => minorOf(version) === epoch.reactMinor);

    assert.ok(tuples.length > 0, `no audited React ${epoch.reactMinor} tuple`);

    return { epoch, minimum: tuples[0], latest: tuples.at(-1) };
}

/** The Pixi adapter the tiers' top-level `react` and `pixi` selections apply to (`adapterMatrix.defaultPixiAdapter`). */
export const defaultPixiAdapter = (seed) => seed.adapterMatrix.defaultPixiAdapter;

/** The `pixiEpochs` row a Pixi adapter targets (its `epoch`): its minimum, current and capability boundaries. */
export function pixiEpochOf(seed, adapterKey)
{
    const adapter = seed.adapterMatrix.pixiAdapters[adapterKey];

    assert.ok(adapter, `unknown Pixi adapter ${adapterKey}`);
    const epoch = seed.pixiEpochs.find((candidate) => candidate.id === adapter.epoch);

    assert.ok(epoch, `${adapterKey}: epoch ${adapter.epoch} is not a pixiEpochs id`);

    return epoch;
}

/**
 * The Pixi minors of an adapter's epoch: for every audited minor of the epoch's major between its minimum and current
 * version, the lowest and highest audited patch that the adapter does not exclude.
 */
export function pixiMinors(seed, adapterKey)
{
    const adapter = seed.adapterMatrix.pixiAdapters[adapterKey];
    const epoch = pixiEpochOf(seed, adapterKey);
    const excluded = new Set(adapter.excludedVersions);
    const byMinor = new Map();

    for (const entry of audited(seed, 'pixi.js'))
    {
        if (majorOf(entry.version) !== majorOf(epoch.minimum) || excluded.has(entry.version)) continue;
        if (compareVersions(entry.version, epoch.minimum) < 0 || compareVersions(entry.version, epoch.current) > 0) continue;
        const minor = minorOf(entry.version);

        byMinor.set(minor, [...(byMinor.get(minor) ?? []), entry]);
    }

    return [...byMinor.entries()].map(([minor, list]) => ({ minor, minimum: list[0], latest: list.at(-1) }))
        .sort((a, b) => compareVersions(`${a.minor}.0`, `${b.minor}.0`));
}

/** Capability IDs the Pixi adapter must provide at `version`, from the seed's capability boundaries. */
export function expectedPixiProvides(seed, adapterKey, version)
{
    const { capabilities } = seed.adapterMatrix.pixiAdapters[adapterKey];
    const boundaries = pixiEpochOf(seed, adapterKey).capabilityBoundaries ?? {};
    const provides = Object.fromEntries(capabilities.always.map((id) => [id, 1]));

    for (const [capability, boundary] of Object.entries(capabilities.fromBoundary))
    {
        if (compareVersions(version, boundaries[boundary]) >= 0) provides[capability] = 1;
    }

    return provides;
}

function describeReact(seed, epochId, version)
{
    const matrix = seed.adapterMatrix;
    const adapterKey = epochId;
    const adapter = matrix.reactAdapters[adapterKey];
    const tuple = seed.probes.find((probe) => probe.id === `react-${version}`);

    assert.ok(adapter, `no React adapter row for ${epochId}`);

    return { epoch: epochId, adapterKey, adapter, version, tuple };
}

/**
 * The render backends of a cell: the requested ones (a tier's `renderers`, `webgl` when none is given) that the Pixi
 * adapter's `renderers` row lists, in the manifest's order. Pixi 7, for example, has no WebGPU renderer.
 */
export function cellRenderers(seed, pixiAdapterKey, requested)
{
    const matrix = seed.adapterMatrix;
    const available = Object.keys(matrix.pixiAdapters[pixiAdapterKey].renderers ?? {});
    const wanted = requested ?? ['webgl'];

    return Object.keys(matrix.renderers).filter((name) => wanted.includes(name) && available.includes(name));
}

/** The render backends a tier asks for (`tiers.<tier>.renderers`), or an explicit `--renderers` override. */
export const tierRenderers = (seed, tier, override) => override ?? seed.adapterMatrix.tiers[tier].renderers ?? ['webgl'];

/** Builds one cell from a React selection and a Pixi version. */
export function makeCell(seed, { react, pixi, commands, negative }, options = {})
{
    const matrix = seed.adapterMatrix;
    const reactSel = describeReact(seed, react.epoch, react.version);
    const pixiAdapterKey = pixi.adapter ?? defaultPixiAdapter(seed);
    const pixiAdapter = matrix.pixiAdapters[pixiAdapterKey];
    const epoch = seed.reactEpochs.find((candidate) => candidate.id === react.epoch);
    const types = {
        '@types/react': react.typesReact ?? reactSel.tuple?.packages['@types/react'],
        '@types/react-dom': react.typesReactDom ?? reactSel.adapter.typesReactDom,
    };
    const order = matrix.commands.order;
    const selected = commands ?? order;
    const needsTypes = selected.includes('types');
    const deps = {
        react: react.version,
        'react-dom': react.version,
        'pixi.js': pixi.version,
        ...(needsTypes ? types : {}),
    };

    return {
        id: negative ? `negative-${negative.id}` : `react-${react.version}_pixi-${pixi.version}`,
        label: negative ? negative.id : `${reactSel.adapter.id} @ react ${react.version} x ${pixiAdapter.id} @ pixi.js ${pixi.version}`,
        kind: negative ? 'negative' : 'cell',
        epoch: react.epoch,
        react: { ...reactSel, version: react.version, reconciler: epoch.reconciler },
        pixi: { adapterKey: pixiAdapterKey, adapter: pixiAdapter, version: pixi.version, roles: pixi.roles ?? [] },
        deps,
        // Everything the cell installs on top of the packed artifacts, exactly: this is also the npm download-cache key.
        toolchain: matrix.toolchain,
        install: negative?.install ?? {},
        commands: selected.filter((name) => order.includes(name)).sort((a, b) => order.indexOf(a) - order.indexOf(b)),
        // Render backends the conformance command runs, each separately: those the tier asks for that the Pixi adapter has.
        renderers: cellRenderers(seed, pixiAdapterKey, options.renderers),
        expect: negative?.expect ?? null,
        description: negative?.description ?? null,
        ...(options.extra ?? {}),
    };
}

/** Artifact ids a cell installs. */
export function cellArtifacts(seed, cell)
{
    const matrix = seed.adapterMatrix;

    return [...new Set([...matrix.commonArtifacts, cell.react.adapter.artifact, cell.pixi.adapter.artifact])];
}

/** The reconciler a cell expects: bundled adapters contribute none to the tree, dependency-style adapters exactly one. */
export function expectedTree(cell)
{
    const { adapter, version } = cell.react;
    const exact = { react: version, 'react-dom': version, 'pixi.js': cell.pixi.version, ...cell.deps };
    const absent = [...adapter.bundled];
    let reconciler = null;

    if (adapter.reconciler.via === 'dependency')
    {
        reconciler = cell.react.reconciler;
        absent.splice(absent.indexOf('react-reconciler'), 1);
    }

    return { exact, absent, reconciler };
}

function reactCells(seed, selection, patches)
{
    const epochs = selection.epochs === 'all' ? Object.keys(seed.adapterMatrix.reactAdapters) : selection.epochs;
    const result = [];

    for (const epochId of epochs)
    {
        const { minimum, latest } = reactVersions(seed, epochId);
        const choice = patches ?? selection.patch;
        const versions = choice === 'all' ? [...new Set([minimum.version, latest.version])] : [latest.version];

        for (const version of versions) result.push({ epoch: epochId, version, patch: version === latest.version ? 'latest' : 'minimum' });
    }

    return result;
}

/** The `minimum` and `current` versions of an adapter's epoch, by role name. */
function pixiRoles(seed, adapterKey)
{
    const epoch = pixiEpochOf(seed, adapterKey);

    return { minimum: epoch.minimum, current: epoch.current };
}

function pixiSelections(seed, adapterKey, selection)
{
    if (selection.versions === 'all-minors') return pixiMinors(seed, adapterKey).map(({ latest }) => ({ adapter: adapterKey, version: latest.version, roles: [] }));
    const roles = pixiRoles(seed, adapterKey);

    return selection.versions.map((name) => ({ adapter: adapterKey, version: roles[name], roles: [name] }));
}

/**
 * The (React, Pixi) selections of a tier. The tier's top-level `react` and `pixi` form a cross product with the default
 * Pixi adapter. Each entry of `pixiAdapters` adds cells for another Pixi adapter: either a cross product of its own
 * `react` and `pixi` selections, or explicit `pairs` of a React epoch (at its latest patch) and a Pixi role.
 */
function tierSelections(seed, tier, patches)
{
    const config = seed.adapterMatrix.tiers[tier];
    const product = (adapterKey, selection) => pixiSelections(seed, adapterKey, selection.pixi)
        .flatMap((pixi) => reactCells(seed, selection.react, patches).map((react) => ({ react, pixi })));
    const selections = product(defaultPixiAdapter(seed), config);

    for (const [adapterKey, extra] of Object.entries(config.pixiAdapters ?? {}))
    {
        if (!extra.pairs)
        {
            selections.push(...product(adapterKey, extra));
            continue;
        }
        const roles = pixiRoles(seed, adapterKey);

        for (const pair of extra.pairs)
        {
            const { latest } = reactVersions(seed, pair.react);

            selections.push({ react: { epoch: pair.react, version: latest.version, patch: 'latest' }, pixi: { adapter: adapterKey, version: roles[pair.pixi], roles: [pair.pixi] } });
        }
    }

    return selections;
}

/**
 * Cells of a tier. `patches` overrides the tier's React patch selection ('latest' or 'all') of its cross products;
 * `filter` keeps cells whose id or label contains any listed substring.
 */
export function selectCells(seed, tier, { patches, filter, renderers } = {})
{
    assert.ok(seed.adapterMatrix.tiers[tier], `unknown tier ${tier}`);
    const chosen = tierRenderers(seed, tier, renderers);
    const cells = tierSelections(seed, tier, patches).map(({ react, pixi }) => makeCell(seed, { react, pixi }, { renderers: chosen }));

    const unique = new Set(cells.map((cell) => cell.id));

    assert.equal(unique.size, cells.length, 'duplicate cell id');

    return filter?.length ? cells.filter((cell) => filter.some((part) => cell.id.includes(part) || cell.label.includes(part))) : cells;
}

export function negativeCells(seed)
{
    return seed.adapterMatrix.negative.map((negative) => makeCell(seed, {
        react: { epoch: negative.react.epoch, version: negative.react.version, typesReact: negative.react.typesReact, typesReactDom: negative.react.typesReactDom },
        pixi: { adapter: negative.pixi.adapter, version: negative.pixi.version },
        commands: negative.commands,
        negative,
    }));
}

/** Boundary probe tuple IDs of a tier, each with the reason it is there. */
export function boundaryProbes(seed, tier)
{
    const selection = seed.adapterMatrix.tiers[tier].boundaryProbes;

    if (selection === 'all')
    {
        // Every audited React tuple, and every audited Pixi tuple of a major some Pixi adapter targets.
        const majors = new Set(Object.keys(seed.adapterMatrix.pixiAdapters).map((key) => majorOf(pixiEpochOf(seed, key).minimum)));

        return seed.probes.filter((tuple) => tuple.kind === 'react' || (tuple.kind === 'pixi' && majors.has(majorOf(tuple.packages['pixi.js']))))
            .map((tuple) => ({ id: tuple.id, boundary: 'audited tuple' }));
    }

    return selection;
}

/** Structural validation of the `adapterMatrix` section against the rest of the seed. Offline. */
export function validateAdapterMatrix(seed)
{
    const matrix = seed.adapterMatrix;

    assert.equal(matrix.schemaVersion, 1);
    for (const [id, artifact] of Object.entries(matrix.artifacts))
    {
        assert.match(artifact.dir, /^packages\/[a-z0-9.-]+$/, `artifact ${id} dir`);
        assert.match(artifact.package, /^@[a-z0-9-]+\/[a-z0-9.-]+$/, `artifact ${id} package`);
    }
    for (const id of matrix.commonArtifacts) assert.ok(matrix.artifacts[id], `common artifact ${id}`);
    for (const command of matrix.commands.order) assert.ok(Number.isInteger(matrix.commands.timeoutSeconds[command]), `timeout for ${command}`);
    const backends = Object.keys(matrix.renderers ?? {});

    assert.ok(backends.includes('webgl'), 'renderers must define webgl');
    for (const name of backends) assert.ok(Array.isArray(matrix.renderers[name].chromiumArgs), `renderers.${name}.chromiumArgs`);
    for (const [tier, config] of Object.entries(matrix.tiers))
    {
        assert.ok(Array.isArray(config.renderers) && config.renderers.length > 0, `${tier}: renderers`);
        for (const name of config.renderers) assert.ok(backends.includes(name), `${tier}: unknown renderer ${name}`);
    }

    for (const [key, adapter] of Object.entries(matrix.reactAdapters))
    {
        const epoch = seed.reactEpochs.find((candidate) => candidate.id === key);

        assert.ok(epoch, `reactAdapters.${key} must be a reactEpochs id`);
        assert.ok(matrix.artifacts[adapter.artifact], `${key}: artifact`);
        assert.match(adapter.entry, /^(\.|\.\/[\w.-]+)$/, `${key}: entry`);
        assert.match(adapter.className, /^[A-Za-z0-9_]+$/, `${key}: className`);
        assert.ok(['entry', 'package'].includes(adapter.hashScope), `${key}: hashScope`);
        assert.ok(Number.isInteger(adapter.abi.major) && Number.isInteger(adapter.abi.minor), `${key}: abi`);
        assert.ok(['bundled', 'dependency'].includes(adapter.reconciler.via), `${key}: reconciler.via`);
        assert.ok(Array.isArray(adapter.bundled), `${key}: bundled`);
        assert.ok(adapter.declaredPeers.react, `${key}: declaredPeers.react`);

        const { minimum, latest } = reactVersions(seed, key);

        for (const { version, tuple } of [minimum, latest])
        {
            assert.equal(tuple.packages['react-reconciler'], epoch.reconciler, `${key}: ${version} reconciler matches the epoch`);
            assert.ok(seed.registry.react.selected[version], `${key}: ${version} registry entry`);
        }
        assert.ok(adapter.typesReactDom, `${key}: typesReactDom`);
    }
    assert.ok(matrix.pixiAdapters[matrix.defaultPixiAdapter], 'defaultPixiAdapter must name a pixiAdapters row');
    for (const [key, adapter] of Object.entries(matrix.pixiAdapters))
    {
        assert.ok(matrix.artifacts[adapter.artifact], `${key}: artifact`);
        assert.ok(adapter.declaredPeers['pixi.js'], `${key}: declaredPeers`);
        const boundaries = pixiEpochOf(seed, key).capabilityBoundaries ?? {};

        for (const boundary of Object.values(adapter.capabilities.fromBoundary)) assert.ok(boundaries[boundary], `${key}: boundary ${boundary}`);
        assert.match(adapter.probeFactory, /^[A-Za-z0-9_]+$/, `${key}: probeFactory`);
        assert.ok(adapter.conformanceAppOptions && typeof adapter.conformanceAppOptions === 'object', `${key}: conformanceAppOptions`);
        assert.ok(Array.isArray(adapter.conformanceCapabilities), `${key}: conformanceCapabilities`);
        assert.ok(adapter.renderers?.webgl, `${key}: renderers.webgl`);
        for (const [name, backend] of Object.entries(adapter.renderers)) assert.ok(backends.includes(name) && backend.appOptions && typeof backend.appOptions === 'object', `${key}: renderers.${name}`);
        assert.match(adapter.typeConsumer, /^consumer\.[\w-]+\.tsx$/, `${key}: typeConsumer (a harness/typecheck file; cells.test.mjs checks it exists)`);
    }

    const probeIds = new Set(seed.probes.map((tuple) => tuple.id));

    for (const tier of Object.keys(matrix.tiers))
    {
        const { boundaryProbes: selection } = matrix.tiers[tier];

        for (const [key, extra] of Object.entries(matrix.tiers[tier].pixiAdapters ?? {}))
        {
            assert.ok(matrix.pixiAdapters[key] && key !== matrix.defaultPixiAdapter, `${tier}: pixiAdapters.${key} must be another Pixi adapter`);
            for (const pair of extra.pairs ?? [])
            {
                assert.ok(matrix.reactAdapters[pair.react], `${tier}: pixiAdapters.${key}: unknown React epoch ${pair.react}`);
                assert.ok(['minimum', 'current'].includes(pair.pixi), `${tier}: pixiAdapters.${key}: pixi must be minimum or current`);
            }
        }

        if (selection !== 'all') for (const probe of selection) assert.ok(probeIds.has(probe.id), `${tier}: unknown probe ${probe.id}`);
        assert.ok(selectCells(seed, tier).length > 0, `${tier}: no cells`);
    }
    // The owner-mandated PR boundaries must stay covered even if the list is edited.
    const pr = new Set(matrix.tiers.pr.boundaryProbes.map((probe) => probe.id));

    for (const required of ['pixi-8.2.6', 'pixi-8.5.0', 'pixi-8.5.2', 'pixi-8.7.0', 'pixi-8.9.0', 'pixi-8.10.0', 'pixi-8.22.0']) assert.ok(pr.has(required), `PR tier must probe ${required}`);
    // CI cost (issue 16): a Pixi adapter other than the default adds at most two cells to the required PR check; its
    // full cross product runs nightly.
    for (const key of Object.keys(matrix.pixiAdapters).filter((name) => name !== matrix.defaultPixiAdapter))
    {
        const count = selectCells(seed, 'pr').filter((cell) => cell.pixi.adapterKey === key).length;

        assert.ok(count <= 2, `PR tier: ${key} adds ${count} cells; at most 2 (run the rest nightly)`);
    }

    for (const cell of [...selectCells(seed, 'nightly', { patches: 'all' }), ...negativeCells(seed)])
    {
        assert.ok(cell.react.tuple, `${cell.id}: no audited React tuple`);
        assert.ok(seed.probes.some((tuple) => tuple.id === `pixi-${cell.pixi.version}`), `${cell.id}: pixi.js ${cell.pixi.version} has no audited tuple`);
        if (cell.kind === 'cell') assert.equal(majorOf(cell.pixi.version), majorOf(pixiEpochOf(seed, cell.pixi.adapterKey).minimum), `${cell.id}: pixi.js ${cell.pixi.version} is not in the ${cell.pixi.adapterKey} epoch`);
        assert.equal(cell.deps['pixi.js'], cell.pixi.version);
        for (const [name, version] of Object.entries(cell.deps)) assert.match(version, /^\d+\.\d+\.\d+$/, `${cell.id}: ${name} must be an exact version`);
    }
    for (const negative of matrix.negative)
    {
        assert.ok(negative.expect.signatures.length > 0 && matrix.commands.order.includes(negative.expect.failingCommand), `negative ${negative.id}`);
    }
}

/** sha256 of the sorted `[path, sha256]` list: the identity of a set of files. */
export const fileSetHash = (files) => sha256(Object.keys(files).sort().map((path) => [path, files[path]]));

/**
 * Cache key of a cell: everything that can change its verdict, including the cell's manifest rows. `artifacts` is
 * the pack step's `artifacts.json`;
 * `harness` is a hash of the harness files and runner. Tarball bytes are not used (tar metadata may vary): the key
 * uses the content hash of the files, and for an adapter with `hashScope: "entry"` only the files its export entry
 * can reach, so an edit to one entry leaves the other entries' keys alone.
 */
export function cellKey(seed, cell, artifacts, harness, environment, effective = null)
{
    const used = {};
    const adapterArtifacts = new Map([[cell.react.adapter.artifact, cell.react.adapter], [cell.pixi.adapter.artifact, cell.pixi.adapter]]);

    for (const id of cellArtifacts(seed, cell))
    {
        const artifact = artifacts[id];

        assert.ok(artifact, `artifact ${id} was not packed`);
        const adapter = adapterArtifacts.get(id);
        const scoped = adapter?.hashScope === 'entry' ? artifact.entries[adapter.entry] : null;

        assert.ok(!adapter || adapter.hashScope !== 'entry' || scoped, `artifact ${id}: no entry scope for ${adapter?.entry}`);
        used[id] = scoped ? { scope: `entry ${adapter.entry}`, hash: scoped.hash } : { scope: 'package', hash: artifact.hash };
    }

    // The effective manifest rows (ABI, capabilities, peers, expected failures, probes) decide what the checks assert.
    // `effective` is the generated cell configuration the harness asserts (derived capabilities, formats, tree);
    // callers that run cells pass it so indirect manifest inputs also invalidate the verdict.
    const config = { react: cell.react, pixi: cell.pixi, install: cell.install, renderers: cell.renderers, effective };
    const input = { schema: 3, id: cell.id, commands: cell.commands, deps: cell.deps, toolchain: cell.toolchain, artifacts: used, harness, environment, expect: cell.expect, config };

    return { key: sha256(input).slice(0, 40), depsKey: sha256({ deps: cell.deps, toolchain: cell.toolchain, commands: cell.commands, environment }).slice(0, 40), input };
}

const statusMark = { pass: 'pass', 'cached-pass': 'pass (cached)', 'expected-fail': 'expected failure', fail: 'FAIL', skipped: 'not run' };
const backendLabel = { webgl: 'WebGL', webgpu: 'WebGPU' };

/** A result cell's text: its status, and with per-backend results the status of each backend it ran. */
function resultMark(row)
{
    const known = row.knownFailures?.length && row.status !== 'fail' ? ` + ${row.knownFailures.length} known defect` : '';
    const backends = Object.entries(row.backends ?? {});

    if (!backends.length || row.status === 'cached-pass') return `${statusMark[row.status] ?? row.status}${known}`;
    if (backends.every(([, backend]) => backend.status === 'pass')) return `pass (${backends.map(([name]) => backendLabel[name] ?? name).join(', ')})${known}`;

    return `${statusMark[row.status] ?? row.status}: ${backends.map(([name, backend]) => `${backendLabel[name] ?? name} ${backend.status === 'pass' ? 'pass' : backend.status.toUpperCase()}`).join(', ')}${known}`;
}

/** Markdown compatibility table (React adapters by Pixi version) from result rows `{ id, react, pixi, status }`. */
export function renderTable(seed, rows, { title = 'Adapter compatibility table', manifestOnly = false, intro = true } = {})
{
    const cells = rows.filter((row) => row.kind !== 'negative');
    const pixiVersions = [...new Set(cells.map((row) => row.pixiVersion))].sort(compareVersions);
    const reactKeys = [...new Set(cells.map((row) => `${row.adapterLabel}|${row.reactVersion}`))].sort((a, b) =>
        compareVersions(a.split('|')[1], b.split('|')[1]));
    const lookup = new Map(cells.map((row) => [`${row.adapterLabel}|${row.reactVersion}|${row.pixiVersion}`, row]));
    const lines = [`# ${title}`, ''];

    if (intro) lines.push(manifestOnly
        ? 'Generated from `design/compatibility/seed.json` (`adapterMatrix`). These are the cells CI runs, not a support certificate: the certified ranges stay empty until the owner promotes them.'
        : 'Each cell installs the packed adapters into an isolated project with exactly the listed React, react-dom and pixi.js, then checks the dependency tree, ESM/CJS imports and ABI, declaration consumers and the real-browser conformance suite.');
    lines.push('', `| React adapter @ React | ${pixiVersions.map((version) => `pixi.js ${version}`).join(' | ')} |`, `| --- | ${pixiVersions.map(() => '---').join(' | ')} |`);
    for (const key of reactKeys)
    {
        const [adapter, version] = key.split('|');

        lines.push(`| ${adapter} @ ${version} | ${pixiVersions.map((pixi) =>
        {
            const row = lookup.get(`${key}|${pixi}`);

            return row ? (manifestOnly ? 'cell' : resultMark(row)) : '-';
        }).join(' | ')} |`);
    }
    const negatives = rows.filter((row) => row.kind === 'negative');

    if (negatives.length)
    {
        lines.push('', '## Deliberately incompatible pairs', '', '| Case | Expected failing command | Result | Message |', '| --- | --- | --- | --- |');
        for (const row of negatives) lines.push(`| ${row.label} | ${row.expect?.failingCommand ?? '-'} | ${manifestOnly ? 'planned' : statusMark[row.status] ?? row.status} | ${(row.message ?? row.description ?? '').slice(0, 400).replaceAll('|', '\\|').replaceAll('\n', ' ')} |`);
    }

    return `${lines.join('\n')}\n`;
}

/** Rows for a manifest-only table (no run). */
export function plannedRows(seed, tier, options)
{
    const toRow = (cell) => ({
        id: cell.id,
        kind: cell.kind,
        label: cell.label,
        adapterLabel: cell.react.adapter.id,
        reactVersion: cell.react.version,
        pixiVersion: cell.pixi.version,
        status: 'skipped',
        expect: cell.expect,
        description: cell.description,
    });

    return [...selectCells(seed, tier, options).map(toRow), ...negativeCells(seed).map(toRow)];
}

/** The checked-in compatibility document: both tiers, generated from the seed. `cells.test.mjs` keeps it current. */
export function renderCompatibilityDoc(seed)
{
    const matrix = seed.adapterMatrix;
    const section = (tier) => renderTable(seed, plannedRows(seed, tier), { title: `${tier === 'pr' ? 'PR tier' : 'Nightly tier'} (${selectCells(seed, tier).length} cells)`, manifestOnly: true, intro: false }).replace(/^# /, '## ').replace(/^## Deliberately[\s\S]*$/m, '');
    const probes = (tier) => boundaryProbes(seed, tier);
    const lines = [
        '# Adapter compatibility cells',
        '',
        '<!-- Generated by `node design/compatibility/cells/run-cells.mjs doc`; do not edit. Source: `adapterMatrix` in seed.json. -->',
        '',
        'This is the list of compatibility cells CI runs (issue 13), not a support certificate: `advertisedRanges` stays empty until the owner promotes a range. Each cell installs the packed adapters into an isolated project with exactly the listed React, react-dom and pixi.js. Results are published by the Compatibility workflows (job summary and the `compatibility-table` artifact).',
        '',
        `Required PR check: **Compatibility (required)**. Nightly: **Compatibility (nightly)**, ${selectCells(seed, 'nightly').length} cells (${selectCells(seed, 'nightly', { patches: 'all' }).length} with minimum and latest React patches).`,
        '',
        `Pixi adapters: ${Object.keys(matrix.pixiAdapters).map((key) =>
        {
            const epoch = pixiEpochOf(seed, key);

            return `\`${matrix.pixiAdapters[key].id}\` for the pixi.js ${epoch.minimum} … ${epoch.current} columns (${selectCells(seed, 'pr').filter((cell) => cell.pixi.adapterKey === key).length} PR-tier cells)`;
        }).join('; ')}. A column's pixi.js major selects the adapter.`,
        '',
        section('pr'),
        '### PR tier boundary probes',
        '',
        '| Tuple | Boundary |',
        '| --- | --- |',
        ...probes('pr').map((probe) => `| ${probe.id} | ${probe.boundary} |`),
        '',
        section('nightly'),
        `Nightly also re-runs all ${probes('nightly').length} audited tuples as boundary probes.`,
        '',
        '## Deliberately incompatible pairs',
        '',
        '| Case | Fails at | Expected message contains |',
        '| --- | --- | --- |',
        ...matrix.negative.map((negative) => `| ${negative.id}: ${negative.description} | ${negative.expect.failingCommand} | ${negative.expect.signatures.map((signature) => `\`${signature.replaceAll('|', '\\|')}\``).join(', ')} |`),
        '',
        '## Commands each cell runs',
        '',
        ...matrix.commands.order.map((command) => `- \`${command}\` (timeout ${matrix.commands.timeoutSeconds[command]}s)`),
        '',
    ];

    return lines.join('\n');
}
