import { version as installedReactVersion } from 'react';
import { createBindings, type ParentActivityBridge } from './bindings.js';
import { PACKAGE_VERSION } from './version.js';
import {
    type AdapterManifest,
    type Bind,
    type CapabilityMap,
    CompatibilityError,
    FrameworkAdapter,
    type Runtime,
    type SceneTypes,
} from '@pixi-react-provisional/core';

import type { EpochRenderer } from './host.js';
import type { React19Family } from './types.js';

/** The audited facts of one React 19 epoch. */
export interface EpochInfo
{
    /** The subpath and React minor line, e.g. `19.0`. */
    readonly epoch: `19.${number}`;
    /** The exact react-reconciler version this subpath bundles. */
    readonly reconciler: string;
    /** The exact React versions this subpath was tested with (the audit's minimum and current patch). */
    readonly testedReact: readonly string[];
    /** Capabilities this epoch provides to the composition. */
    readonly provides: CapabilityMap;
}

/** The scene capabilities every React 19 epoch needs. */
export const REQUIRED_SCENE_CAPABILITIES: CapabilityMap = Object.freeze({
    'scene.mutation': 1,
    'scene.visibility': 1,
    'scene.application': 1,
    'scene.ticker': 1,
});

function minorOf(version: string): string | undefined
{
    return (/^(\d+\.\d+)\./).exec(version)?.[1];
}

/**
 * The shared React 19 framework adapter. It owns everything React-side: the reconciler, roots, the host config,
 * the context bridge and the hook and component shells. All scene work goes through core's `SceneSession`
 * protocol, so the adapter never names a scene library.
 *
 * Each subpath exports one concrete epoch subclass (`React190Adapter` … `React193Adapter`, also exported as
 * `React19Adapter` from that subpath). A subclass supplies the epoch's own host config and root factory, typed
 * against the exact react-reconciler that subpath bundles; no host config is shared across epochs through a cast.
 */
export abstract class React19Adapter extends FrameworkAdapter<React19Family>
{
    /** The audited epoch this subclass implements. */
    abstract readonly epoch: EpochInfo;

    private manifestCache: AdapterManifest | undefined;

    get manifest(): AdapterManifest
    {
        if (!this.manifestCache)
        {
            const { epoch, reconciler, testedReact, provides } = this.epoch;

            this.manifestCache = Object.freeze({
                abi: Object.freeze({ major: 1, minor: 0 }),
                id: `react-19/${epoch}`,
                packageVersion: PACKAGE_VERSION,
                provides,
                requires: REQUIRED_SCENE_CAPABILITIES,
                certification: `@pixi-react-provisional/react-19/${epoch}: react ${testedReact.join(' | ')}; `
                    + `react-reconciler ${reconciler} (bundled); its-fine 2.1.1 (bundled). `
                    + 'Tested against the fake scene backend; candidate-not-certified until the issue-13 matrix runs.',
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
     * Rejects an installed React outside this subpath's minor line. The reconciler bundled here is pinned to that
     * line; another minor needs another subpath, never this one.
     */
    checkEnvironment(): void
    {
        const { epoch, testedReact } = this.epoch;
        const actual = this.reactVersion();

        if (minorOf(actual) !== epoch)
        {
            throw new CompatibilityError(
                `@pixi-react-provisional/react-19/${epoch} supports React ${epoch}.x (tested: ${testedReact.join(', ')}), `
                + `but React ${actual} is installed. Import the subpath that matches the installed React minor `
                + `(for example @pixi-react-provisional/react-19/${minorOf(actual) ?? '<minor>'}).`,
                {
                    code: 'UNSUPPORTED_TUPLE',
                    adapterIds: [this.manifest.id],
                    expected: { react: `${epoch}.x`, tested: testedReact.join(' || '), reconciler: this.epoch.reconciler },
                    actual: { react: actual },
                },
            );
        }
    }

    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<React19Family, S>
    {
        const bindings = createBindings(runtime, {
            adapterId: this.manifest.id,
            renderer: this.createRenderer(runtime),
            useParentActivity: this.parentActivityBridge(),
        });

        // `Extract<S, SceneTypes>` is `S`; TypeScript cannot reduce it for a generic S (see core's README).
        return bindings as Bind<React19Family, S>;
    }

    /** Builds this epoch's reconciler, host config and root factory for one runtime. */
    protected abstract createRenderer<S extends SceneTypes>(runtime: Runtime<S>): EpochRenderer<S>;

    /**
     * A hook that forwards the parent tree's Activity visibility into the scene root, for epochs whose React has
     * Activity (19.2+). Earlier epochs return `undefined`.
     */
    protected parentActivityBridge(): ParentActivityBridge | undefined
    {
        return undefined;
    }
}
