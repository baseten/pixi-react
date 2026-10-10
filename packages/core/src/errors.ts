/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** ABI-owned codes. Adapters may add codes in their own dotted namespace (`community.shader.UNSUPPORTED_FORMAT`). */
export type BuiltinCompatibilityErrorCode =
    | 'ABI_MISMATCH'
    | 'CAPABILITY_MISSING'
    | 'UNSUPPORTED_TUPLE'
    | 'UNKNOWN_ELEMENT'
    | 'UNSUPPORTED_NODE'
    | 'REGISTRY_CONFLICT'
    | 'ROOT_DISPOSED'
    | 'INIT_FAILED';

export type CompatibilityErrorCode = BuiltinCompatibilityErrorCode | `${string}.${string}`;

/** Named diagnostic values: protocol versions are numbers, package versions/ranges are strings. */
export type CompatibilityErrorValues = Readonly<Record<string, string | number | boolean | null>>;

export interface CompatibilityErrorDetails
{
    readonly code: CompatibilityErrorCode;
    /** Manifest IDs of the adapters involved, not package-version objects. */
    readonly adapterIds: readonly string[];
    readonly capability?: string;
    readonly expected?: CompatibilityErrorValues;
    readonly actual?: CompatibilityErrorValues;
    readonly cause?: unknown;
}

/**
 * Codes core itself raises outside the built-in set. They use the reserved `core.` namespace so that they
 * can never collide with an adapter's own namespace.
 */
export const CoreErrorCodes = Object.freeze({
    /** A DOM target (or its canvas) is already owned by a root of another runtime. */
    TARGET_LEASED: 'core.TARGET_LEASED',
    /** A root operation needs an initialized application. */
    ROOT_NOT_READY: 'core.ROOT_NOT_READY',
    /** A renderer option has a value core does not accept, such as an unknown `registryConflict` policy. */
    INVALID_OPTION: 'core.INVALID_OPTION',
} as const);

const BUILTIN_CODES: ReadonlySet<string> = new Set<BuiltinCompatibilityErrorCode>([
    'ABI_MISMATCH',
    'CAPABILITY_MISSING',
    'UNSUPPORTED_TUPLE',
    'UNKNOWN_ELEMENT',
    'UNSUPPORTED_NODE',
    'REGISTRY_CONFLICT',
    'ROOT_DISPOSED',
    'INIT_FAILED',
]);

/** A namespaced code has at least two non-empty dot-separated segments. */
const NAMESPACED_CODE = /^[^.\s]+(\.[^.\s]+)+$/;

/** Whether `code` is a built-in code or a dotted namespaced adapter code. */
export function isCompatibilityErrorCode(code: unknown): code is CompatibilityErrorCode
{
    return typeof code === 'string' && (BUILTIN_CODES.has(code) || NAMESPACED_CODE.test(code));
}

/**
 * The message of a `CompatibilityError` constructed with an empty one. Production builds of the adapter packages pass
 * an empty message instead of their full text (the full text is only built when `process.env.NODE_ENV` is not
 * `'production'`, so bundlers drop it), and get this one: the code and the details, which are the same in every
 * build, and where to find the full message.
 */
function detailsMessage({ code, adapterIds, capability, expected, actual }: CompatibilityErrorDetails): string
{
    const json = (label: string, values?: CompatibilityErrorValues) => values && `${label} ${JSON.stringify(values)}`;
    const parts = [adapterIds.join(', '), capability, json('expected', expected), json('actual', actual)].filter(Boolean);

    return `${String(code)}${parts.length ? ` (${parts.join('; ')})` : ''}. A development build (NODE_ENV !== 'production') `
        + 'gives the full message.';
}

function freezeValues(values: CompatibilityErrorValues | undefined): CompatibilityErrorValues | undefined
{
    return values === undefined ? undefined : Object.freeze({ ...values });
}

/**
 * The one shared error class for core and adapters. `message` is human-readable; `code` is stable. Consumers
 * of one core instance narrow unknown errors with `instanceof CompatibilityError`.
 */
export class CompatibilityError extends Error implements CompatibilityErrorDetails
{
    override readonly name = 'CompatibilityError' as const;
    readonly code: CompatibilityErrorCode;
    readonly adapterIds: readonly string[];
    readonly capability?: string;
    readonly expected?: CompatibilityErrorValues;
    readonly actual?: CompatibilityErrorValues;
    declare readonly cause?: unknown;

    /**
     * @param message - The human-readable message. When it is empty, the message is built from `details` (the
     * production builds of the adapter packages pass an empty message; see `detailsMessage`).
     */
    constructor(message: string, details: CompatibilityErrorDetails)
    {
        super(message || detailsMessage(details), 'cause' in details ? { cause: details.cause } : undefined);

        if (!isCompatibilityErrorCode(details.code))
        {
            throw new TypeError(
                process.env.NODE_ENV !== 'production'
                    ? (`Invalid CompatibilityError code "${String(details.code)}": use a built-in code or a dotted `
                    + 'namespaced code such as "community.shader.UNSUPPORTED_FORMAT".')
                    : `Invalid CompatibilityError code "${String(details.code)}".`,
            );
        }

        this.code = details.code;
        this.adapterIds = Object.freeze([...details.adapterIds]);

        if (details.capability !== undefined)
        {
            this.capability = details.capability;
        }

        const expected = freezeValues(details.expected);
        const actual = freezeValues(details.actual);

        if (expected)
        {
            this.expected = expected;
        }

        if (actual)
        {
            this.actual = actual;
        }
    }
}

/**
 * Teardown keeps going when one step throws; every failure is collected here. The root or runtime is
 * still marked disposed: the failures describe resources that may not have been released, they do not mean
 * the teardown can be retried.
 */
export class TeardownError extends AggregateError
{
    override readonly name = 'TeardownError' as const;

    constructor(errors: readonly unknown[], message: string)
    {
        super(errors, `${message}: ${errors.map(describe).join('; ')}`);
    }
}

function describe(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}
