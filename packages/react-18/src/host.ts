/**
 * The contract between the React 18 bindings (`bindings.tsx`) and the React 18 reconciler integration
 * (`hostConfig.ts`), plus the errors both raise. Nothing here names a reconciler type: the bindings see a root as
 * "schedule an update" and "unmount synchronously".
 */
import { CompatibilityError, type PixiTypes, type RootRecord, type Runtime } from '@pixi-react-provisional/core';

import type { ReactNode } from 'react';

/** The reconciler container of one root: its core record and the runtime that owns it. */
export interface HostContainer<S extends PixiTypes>
{
    readonly runtime: Runtime<S>;
    readonly record: RootRecord<S>;
}

/** What React 18 passes to `onRecoverableError`. */
export interface RecoverableErrorInfoLike
{
    componentStack?: string | null;
    digest?: string | null;
}

/**
 * The root error channel React 18 has. React 18 roots have no caught- or uncaught-error callback: caught errors are
 * logged by React, and an uncaught error unmounts the root and is rethrown.
 */
export interface RootCallbacks
{
    onRecoverableError(error: unknown, info: RecoverableErrorInfoLike): void;
}

/** A reconciler root, as the bindings see it. */
export interface ReconcilerRoot
{
    /** Schedules `element` at the current event priority; `callback` runs once the update has committed. */
    update(element: ReactNode, callback: () => void): void;
    /** Renders `null` synchronously, so every node is removed (and passive cleanups run) before the call returns. */
    unmountSync(): void;
}

/** What the reconciler integration hands the bindings. */
export interface SceneRenderer<S extends PixiTypes>
{
    createRoot(container: HostContainer<S>, callbacks: RootCallbacks, identifierPrefix: string): ReconcilerRoot;
}

/** Thrown for a raw string child: the scene has no text nodes. */
export function rawTextError(text: string): Error
{
    return new Error(
        `Raw text "${text}" cannot be rendered in the scene. Use a text component (for example <pixiText text="…" />).`,
    );
}

/** Capabilities React 18 does not have, which the React 19 epochs provide or accept. */
export const UNSUPPORTED_CAPABILITIES = Object.freeze({
    /** `<Activity>` (React 19.2+): no Activity component, so no `useActivityBridge` and no hide/reveal of a subtree. */
    'react.activity': 'React 18 has no <Activity> component (React 19.2+).',
    /** `onCaughtError` / `onUncaughtError` root callbacks (React 19+). */
    'react.root-error-callbacks': 'React 18 roots take only onRecoverableError; onCaughtError and onUncaughtError are React 19 root options.',
} as const);

export type UnsupportedCapability = keyof typeof UNSUPPORTED_CAPABILITIES;

/**
 * A React 19 root option passed to a React 18 root. Raised with the built-in `CAPABILITY_MISSING` code and the
 * missing capability, never silently ignored.
 */
export function unsupportedOptionError(adapterId: string, option: string): CompatibilityError
{
    const capability: UnsupportedCapability = 'react.root-error-callbacks';

    return new CompatibilityError(
        `The ${option} option is not supported by the ${adapterId} adapter: ${UNSUPPORTED_CAPABILITIES[capability]} `
        + 'Catch render errors with an error boundary, or use onRecoverableError for recovered concurrent errors.',
        {
            code: 'CAPABILITY_MISSING',
            adapterIds: [adapterId],
            capability,
            expected: { [capability]: 1 },
            actual: { [capability]: null },
        },
    );
}
