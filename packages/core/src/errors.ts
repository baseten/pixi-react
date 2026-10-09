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

    constructor(message: string, details: CompatibilityErrorDetails)
    {
        super(message, 'cause' in details ? { cause: details.cause } : undefined);

        if (!isCompatibilityErrorCode(details.code))
        {
            throw new TypeError(
                `Invalid CompatibilityError code "${String(details.code)}": use a built-in code or a dotted `
                + 'namespaced code such as "community.shader.UNSUPPORTED_FORMAT".',
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
