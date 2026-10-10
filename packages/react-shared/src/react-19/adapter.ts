import { version as installedReactVersion } from 'react';
import { createBindings, type ParentActivityBridge } from './bindings.js';
import {
    type AdapterManifest,
    type Bind,
    type CapabilityMap,
    CompatibilityError,
    type PixiTypes,
    ReactAdapter,
    type Runtime,
} from '@pixi-react-provisional/core';

import type { EpochRenderer } from './host.js';
import type { React19Family } from './types.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** The audited facts of one React 19 minor and the package that implements it. */
export interface EpochInfo
{
    /** The React minor line, e.g. `19.0`. */
    readonly epoch: `19.${number}`;
    /** The adapter package that implements this minor, e.g. `@pixi-react-provisional/react-19.0`. */
    readonly packageName: string;
    /** That package's version. */
    readonly packageVersion: string;
    /** The exact react-reconciler version the package depends on. */
    readonly reconciler: string;
    /** The exact its-fine version the package depends on (the context bridge). */
    readonly bridge: string;
    /** The exact React versions this minor was tested with (the audit's minimum and current patch). */
    readonly testedReact: readonly string[];
    /** Capabilities this epoch provides to the composition. */
    readonly provides: CapabilityMap;
}

/** The Pixi capabilities every React 19 epoch needs. */
export const REQUIRED_PIXI_CAPABILITIES: CapabilityMap = Object.freeze({
    'pixi.mutation': 1,
    'pixi.visibility': 1,
    'pixi.application': 1,
    'pixi.ticker': 1,
});

function minorOf(version: string): string | undefined
{
    return (/^(\d+\.\d+)\./).exec(version)?.[1];
}

/**
 * The shared React 19 adapter. It owns everything React-side: the reconciler, roots, the host config,
 * the context bridge and the hook and component shells. All scene work goes through core's `PixiSession`
 * protocol, so the adapter never names a scene library.
 *
 * Each per-minor package (`@pixi-react-provisional/react-19.0` … `react-19.3`) exports one concrete subclass
 * (`React190Adapter` … `React193Adapter`, also exported as `React19Adapter`). A subclass supplies its minor's host
 * config and root factory, typed against the exact react-reconciler that package depends on; no host config is
 * shared across minors through a cast. Every runtime the package binds shares that package's one reconciler.
 */
export abstract class React19Adapter extends ReactAdapter<React19Family>
{
    /** The audited epoch this subclass implements. */
    abstract readonly epoch: EpochInfo;

    private manifestCache: AdapterManifest | undefined;

    get manifest(): AdapterManifest
    {
        if (!this.manifestCache)
        {
            const { epoch, packageName, packageVersion, reconciler, bridge, testedReact, provides } = this.epoch;

            this.manifestCache = Object.freeze({
                abi: Object.freeze({ major: 1, minor: 0 }),
                id: `react-${epoch}`,
                packageVersion,
                provides,
                requires: REQUIRED_PIXI_CAPABILITIES,
                verification: `${packageName}: react ${testedReact.join(' | ')}; `
                    + `react-reconciler ${reconciler} (exact dependency); its-fine ${bridge} (exact dependency). `
                    + 'Tested against the fake Pixi adapter and in the issue-13 compatibility cells with Pixi8Adapter; '
                    + 'Verified tuples: the dated verification records in design/compatibility/verification (evidence, not a support guarantee).',
            });
        }

        return this.manifestCache;
    }

    /** The installed React version, read from `react`. Overridable for tests. */
    protected reactVersion(): string
    {
        return installedReactVersion;
    }

    /**
     * Rejects an installed React outside this package's minor line. The reconciler this package depends on is pinned
     * to that line; another minor needs another package, never this one.
     */
    checkEnvironment(): void
    {
        const { epoch, packageName, testedReact } = this.epoch;
        const actual = this.reactVersion();

        if (minorOf(actual) !== epoch)
        {
            // A per-minor package names its sibling for the installed minor. A copy bundled under another name (the
            // @pixi/react facade) names none.
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production'
                    ? `${packageName} supports React ${epoch}.x (tested: ${testedReact.join(', ')}), `
                        + `but React ${actual} is installed.${packageName.includes(epoch)
                            ? ' Install and use the adapter package that matches the installed React minor '
                                + `(for example ${packageName.replace(epoch, minorOf(actual) ?? '<minor>')}).`
                            : ''}`
                    : '',
                {
                    code: 'UNSUPPORTED_TUPLE',
                    adapterIds: [this.manifest.id],
                    expected: { react: `${epoch}.x`, tested: testedReact.join(' || '), reconciler: this.epoch.reconciler },
                    actual: { react: actual },
                },
            );
        }
    }

    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<React19Family, S>
    {
        const bindings = createBindings(runtime, {
            adapterId: this.manifest.id,
            renderer: this.createRenderer(runtime),
            useParentActivity: this.parentActivityBridge(),
        });

        // `Extract<S, PixiTypes>` is `S`; TypeScript cannot reduce it for a generic S (see core's README).
        return bindings as Bind<React19Family, S>;
    }

    /**
     * This minor's root factory for one runtime. The reconciler behind it is the package copy's one shared
     * reconciler: every runtime the package binds renders through it, as React DOM renders all its roots.
     */
    protected abstract createRenderer<S extends PixiTypes>(runtime: Runtime<S>): EpochRenderer<S>;

    /**
     * A hook that forwards the parent tree's Activity visibility into the scene root, for epochs whose React has
     * Activity (19.2+). Earlier epochs return `undefined`.
     */
    protected parentActivityBridge(): ParentActivityBridge | undefined
    {
        return undefined;
    }
}
