/**
 * Whether `error` is a core `CompatibilityError`, judged by shape rather than `instanceof`: the facade must
 * recognize errors raised through any loaded copy of core (a bundler or test runner may load it more than once).
 */
export function isCompatibilityError(error: unknown, ...codes: string[]): error is Error & { code: string }
{
    const { code, adapterIds } = (error ?? {}) as { code?: unknown; adapterIds?: unknown };

    return error instanceof Error && typeof code === 'string' && Array.isArray(adapterIds)
        && (codes.length === 0 || codes.includes(code));
}
