import { CompatibilityError } from './errors.js';

import type { AdapterManifest, CapabilityMap } from './types.js';

/**
 * Read as written (`process.env.NODE_ENV`), never through a variable, so a consumer's bundler replaces it and drops the
 * development-only message text from production builds (issue 58). Every check runs in every build; production
 * errors carry an empty message, which `CompatibilityError` replaces with one built from the code and details.
 */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** The ABI this core implements. An adapter may implement any minor up to this one. */
export const CORE_ABI = Object.freeze({ major: 1, minor: 0 } as const);

/**
 * Methods each adapter role must implement at ABI 1.0, checked at composition time. Its keys are the roles. The
 * role names appear only as property keys, never as string literals: the dependency-graph check treats a quoted
 * React package name in core's built output as a module reference.
 */
const REQUIRED_METHODS = Object.freeze({
    react: Object.freeze(['bind'] as const),
    pixi: Object.freeze(['createSession', 'describe', 'normalizeName'] as const),
});

/** An adapter role: the key an adapter is passed under to `compose` and `createRenderer`. */
export type AdapterRole = keyof typeof REQUIRED_METHODS;

/** Every adapter role, in validation order. */
export const ADAPTER_ROLES: readonly AdapterRole[] = Object.freeze(Object.keys(REQUIRED_METHODS) as AdapterRole[]);

/** How messages name each role's adapter, and the adapter of the other role. */
const ROLE_LABELS: Readonly<Record<AdapterRole, string>> = { react: 'React', pixi: 'Pixi' };
const OTHER_ROLE_LABELS: Readonly<Record<AdapterRole, string>> = { react: 'Pixi', pixi: 'React' };

/** Whether `value` is a non-null object. Shared by core's modules; not exported from the package. */
export function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null;
}

