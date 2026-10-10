import { version as installedReactVersion } from 'react';
import { createBindings } from './bindings.js';
import {
    type AdapterManifest,
    type Bind,
    type CapabilityMap,
    CompatibilityError,
    type PixiTypes,
    ReactAdapter,
    type Runtime,
} from '@pixi-react-provisional/core';

import type { SceneRenderer } from './host.js';
import type { React18Family } from './types.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** The audited facts of one React 18 minor and the package that implements it. */
export interface EpochInfo
{
    /** The React minor line, e.g. `18.0`. */
    readonly epoch: `18.${number}`;
    /** The adapter package that implements this minor, e.g. `@pixi-react-provisional/react-18.0`. */
    readonly packageName: string;
    /** That package's version. */
    readonly packageVersion: string;
    /** The exact react-reconciler version the package depends on (the one released with this React minor). */
    readonly reconciler: string;
    /** The exact its-fine version the package depends on (the context bridge). */
    readonly bridge: string;
    /** The exact React (and react-dom) versions the fixtures and cells test. The peer range lists exactly these (D5). */
    readonly testedReact: readonly string[];
    /** Capabilities this adapter provides to the composition. */
    readonly provides: CapabilityMap;
}

/** The Pixi capabilities the React 18 adapters need (the same scene protocol as every React 19 epoch). */
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
 * The shared React 18 adapter. It owns everything React-side for one React 18 minor: the reconciler (a dependency of
 * the per-minor package), its ConcurrentRoot and recoverable-error routing, the event-priority hook, the
 * payload-based host config, the its-fine 1.x context bridge and the hook and component shells. All scene work goes
 * through core's `PixiSession` protocol, so the adapter never names a scene library, and it composes with the same
 * Pixi adapters as the React 19 epochs.
 *
 * Each per-minor package (`@pixi-react-provisional/react-18.0` … `react-18.3`) exports one concrete subclass
 * (`React180Adapter` … `React183Adapter`, also exported as `React18Adapter`) that supplies the root factory of the exact
 * react-reconciler it depends on (0.27.0, 0.28.0, 0.29.0, 0.29.2). It is an independent implementation, not a cast of
 * a React 19 epoch: see react-18.3's README for each difference.
 */
export abstract class React18Adapter extends ReactAdapter<React18Family>
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
                    + `Tested in Chromium with Pixi8Adapter (packages/react-${epoch}/fixtures) and in the issue-13 compatibility cells; `
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
     * Rejects an installed React outside this package's minor line. The reconciler this package depends on is the
     * one released with that minor (its npm peer is that minor and later); another minor needs another package, never
     * this one, and the check never selects an adapter.
     */
    checkEnvironment(): void
    {
        const { epoch, packageName, testedReact, reconciler } = this.epoch;
        const actual = this.reactVersion();
        const actualMinor = minorOf(actual);

        if (actualMinor !== epoch)
        {
            // A per-minor package names its sibling for the installed minor when one exists (React 18 and 19).
            const sibling = actualMinor && (/^1[89]\./).test(actualMinor) && packageName.endsWith(epoch)
                ? ` Install and use the adapter package that matches the installed React minor (for example ${packageName.slice(0, -epoch.length)}${actualMinor}).`
                : '';

            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production'
                    ? `${packageName} supports React ${epoch}.x (tested: ${testedReact.join(', ')}), but React ${actual} is installed.${sibling}`
                    : '',
                {
                    code: 'UNSUPPORTED_TUPLE',
                    adapterIds: [this.manifest.id],
                    expected: { react: `${epoch}.x`, tested: testedReact.join(' || '), reconciler },
                    actual: { react: actual },
                },
            );
        }
    }

    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<React18Family, S>
    {
        const bindings = createBindings(runtime, {
            adapterId: this.manifest.id,
            renderer: this.createRenderer(runtime),
        });

        // `Extract<S, PixiTypes>` is `S`; TypeScript cannot reduce it for a generic S (see core's README).
        return bindings as Bind<React18Family, S>;
    }

    /**
     * This minor's root factory for one runtime. The reconciler behind it is the package copy's one shared
     * reconciler: every runtime the package binds renders through it.
     */
    protected abstract createRenderer<S extends PixiTypes>(runtime: Runtime<S>): SceneRenderer<S>;
}
