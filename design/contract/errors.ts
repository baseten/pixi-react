import { CompatibilityError, type CompatibilityErrorCode, type CompatibilityErrorDetails } from './core.js';

const details: CompatibilityErrorDetails = {
    code: 'CAPABILITY_MISSING',
    adapterIds: ['community.inspector', 'community.scene'],
    capability: 'scene.visibility',
    expected: { 'scene.visibility': 1 },
    actual: { 'scene.visibility': null },
    cause: new Error('No visibility binding'),
};
export const missingCapability: Error = new CompatibilityError('Visibility is required', details);
export const unsupportedTuple = new CompatibilityError('Unsupported installed tuple', {
    code: 'UNSUPPORTED_TUPLE', adapterIds: ['community.scene'],
    expected: { scene: '>=1.0.0 <2.0.0' }, actual: { scene: '2.0.0' },
});
export const customError = new CompatibilityError('Unsupported format', {
    code: 'community.shader.UNSUPPORTED_FORMAT', adapterIds: ['community.shader'],
    expected: { format: 'rgba', supported: true }, actual: { format: 'depth', supported: false },
});
export function describeFailure(error: unknown): string {
    if (!(error instanceof CompatibilityError)) return 'Unrecognized failure';
    const code: CompatibilityErrorCode = error.code;
    const adapterIds: readonly string[] = error.adapterIds;
    const capability: string | undefined = error.capability;
    const actual: string | number | boolean | null | undefined = error.actual?.['scene.visibility'];
    if (error.code === 'CAPABILITY_MISSING') {
        const narrowed: 'CAPABILITY_MISSING' = error.code;
        return `${narrowed}: ${capability} (${actual})`;
    }
    // @ts-expect-error The shared cause must be narrowed before reading properties.
    error.cause.message;
    return `${code}: ${adapterIds.join(', ')}`;
}
// @ts-expect-error Built-in misspellings cannot silently become unnamespaced custom codes.
export const wrongCode: CompatibilityErrorCode = 'CAPABILTY_MISSING';
// @ts-expect-error Adapter IDs have one shared readonly string-list representation.
export const wrongIds: CompatibilityErrorDetails = { code: 'ABI_MISMATCH', adapterIds: { react: '19' } };
// @ts-expect-error Expected diagnostics use named values, not a bare protocol version.
export const wrongExpected: CompatibilityErrorDetails = { ...details, expected: 1 };
// @ts-expect-error Actual diagnostics cannot use adapter-specific nested objects.
export const wrongActual: CompatibilityErrorDetails = { ...details, actual: { scene: { version: 1 } } };
// @ts-expect-error Capability IDs remain strings.
export const wrongCapability: CompatibilityErrorDetails = { ...details, capability: 1 };
// @ts-expect-error A compatibility error must identify its stable code and involved adapters.
export const missingDetails = new CompatibilityError('Missing details');