function isProtocolVersion(value: unknown): value is number
{
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** `message` is empty in production builds. */
function malformed(role: AdapterRole, id: string | undefined, message: string, extra: Partial<{
    capability: string;
    expected: Record<string, string | number | boolean | null>;
    actual: Record<string, string | number | boolean | null>;
}> = {}): CompatibilityError
{
    return new CompatibilityError(process.env.NODE_ENV !== 'production'
        ? `${id ? `${ROLE_LABELS[role]} adapter "${id}"` : `The ${ROLE_LABELS[role]} adapter`} has a malformed manifest: ${message}`
        : '', {
        code: 'ABI_MISMATCH',
        adapterIds: id ? [id] : [],
        ...extra,
    });
}

function validateCapabilities(role: AdapterRole, id: string, field: 'provides' | 'requires', map: unknown): CapabilityMap
{
    if (!isRecord(map) || Array.isArray(map))
    {
        throw malformed(role, id, process.env.NODE_ENV !== 'production'
            ? `"${field}" must be an object mapping capability IDs to protocol versions.` : '');
    }

    for (const [capability, version] of Object.entries(map))
    {
        if (!capability)
        {
            throw malformed(role, id, process.env.NODE_ENV !== 'production' ? `"${field}" contains an empty capability ID.` : '');
        }

        if (!isProtocolVersion(version))
        {
            throw malformed(role, id, process.env.NODE_ENV !== 'production'
                ? `"${field}.${capability}" must be a non-negative integer protocol version.` : '', {
                capability,
                expected: { [capability]: 'integer >= 0' },
                actual: { [capability]: typeof version === 'number' ? version : String(version) },
            });
        }
    }

    return Object.freeze({ ...(map as CapabilityMap) });
}

/**
 * Validates one adapter manifest and returns a frozen copy. ABI major mismatches, an ABI minor newer than this
 * core, and malformed fields throw `ABI_MISMATCH` naming the adapter.
 */
export function validateManifest(manifest: unknown, role: AdapterRole): AdapterManifest
{
    if (!isRecord(manifest))
    {
        throw malformed(role, undefined, process.env.NODE_ENV !== 'production' ? 'the adapter has no manifest object.' : '');
    }

    const id = manifest.id;

    if (typeof id !== 'string' || !id.trim())
    {
        throw malformed(role, undefined, process.env.NODE_ENV !== 'production' ? '"id" must be a non-empty string.' : '');
    }

    const abi = manifest.abi;

    if (!isRecord(abi) || !isProtocolVersion(abi.major) || !isProtocolVersion(abi.minor))
    {
        throw malformed(role, id, process.env.NODE_ENV !== 'production' ? '"abi" must be { major, minor } with integer versions.' : '');
    }

    if (abi.major !== CORE_ABI.major)
    {
        throw new CompatibilityError(
            process.env.NODE_ENV !== 'production'
                ? `The ${ROLE_LABELS[role]} adapter "${id}" implements ABI ${abi.major}.${abi.minor}, but this core implements `
                    + `ABI ${CORE_ABI.major}.${CORE_ABI.minor}. Install a "${id}" release built for ABI ${CORE_ABI.major}.`
                : '',
            {
                code: 'ABI_MISMATCH',
                adapterIds: [id],
                expected: { major: CORE_ABI.major },
                actual: { major: abi.major, minor: abi.minor },
            },
        );
    }

    if (abi.minor > CORE_ABI.minor)
    {
        throw new CompatibilityError(
            process.env.NODE_ENV !== 'production'
                ? `The ${ROLE_LABELS[role]} adapter "${id}" needs ABI ${abi.major}.${abi.minor}, but this core only implements `
                    + `ABI ${CORE_ABI.major}.${CORE_ABI.minor}. Upgrade the core package, or install an older "${id}".`
                : '',
            {
                code: 'ABI_MISMATCH',
                adapterIds: [id],
                expected: { major: CORE_ABI.major, maxMinor: CORE_ABI.minor },
                actual: { major: abi.major, minor: abi.minor },
            },
        );
    }

    for (const field of ['packageVersion', 'verification'] as const)
    {
        if (typeof manifest[field] !== 'string')
        {
            throw malformed(role, id, process.env.NODE_ENV !== 'production' ? `"${field}" must be a string.` : '');
        }
    }

    return Object.freeze({
        abi: Object.freeze({ major: CORE_ABI.major, minor: abi.minor }),
        id,
        packageVersion: manifest.packageVersion as string,
        verification: manifest.verification as string,
        provides: validateCapabilities(role, id, 'provides', manifest.provides),
        requires: validateCapabilities(role, id, 'requires', manifest.requires),
    });
}

/**
 * Checks that `adapter` structurally implements its role: ABI 1.0 methods must exist. Structural, not
 * `instanceof`, so an adapter built against another installed copy of core is judged by what it implements.
 */
export function validateAdapterShape(adapter: unknown, role: AdapterRole): AdapterManifest
{
    if (!isRecord(adapter))
    {
        throw new CompatibilityError(process.env.NODE_ENV !== 'production'
            ? `Expected a ${ROLE_LABELS[role]} adapter instance, got ${adapter === null ? 'null' : typeof adapter}.` : '', {
            code: 'ABI_MISMATCH',
            adapterIds: [],
        });
    }

    const manifest = validateManifest(adapter.manifest, role);

    for (const method of REQUIRED_METHODS[role])
    {
        if (typeof adapter[method] !== 'function')
        {
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production'
                    ? `The ${ROLE_LABELS[role]} adapter "${manifest.id}" does not implement ${method}(), required by ABI `
                        + `${CORE_ABI.major}.${manifest.abi.minor}. Was a ${OTHER_ROLE_LABELS[role]} adapter passed as \`${role}\`?`
                    : '',
                {
                    code: 'ABI_MISMATCH',
                    adapterIds: [manifest.id],
                    expected: { [method]: 'function' },
                    actual: { [method]: typeof adapter[method] },
                },
            );
        }
    }

    return manifest;
}

