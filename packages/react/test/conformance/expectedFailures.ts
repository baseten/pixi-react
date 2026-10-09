import { type ExpectedFailure } from '@pixi-react-provisional/conformance';

/**
 * Confirmed defects of the default facade, found by the conformance scenarios. Each entry fails with an error
 * matching `match`; when a fix lands the run fails until the entry is removed.
 *
 * Empty since issue 10: the facade composes React19Adapter (19.3) and Pixi8Adapter, and the owner approved the
 * adapters' failure-path repairs for the facade (D4 ruling, issue 1). The sixteen baseline defects (owned by issues
 * 7, 8 and 9) all pass; every parity scenario passes through the facade's own shims.
 */
export const expectedFailures: Readonly<Record<string, ExpectedFailure>> = {};
