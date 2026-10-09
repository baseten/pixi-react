/**
 * Installed-version bounds and capability boundaries of the Pixi 8 adapter. Nothing here imports pixi.js: the
 * functions take the installed `VERSION` string, so they are testable without a renderer.
 */

/** A parsed `major.minor.patch` version. Pre-release and build suffixes are kept for diagnostics only. */
export interface PixiVersion
{
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    /** The pre-release tag (`dev.abc`, `rc`), or `''` for a release. */
    readonly prerelease: string;
    readonly raw: string;
}

/**
 * The peer range, also in `package.json`: the audited candidate envelope `>=8.2.6 <8.23.0` (design D5,
 * version-support.md) minus 8.5.0, whose `ParticleContainer.destroy` fails. The audit sampled 8.5.2 as passing;
 * 8.5.1 was not probed and is not one of the tested versions below.
 */
export const PIXI8_PEER_RANGE = '>=8.2.6 <8.5.0 || >=8.5.1 <8.23.0';

/** The supported bounds as data: `[min, maxExclusive]` and explicitly excluded versions. */
export const PIXI8_BOUNDS = Object.freeze({
    min: '8.2.6',
    maxExclusive: '8.23.0',
    excluded: Object.freeze(['8.5.0']),
} as const);

/**
 * The exact versions the adapter's browser test cells run against (`packages/pixi-8/test/browser`). Under D5 a
 * certificate covers exact tuples only; issue 13 owns the full matrix and its machine-readable certificate.
 */
export const PIXI8_TESTED_VERSIONS = Object.freeze(['8.2.6', '8.9.2', '8.22.0'] as const);

/**
 * Feature boundaries the adapter branches on. Each one is detected from the installed module's exports, never from
 * the version alone; the version is recorded so a mismatch between both is visible in diagnostics.
 */
export const PIXI8_BOUNDARIES = Object.freeze({
    /** `Particle`/`ParticleContainer` (not Containers): addParticle/removeParticle(s). */
    particles: '8.5.0',
    /** `removeParticles(begin, end)` treats `end` as an end index; before it, the second argument was a count. */
    removeParticlesEndIndex: '8.10.0',
    /** `RenderLayer`. */
    renderLayer: '8.7.0',
    /** `DOMContainer`. */
    domContainer: '8.9.0',
} as const);

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses a semver string. Returns `undefined` when it is not `major.minor.patch[-pre][+build]`. */
export function parseVersion(raw: unknown): PixiVersion | undefined
{
    if (typeof raw !== 'string')
    {
        return undefined;
    }

    const match = VERSION_PATTERN.exec(raw.trim());

    if (!match)
    {
        return undefined;
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ?? '',
        raw,
    };
}

/** Compares release triples only. A pre-release sorts before its release, as in semver. */
export function compareVersions(a: PixiVersion, b: PixiVersion): number
{
    const delta = a.major - b.major || a.minor - b.minor || a.patch - b.patch;

    if (delta !== 0)
    {
        return delta;
    }

    if (a.prerelease === b.prerelease)
    {
        return 0;
    }

    if (!a.prerelease)
    {
        return 1;
    }

    return b.prerelease ? 0 : -1;
}

function at(raw: string): PixiVersion
{
    return parseVersion(raw)!;
}

/** Whether `version` is at least `boundary`. */
export function isAtLeast(version: PixiVersion, boundary: string): boolean
{
    return compareVersions(version, at(boundary)) >= 0;
}

export type SupportVerdict =
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };

/**
 * Whether an installed version is inside the peer range. Pre-releases are never supported: the range covers
 * releases, and a `-dev` build of a later patch is not evidence for that patch.
 */
export function checkSupportedVersion(raw: unknown): SupportVerdict
{
    const version = parseVersion(raw);

    if (!version)
    {
        return { supported: false, reason: `pixi.js reports an unparseable VERSION ${JSON.stringify(raw)}` };
    }

    if (version.prerelease)
    {
        return { supported: false, reason: `pixi.js ${version.raw} is a pre-release` };
    }

    if (compareVersions(version, at(PIXI8_BOUNDS.min)) < 0 || compareVersions(version, at(PIXI8_BOUNDS.maxExclusive)) >= 0)
    {
        return { supported: false, reason: `pixi.js ${version.raw} is outside ${PIXI8_PEER_RANGE}` };
    }

    if ((PIXI8_BOUNDS.excluded as readonly string[]).includes(`${version.major}.${version.minor}.${version.patch}`))
    {
        return {
            supported: false,
            reason: `pixi.js ${version.raw} is excluded: its ParticleContainer.destroy fails (fixed by 8.5.2)`,
        };
    }

    return { supported: true };
}
