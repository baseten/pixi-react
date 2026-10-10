/**
 * Installed-version bounds of the Pixi 7 adapter. Nothing here imports pixi.js: the functions take the installed
 * `VERSION` string, so they are testable without a renderer.
 */

/** A parsed `major.minor.patch` version. Pre-release and build suffixes are kept for diagnostics only. */
export interface PixiVersion
{
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    /** The pre-release tag (`rc.2`), or `''` for a release. */
    readonly prerelease: string;
    readonly raw: string;
}

/**
 * The peer range, also in `package.json`: the #3 audit's Pixi 7 candidate line (`pixiEpochs.pixi7` in
 * `design/compatibility/seed.json`), from the first-party floor 7.4.2 to the newest 7.x release, 7.4.3 (npm's
 * `latest-7.x`). Both are audited probe tuples, and every release in the range is tested exactly.
 */
export const PIXI7_PEER_RANGE = '>=7.4.2 <7.5.0';

/** The supported bounds as data: `[min, maxExclusive]` and explicitly excluded versions (none). */
export const PIXI7_BOUNDS = Object.freeze({
    min: '7.4.2',
    maxExclusive: '7.5.0',
    excluded: Object.freeze([] as string[]),
} as const);

/** The exact versions the adapter's browser cells and the compatibility matrix run against. */
export const PIXI7_TESTED_VERSIONS = Object.freeze(['7.4.2', '7.4.3'] as const);

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

export type SupportVerdict =
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };

/**
 * Whether an installed version is inside the peer range. Pre-releases are never supported. A Pixi 8 installation gets
 * its own reason, because composing this adapter with Pixi 8 is the likeliest mistake.
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

    if (version.major >= 8)
    {
        return {
            supported: false,
            reason: `pixi.js ${version.raw} is Pixi ${version.major}; this adapter supports ${PIXI7_PEER_RANGE}. Compose the Pixi 8 adapter `
                + '(@pixi-react-provisional/pixi-8) with Pixi 8',
        };
    }

    if (compareVersions(version, at(PIXI7_BOUNDS.min)) < 0 || compareVersions(version, at(PIXI7_BOUNDS.maxExclusive)) >= 0)
    {
        return { supported: false, reason: `pixi.js ${version.raw} is outside ${PIXI7_PEER_RANGE}` };
    }

    if ((PIXI7_BOUNDS.excluded as readonly string[]).includes(`${version.major}.${version.minor}.${version.patch}`))
    {
        return { supported: false, reason: `pixi.js ${version.raw} is excluded` };
    }

    return { supported: true };
}
