// Pure functions over the #3 seed manifest: generate adapter compatibility cells, validate the `adapterMatrix` section,
// derive cache keys and render the compatibility table. Nothing here touches the network, npm or the file system
// beyond reading the seed (and `makeCellDir`, which creates a cell's temp directory through injectable functions), so
// `cells.test.mjs` can exercise all of it offline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * The version-dependent type assertions of a Pixi adapter's declaration consumer at one pixi.js version: each
 * `typeAssertions` entry (marked `compat:begin <id>` … `compat:end <id>` in the consumer) is kept from its `from`
 * version on and omitted below it, with the reason recorded in the cell configuration. Never silently.
 */
export function typeAssertionsFor(seed, adapterKey, version)
{
    const entries = Object.entries(seed.adapterMatrix.pixiAdapters[adapterKey].typeAssertions ?? {});

    return {
        kept: entries.filter(([, assertion]) => compareVersions(version, assertion.from) >= 0).map(([id]) => id),
        omitted: entries.filter(([, assertion]) => compareVersions(version, assertion.from) < 0).map(([id, assertion]) => ({ id, from: assertion.from, reason: assertion.reason })),
    };
}

/**
 * Removes the `compat:begin <id>` … `compat:end <id>` blocks of the type assertions this cell omits from a consumer
 * file, leaving a comment that names the assertion and why; keeps (and unmarks) the others. A marker of an assertion
 * the manifest does not declare fails the cell.
 */