export interface NegotiatedComposition
{
    readonly react: AdapterManifest;
    readonly pixi: AdapterManifest;
    /** Every capability either adapter provides. */
    readonly capabilities: CapabilityMap;
}

function requireCapabilities(
    /** Subject and verb, e.g. `Pixi adapter "x" requires`. */
    requirer: string,
    requirerIds: readonly string[],
    requires: CapabilityMap,
    provider: string,
    providerIds: readonly string[],
    provides: CapabilityMap,
): void
{
    for (const [capability, version] of Object.entries(requires))
    {
        const available = Object.prototype.hasOwnProperty.call(provides, capability) ? provides[capability] : undefined;

        if (available === version)
        {
            continue;
        }

        throw new CompatibilityError(
            process.env.NODE_ENV !== 'production'
                ? `${requirer} capability "${capability}" at protocol version ${version}, but `
                    + `${available === undefined ? 'it is not provided' : `version ${available} is provided`} by ${provider}. `
                    + `Compose with ${provider === 'the composed adapters' ? 'adapters' : 'an adapter'} that provides `
                    + `"${capability}" version ${version}.`
                : '',
            {
                code: 'CAPABILITY_MISSING',
                adapterIds: [...requirerIds, ...providerIds],
                capability,
                expected: { [capability]: version },
                actual: { [capability]: available ?? null },
            },
        );
    }
}

/**
 * Validates one react/pixi pair before anything is allocated. Each adapter's `requires` must be met
 * exactly (same protocol version) by its counterpart's `provides`, and the consumer's
 * `requiredCapabilities` by either adapter. Unknown optional capabilities are ignored.
 */
export function negotiate(
    react: AdapterManifest,
    pixi: AdapterManifest,
    requiredCapabilities: CapabilityMap = {},
): NegotiatedComposition
{
    const required = validateCapabilitiesInput(requiredCapabilities);

    requireCapabilities(
        `React adapter "${react.id}" requires`, [react.id], react.requires,
        `Pixi adapter "${pixi.id}"`, [pixi.id], pixi.provides,
    );
    requireCapabilities(
        `Pixi adapter "${pixi.id}" requires`, [pixi.id], pixi.requires,
        `React adapter "${react.id}"`, [react.id], react.provides,
    );

    const capabilities: Record<string, number> = { ...react.provides };

    for (const [capability, version] of Object.entries(pixi.provides))
    {
        if (capabilities[capability] !== undefined && capabilities[capability] !== version)
        {
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production'
                    ? `React adapter "${react.id}" provides "${capability}" version ${capabilities[capability]} but `
                        + `Pixi adapter "${pixi.id}" provides version ${version}; one capability ID has one protocol owner.`
                    : '',
                {
                    code: 'UNSUPPORTED_TUPLE',
                    adapterIds: [react.id, pixi.id],
                    capability,
                    expected: { [capability]: capabilities[capability] },
                    actual: { [capability]: version },
                },
            );
        }

        capabilities[capability] = version;
    }

    requireCapabilities(
        'The renderer options require', [], required,
        'the composed adapters', [react.id, pixi.id], capabilities,
    );

    return Object.freeze({ react, pixi, capabilities: Object.freeze(capabilities) });
}

function validateCapabilitiesInput(map: unknown): CapabilityMap
{
    if (!isRecord(map) || Array.isArray(map))
    {
        throw new TypeError(process.env.NODE_ENV !== 'production'
            ? 'requiredCapabilities must be an object mapping capability IDs to protocol versions.' : 'Invalid requiredCapabilities.');
    }

    for (const [capability, version] of Object.entries(map))
    {
        if (!isProtocolVersion(version))
        {
            throw new TypeError(process.env.NODE_ENV !== 'production'
                ? `requiredCapabilities["${capability}"] must be a non-negative integer protocol version.`
                : `Invalid requiredCapabilities["${capability}"].`);
        }
    }

    return map as CapabilityMap;
}