export function applyTypeAssertions(text, { kept, omitted })
{
    const known = new Set([...kept, ...omitted.map(({ id }) => id)]);

    return text.replace(/^([ \t]*)\{?\/\*\s*compat:begin ([a-z0-9-]+)\s*\*\/\}?\n([\s\S]*?)^[ \t]*\{?\/\*\s*compat:end \2\s*\*\/\}?\n/gm, (_match, indent, id, body) =>
    {
        assert.ok(known.has(id), `consumer marker compat:begin ${id} is not an adapterMatrix typeAssertions entry`);
        const skipped = omitted.find((entry) => entry.id === id);

        return skipped ? `${indent}{/* type assertion ${id} omitted below pixi.js ${skipped.from}: ${skipped.reason.replaceAll('*/', '* /')} */}\n` : body;
    });
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

/**
 * Every audited pixi.js version of an adapter's epoch between its minimum and current that the adapter does not exclude,
 * oldest first (`versions: "all-audited"`; the Pixi 7 adapter's nightly columns: the lowest and highest audited patch
 * of each minor).
 */
export function pixiAudited(seed, adapterKey)
{
    return pixiMinors(seed, adapterKey).flatMap(({ minimum, latest }) => [...new Set([minimum.version, latest.version])]);
}

function pixiSelections(seed, adapterKey, selection)
{
    if (selection.versions === 'all-minors') return pixiMinors(seed, adapterKey).map(({ latest }) => ({ adapter: adapterKey, version: latest.version, roles: [] }));
    if (selection.versions === 'all-audited') return pixiAudited(seed, adapterKey).map((version) => ({ adapter: adapterKey, version, roles: [] }));
    const roles = pixiRoles(seed, adapterKey);

    return selection.versions.map((name) => ({ adapter: adapterKey, version: roles[name], roles: [name] }));
}

/**
 * The (React, Pixi) selections of a tier. The tier's top-level `react` and `pixi` form a cross product with the default
 * Pixi adapter, and its optional `pairs` add explicit cells with it. Each entry of `pixiAdapters` adds cells for another
 * Pixi adapter: either a cross product of its own `react` and `pixi` selections, or explicit `pairs`. A pair is a React
 * epoch (at its latest patch) and a Pixi role (`minimum` or `current`).
 */
function tierSelections(seed, tier, patches)
{
    const config = seed.adapterMatrix.tiers[tier];
    const product = (adapterKey, selection) => pixiSelections(seed, adapterKey, selection.pixi)
        .flatMap((pixi) => reactCells(seed, selection.react, patches).map((react) => ({ react, pixi })));
    const paired = (adapterKey, pairs) =>
    {
        const roles = pixiRoles(seed, adapterKey);

        return pairs.map((pair) =>
        {
            const { latest } = reactVersions(seed, pair.react);

            return { react: { epoch: pair.react, version: latest.version, patch: 'latest' }, pixi: { adapter: adapterKey, version: roles[pair.pixi], roles: [pair.pixi] } };
        });
    };
    const selections = [...product(defaultPixiAdapter(seed), config), ...paired(defaultPixiAdapter(seed), config.pairs ?? [])];

    for (const [adapterKey, extra] of Object.entries(config.pixiAdapters ?? {}))
    {
        selections.push(...(extra.pairs ? paired(adapterKey, extra.pairs) : product(adapterKey, extra)));
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
    for (const name of backends) assert.ok(typeof matrix.renderers[name].label === 'string', `renderers.${name}.label`);
    assert.ok(matrix.gpuProfiles?.[matrix.defaultGpuProfile], 'defaultGpuProfile must name a gpuProfiles row');
    assert.ok(Array.isArray(matrix.softwareRendererPatterns) && matrix.softwareRendererPatterns.length > 0, 'softwareRendererPatterns');
    for (const [id, profile] of Object.entries(matrix.gpuProfiles))
    {
        assert.ok(typeof profile.description === 'string' && profile.description.length > 0, `gpuProfiles.${id}.description`);
        assert.equal(typeof profile.headless, 'boolean', `gpuProfiles.${id}.headless`);
        assert.ok(['software', 'hardware'].includes(profile.expect), `gpuProfiles.${id}.expect`);
        for (const name of backends) assert.ok(Array.isArray(profile.chromiumArgs?.[name]), `gpuProfiles.${id}.chromiumArgs.${name}`);
        // A hardware profile must not ask for a software renderer: it would record SwiftShader as a GPU.
        if (profile.expect === 'hardware')
        {
            for (const arg of Object.values(profile.chromiumArgs).flat()) assert.doesNotMatch(arg, /swiftshader|use-webgpu-adapter|use-gl=|use-angle=/i, `gpuProfiles.${id}: ${arg} selects a software path`);
        }
    }
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
        // A type assertion that holds only from some pixi.js version on names that version and why (typeAssertionsFor).
        for (const [id, assertion] of Object.entries(adapter.typeAssertions ?? {}))
        {
            assert.match(id, /^[a-z0-9-]+$/, `${key}: typeAssertions id ${id}`);
            assert.match(assertion.from ?? '', /^\d+\.\d+\.\d+$/, `${key}: typeAssertions.${id}.from`);
            assert.ok(typeof assertion.reason === 'string' && assertion.reason.length >= 20, `${key}: typeAssertions.${id}.reason`);
        }
        for (const version of adapter.excludedVersions) assert.match(version, /^\d+\.\d+\.\d+$/, `${key}: excludedVersions`);
    }

    const probeIds = new Set(seed.probes.map((tuple) => tuple.id));

    for (const tier of Object.keys(matrix.tiers))
    {
        const { boundaryProbes: selection } = matrix.tiers[tier];

        for (const pair of matrix.tiers[tier].pairs ?? [])
        {
            assert.ok(matrix.reactAdapters[pair.react], `${tier}: pairs: unknown React epoch ${pair.react}`);
            assert.ok(['minimum', 'current'].includes(pair.pixi), `${tier}: pairs: pixi must be minimum or current`);
        }
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
    validateKnownIssues(seed);
    validateEnvironmentShims(seed);
}

/** The adapter key of a Pixi adapter given by key (`pixi8`) or id (`pixi-8`). */
function pixiAdapterKey(seed, pixiAdapter)
{
    const adapters = seed.adapterMatrix.pixiAdapters;

    return adapters[pixiAdapter] ? pixiAdapter : Object.keys(adapters).find((candidate) => adapters[candidate].id === pixiAdapter);
}

const inRange = (version, range) => compareVersions(version, range.from) >= 0 && compareVersions(version, range.before) < 0;

/** The action kinds an environment shim may take (harness/test/environment-shims.ts implements each). */
export const SHIM_ACTIONS = ['clamp-webgl-parameter'];

/**
 * Environment shims (`adapterMatrix.environmentShims`): labelled workarounds for an upstream bug that the harness applies
 * to one backend of one Pixi adapter on a pixi.js range (`from` inclusive, `before` exclusive), under every GPU profile,
 * so the matrix measures this project's adapters rather than the bug (owner ruling, 2026-10-11). Every backend run
 * records the shims it applied; a tuple verified with a shim stays verified and carries the shim id, and every generated
 * table marks it with its known issue's footnote. `pixiAdapter` is the adapter key (`pixi8`) or its id (`pixi-8`).
 */
export function environmentShimsFor(seed, { pixiAdapter, renderer, pixi })
{
    const key = pixiAdapterKey(seed, pixiAdapter);

    return (seed.adapterMatrix.environmentShims ?? []).filter((shim) => shim.pixiAdapter === key && shim.renderer === renderer && inRange(pixi, shim.pixi));
}

/**
 * Structural checks of `adapterMatrix.environmentShims`: an id, a backend the adapter has, an exact range that ends at or
 * below `fixedIn` and covers a nightly cell, a known action, what it does, a reason and https links, and the known issue
 * it works around (same adapter and backend, a range that contains the shim's, the same `fixedIn`). A shim that changes
 * WebGL parameters never applies to a WebGL run: it would change what that backend measures.
 */
export function validateEnvironmentShims(seed)
{
    const matrix = seed.adapterMatrix;
    const ids = new Set();
    const nightly = selectCells(seed, 'nightly', { patches: 'all' });

    assert.ok(!('expectedBlankRender' in matrix), 'expectedBlankRender was replaced by environmentShims (owner ruling, 2026-10-11)');
    assert.ok(Array.isArray(matrix.environmentShims ?? []), 'environmentShims must be a list');
    for (const shim of matrix.environmentShims ?? [])
    {
        const where = `environmentShims ${shim.id ?? '(no id)'}`;

        assert.match(shim.id ?? '', /^[a-z0-9.-]+$/, `${where}: id`);
        assert.ok(!ids.has(shim.id), `${where}: duplicate id`);
        ids.add(shim.id);
        const adapter = matrix.pixiAdapters[shim.pixiAdapter];

        assert.ok(adapter, `${where}: unknown Pixi adapter ${shim.pixiAdapter}`);
        assert.ok(adapter.renderers[shim.renderer], `${where}: ${adapter.id} has no ${shim.renderer} renderer`);
        for (const field of ['from', 'before']) assert.match(shim.pixi?.[field] ?? '', /^\d+\.\d+\.\d+$/, `${where}: pixi.${field} (an exact version)`);
        assert.ok(compareVersions(shim.pixi.from, shim.pixi.before) < 0, `${where}: pixi.from must be below pixi.before`);
        assert.match(shim.fixedIn ?? '', /^\d+\.\d+\.\d+$/, `${where}: fixedIn`);
        assert.ok(compareVersions(shim.pixi.before, shim.fixedIn) <= 0, `${where}: the range must end at or below fixedIn ${shim.fixedIn} (a fixed pixi.js never runs with the shim)`);
        assert.ok(nightly.some((cell) => cell.pixi.adapterKey === shim.pixiAdapter && cell.renderers.includes(shim.renderer) && inRange(cell.pixi.version, shim.pixi)), `${where}: no nightly ${shim.renderer} cell is in its range`);
        assert.ok(SHIM_ACTIONS.includes(shim.action?.kind), `${where}: action.kind must be one of ${SHIM_ACTIONS.join(', ')}`);
        if (shim.action.kind === 'clamp-webgl-parameter')
        {
            assert.notEqual(shim.renderer, 'webgl', `${where}: a WebGL parameter clamp never applies to a WebGL run`);
            assert.match(shim.action.parameter ?? '', /^[A-Z0-9_]+$/, `${where}: action.parameter (the WebGL constant's name)`);
            assert.ok(Number.isInteger(shim.action.enum) && Number.isInteger(shim.action.max) && shim.action.max > 0, `${where}: action.enum and action.max`);
        }
        for (const field of ['does', 'reason', 'evidence']) assert.ok(typeof shim[field] === 'string' && shim[field].trim().length >= 20, `${where}: ${field} is required`);
        assert.ok(Array.isArray(shim.links) && shim.links.length > 0, `${where}: links`);
        for (const link of shim.links) assert.ok(typeof link.label === 'string' && link.label && (/^https:\/\//).test(link.url ?? ''), `${where}: each link needs a label and an https url`);
        const issue = (matrix.knownIssues ?? []).find((candidate) => candidate.id === shim.knownIssue);

        assert.ok(issue, `${where}: knownIssue ${shim.knownIssue} is not an adapterMatrix.knownIssues id`);
        assert.ok(issue.pixiAdapter === shim.pixiAdapter && issue.renderer === shim.renderer, `${where}: its known issue is about another adapter or backend`);
        assert.ok(compareVersions(issue.pixi.from, shim.pixi.from) <= 0 && compareVersions(shim.pixi.before, issue.pixi.before) <= 0, `${where}: its range must lie within its known issue's`);
        assert.equal(issue.fixedIn, shim.fixedIn, `${where}: fixedIn differs from its known issue's`);
        for (const link of issue.links) assert.ok(shim.links.some((candidate) => candidate.url === link.url), `${where}: links must include its known issue's ${link.label}`);
    }
}

/**
 * Known upstream issues (`adapterMatrix.knownIssues`): a pixi.js version range (`from` inclusive, `before` exclusive) on
 * one backend of one Pixi adapter, with a summary, advice and links. They change no verdict: a tuple a record verified
 * stays verified (owner ruling, 2026-10-10), and every generated table shows the note beside a verified range it
 * covers. `pixiAdapter` is the adapter key (`pixi8`) or its id (`pixi-8`).
 */
export function knownIssuesFor(seed, { pixiAdapter, renderer, pixi })
{
    const key = pixiAdapterKey(seed, pixiAdapter);

    return (seed.adapterMatrix.knownIssues ?? []).filter((issue) => issue.pixiAdapter === key && (!renderer || issue.renderer === renderer) && (!pixi || inRange(pixi, issue.pixi)));
}

/**
 * The footnote mark of a known issue (`\*`, `\*\*`, ... by its position in `adapterMatrix.knownIssues`), escaped for
 * Markdown. Every generated table puts it after a verified tuple or range the issue covers.
 */
export function knownIssueMark(seed, issue)
{
    const index = (seed.adapterMatrix.knownIssues ?? []).findIndex((candidate) => candidate.id === issue.id);

    return '\\*'.repeat(index + 1);
}

/** `8.10` for `8.10.0`: the shortest form of a version, for "pixi.js <8.10". */
const shortVersion = (version) => version.replace(/(\.0)+$/, '');

/**
 * A known issue's footnote, the one sentence every generated table (the release table, COMPATIBILITY.md, the record
 * Markdown) prints for it, starting with its mark. When an environment shim works around the issue, the footnote says
 * the backend needs that workaround and names the shim the verification runs apply.
 */
export function knownIssueFootnote(seed, issue)
{
    const backend = seed.adapterMatrix.renderers[issue.renderer]?.label ?? issue.renderer;
    const [first] = issue.links;
    const shims = (seed.adapterMatrix.environmentShims ?? []).filter((shim) => shim.knownIssue === issue.id);
    const range = `${backend} on pixi.js <${shortVersion(issue.pixi.before)}`;

    return shims.length
        ? `${knownIssueMark(seed, issue)} ${range} needs the workaround for [${first.label}](${first.url}) (fixed in ${issue.fixedIn}): without it, ${issue.summary}. ${issue.advice}. The verification runs apply that workaround as the labelled environment shim ${shims.map((shim) => `\`${shim.id}\``).join(', ')} (\`adapterMatrix.environmentShims\`).`
        : `${knownIssueMark(seed, issue)} ${range} is affected by [${first.label}](${first.url}) (fixed in ${issue.fixedIn}): ${issue.summary}. ${issue.advice}.`;
}

/** Structural checks of `adapterMatrix.knownIssues`: a range, a backend the adapter has, a summary, advice and links. */
export function validateKnownIssues(seed)
{
    const matrix = seed.adapterMatrix;
    const ids = new Set();

    assert.ok(Array.isArray(matrix.knownIssues ?? []), 'knownIssues must be a list');
    for (const issue of matrix.knownIssues ?? [])
    {
        const where = `knownIssues ${issue.id ?? '(no id)'}`;

        assert.match(issue.id ?? '', /^[a-z0-9.-]+$/, `${where}: id`);
        assert.ok(!ids.has(issue.id), `${where}: duplicate id`);
        ids.add(issue.id);
        const adapter = matrix.pixiAdapters[issue.pixiAdapter];

        assert.ok(adapter, `${where}: unknown Pixi adapter ${issue.pixiAdapter}`);
        assert.ok(adapter.renderers[issue.renderer], `${where}: ${adapter.id} has no ${issue.renderer} renderer`);
        for (const field of ['from', 'before']) assert.match(issue.pixi?.[field] ?? '', /^\d+\.\d+\.\d+$/, `${where}: pixi.${field} (an exact version)`);
        assert.ok(compareVersions(issue.pixi.from, issue.pixi.before) < 0, `${where}: pixi.from must be below pixi.before`);
        assert.match(issue.fixedIn ?? '', /^\d+\.\d+\.\d+$/, `${where}: fixedIn`);
        for (const field of ['summary', 'advice']) assert.ok(typeof issue[field] === 'string' && issue[field].length >= 10, `${where}: ${field}`);
        assert.ok(Array.isArray(issue.links) && issue.links.length > 0, `${where}: links`);
        for (const link of issue.links) assert.ok(typeof link.label === 'string' && link.label && (/^https:\/\//).test(link.url ?? ''), `${where}: each link needs a label and an https url`);
    }
}

/** A GPU profile row (`adapterMatrix.gpuProfiles`), with its id; the default one without a name. */
export function gpuProfileOf(seed, name)
{
    const id = name ?? seed.adapterMatrix.defaultGpuProfile;
    const profile = seed.adapterMatrix.gpuProfiles[id];

    assert.ok(profile, `unknown GPU profile ${id} (${Object.keys(seed.adapterMatrix.gpuProfiles).join(', ')})`);

    return { id, ...profile };
}

/**
 * A backend run's Vitest JSON report, split by test file: the conformance scenarios, and the render check
 * (harness/test/backend.test.tsx).
 */
export function splitConformanceReport(report)
{
    const tally = (predicate) =>
    {
        const results = (report?.testResults ?? []).filter((result) => predicate(result.name)).flatMap((result) => result.assertionResults ?? []);

        return {
            passed: results.filter((result) => result.status === 'passed').length,
            failed: results.filter((result) => result.status === 'failed').length,
            skipped: results.filter((result) => !['passed', 'failed'].includes(result.status)).length,
        };
    };
    const check = tally((name) => name.endsWith('backend.test.tsx'));

    return { scenarios: tally((name) => !name.endsWith('backend.test.tsx')), backendCheck: check.failed ? 'fail' : check.passed ? 'pass' : 'not run' };
}

/**
 * How to spawn a package-manager command (npm, pnpm) on this platform without a POSIX shell. On Windows they are .cmd
 * shims, which Node runs only through a shell (since the April 2024 security releases), so arguments are quoted for
 * cmd.exe there; elsewhere the binary runs directly.
 */
export function platformCommand(name, args, platform = process.platform)
{
    if (platform !== 'win32') return { file: name, args, shell: false };
    const quote = (arg) => (/^[\w.,:=@/\\+-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`);

    return { file: `${name}.cmd`, args: args.map(quote), shell: true };
}

/**
 * Creates a cell's isolated work directory under the OS temp directory and returns its real, long path. On Windows
 * `os.tmpdir()` can be an 8.3 short path (`C:/Users/SAMHIL~1/AppData/Local/Temp` for a profile named "Sam Hill"); Vite
 * resolves module ids to the long path while Vitest's root and test files keep the short one, so the browser runner never
 * finds its tests (`__vitest_browser_runner__.runTests is not a function`). `realpathSync.native` expands 8.3 names (and
 * resolves symlinks, as macOS's `/var` -> `/private/var`), and the runner uses this path everywhere: cwd, Vitest root,
 * cell.json. The file-system functions are parameters so a test can stand in for Windows.
 */
export function makeCellDir(prefix, { tmp = tmpdir(), mkdtemp = mkdtempSync, realpath = realpathSync.native } = {})
{
    return realpath(mkdtemp(join(tmp, prefix)));
}

/**
 * The browsers a cell can run in (`run-cells.mjs --browser`). `chromium` is the Chromium build pinned by the toolchain's
 * Playwright (`playwright install chromium`), the only one the software profile (CI) allows; `chrome` and `msedge` are
 * the browsers installed on the machine, launched through Playwright's `channel`, for the hardware profile where the
 * bundled Chromium has no hardware WebGPU (Windows). Records name the one a run used.
 */
export const BROWSERS = Object.freeze({
    chromium: Object.freeze({ id: 'chromium', channel: null, pinned: true, description: 'the Chromium pinned by the toolchain\'s Playwright' }),
    chrome: Object.freeze({ id: 'chrome', channel: 'chrome', pinned: false, description: 'the Google Chrome installed on this machine' }),
    msedge: Object.freeze({ id: 'msedge', channel: 'msedge', pinned: false, description: 'the Microsoft Edge installed on this machine' }),
});

/** The browser of a run (`--browser`, `chromium` by default); an installed browser only under a hardware GPU profile. */
export function browserOf(name, gpuProfile)
{
    const id = name ?? 'chromium';
    const browser = BROWSERS[id];

    assert.ok(browser, `unknown --browser ${id} (${Object.keys(BROWSERS).join(', ')})`);
    assert.ok(browser.pinned || gpuProfile?.expect === 'hardware', `--browser ${id} needs --gpu hardware: the ${gpuProfile?.id ?? 'software'} profile (CI) runs only the Chromium pinned by Playwright`);

    return browser;
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

/** The known issues behind the environment shims a backend run applied (each entry `{ id, ... }` or an id). */
export function shimIssues(seed, applied)
{
    const matrix = seed.adapterMatrix;
    const ids = (applied ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.id));
    const issues = ids.map((id) => (matrix.environmentShims ?? []).find((shim) => shim.id === id)?.knownIssue).filter(Boolean);

    return [...new Set(issues)].map((id) => matrix.knownIssues.find((issue) => issue.id === id)).filter(Boolean);
}

/** A result cell's text: its status, and with per-backend results the status of each backend it ran (marked when shimmed). */
function resultMark(seed, row)
{
    const known = row.knownFailures?.length && row.status !== 'fail' ? ` + ${row.knownFailures.length} known defect` : '';
    const backends = Object.entries(row.backends ?? {});
    const name = ([key, backend]) => `${backendLabel[key] ?? key}${shimIssues(seed, backend.environmentShims).map((issue) => knownIssueMark(seed, issue)).join('')}`;

    if (!backends.length) return `${statusMark[row.status] ?? row.status}${known}`;
    if (row.status === 'cached-pass') return `${statusMark[row.status]} (${backends.map(name).join(', ')})${known}`;
    if (backends.every(([, backend]) => backend.status === 'pass')) return `pass (${backends.map(name).join(', ')})${known}`;

    return `${statusMark[row.status] ?? row.status}: ${backends.map((entry) => `${name(entry)} ${entry[1].status === 'pass' ? 'pass' : entry[1].status.toUpperCase()}`).join(', ')}${known}`;
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
    // The known issues behind an environment shim one of the cells applies: one footnote each, under the table.
    const footnotes = new Map();

    if (intro) lines.push(manifestOnly
        ? 'Generated from `design/compatibility/seed.json` (`adapterMatrix`). These are the cells CI runs. Verified tuples come from the dated verification records (`verifiedRanges`); verification is evidence, not a support guarantee.'
        : 'Each cell installs the packed adapters into an isolated project with exactly the listed React, react-dom and pixi.js, then checks the dependency tree, ESM/CJS imports and ABI, declaration consumers and the real-browser conformance suite.');
    lines.push('', `| React adapter @ React | ${pixiVersions.map((version) => `pixi.js ${version}`).join(' | ')} |`, `| --- | ${pixiVersions.map(() => '---').join(' | ')} |`);
    for (const key of reactKeys)
    {
        const [adapter, version] = key.split('|');

        lines.push(`| ${adapter} @ ${version} | ${pixiVersions.map((pixi) =>
        {
            const row = lookup.get(`${key}|${pixi}`);

            if (!row) return '-';
            const shimmed = manifestOnly ? row.shimIssues ?? [] : Object.values(row.backends ?? {}).flatMap((backend) => shimIssues(seed, backend.environmentShims));

            shimmed.forEach((issue) => footnotes.set(issue.id, issue));

            return manifestOnly ? `cell${[...new Set(shimmed)].map((issue) => knownIssueMark(seed, issue)).join('')}` : resultMark(seed, row);
        }).join(' | ')} |`);
    }
    if (footnotes.size) lines.push('', ...[...footnotes.values()].map((issue) => knownIssueFootnote(seed, issue)));
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
        // The known issues whose environment shim this cell applies on some backend: the table marks it.
        shimIssues: shimIssues(seed, cell.kind === 'cell' ? cell.renderers.flatMap((renderer) => environmentShimsFor(seed, { pixiAdapter: cell.pixi.adapterKey, renderer, pixi: cell.pixi.version })) : []),
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
        'This is the list of compatibility cells CI runs (issue 13). The PR-tier cells make a version **tested**; a tuple is **verified** on a render backend when its nightly cell passed on that backend in a dated [verification record](../verification/) whose boundary probes and incompatible pairs all behaved as expected (`verifiedRanges` in seed.json, derived from the records). Records name their GPU profile: software rendering (SwiftShader WebGL, the WebGPU fallback adapter; no GPU), or a real GPU (hardware records, extra evidence). Verification is evidence, not a support guarantee. Each cell installs the packed adapters into an isolated project with exactly the listed React, react-dom and pixi.js. Results are published by the Compatibility workflows (job summary and the `compatibility-table` artifact).',
        '',
        `Required PR check: **Compatibility (required)**. Nightly tier (scheduled weekly on GitHub, Mondays 02:37 UTC; it keeps the name "nightly"): **Compatibility (nightly)**, ${selectCells(seed, 'nightly').length} cells (${selectCells(seed, 'nightly', { patches: 'all' }).length} with minimum and latest React patches).`,
        '',
        `Render backends, each checked separately: PR tier ${tierRenderers(seed, 'pr').join(', ')}; nightly ${tierRenderers(seed, 'nightly').join(', ')}. ${Object.entries(matrix.pixiAdapters).map(([, adapter]) => `\`${adapter.id}\`: ${Object.keys(adapter.renderers).join(', ')}`).join('; ')}.`,
        '',
        `GPU profiles (\`--gpu\`): ${Object.entries(matrix.gpuProfiles).map(([id, profile]) => `**${id}**${id === matrix.defaultGpuProfile ? ' (default, what CI runs)' : ''}: ${profile.description}`).join(' ')}`,
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
        '## Environment shims',
        '',
        'Labelled workarounds for upstream pixi.js bugs (`adapterMatrix.environmentShims`; owner ruling 2026-10-11: the matrix measures this project\'s adapters, not pixi.js bugs). The harness applies a shim only to the backend runs of its Pixi adapter, backend and pixi.js range, under every GPU profile, before the first Pixi application initializes; each backend run records the shims it applied, and a tuple verified with one stays verified and carries its id. A shimmed run that renders is a normal pass; one that still fails is a failure. Cells marked with a footnote above apply one on some backend (nightly WebGPU only: the PR tier runs WebGL).',
        '',
        '| Shim | Pixi adapter | Backend | pixi.js | What it does | Why | Links |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...(matrix.environmentShims ?? []).map((shim) => `| \`${shim.id}\` | ${matrix.pixiAdapters[shim.pixiAdapter].id} | ${shim.renderer} | \`>=${shim.pixi.from} <${shim.pixi.before}\` (fixed in ${shim.fixedIn}) | ${shim.does} | ${shim.reason} | ${shim.links.map((link) => `[${link.label}](${link.url})`).join(', ')} |`),
        '',
        '## Known issues',
        '',
        'Upstream issues of a pixi.js range on one backend (`adapterMatrix.knownIssues`). They change no verdict: a tuple a record verified stays verified, and the release table, this page and the records mark every verified tuple or range an issue covers with its footnote:',
        '',
        ...(matrix.knownIssues ?? []).map((issue) => `${knownIssueFootnote(seed, issue)} (\`${issue.id}\`: \`${matrix.pixiAdapters[issue.pixiAdapter].id}\`, pixi.js ${issue.pixi.from} to before ${issue.pixi.before}; ${issue.links.map((link) => `[${link.label}](${link.url})`).join(', ')}.)`),
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
