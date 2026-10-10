import { version as installedReactVersion } from 'react';
import { createBindings } from './bindings.js';
import { createRenderer } from './hostConfig.js';
import { PACKAGE_VERSION } from './version.js';
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

/** The audited facts of the React 18 adapter. */
export interface React18Info
{
    /** The React minor line the reconciler this package depends on implements. */
    readonly line: '18.3';
    /** The exact react-reconciler version this package depends on. */
    readonly reconciler: string;
    /** The exact its-fine version this package depends on (the context bridge). */
    readonly bridge: string;
    /** The exact React (and react-dom) versions the fixtures test. The peer range lists exactly these (D5). */
    readonly testedReact: readonly string[];
    /** Capabilities this adapter provides to the composition. */
    readonly provides: CapabilityMap;
}

export const REACT18: React18Info = Object.freeze({
    line: '18.3',
    reconciler: '0.29.2',
    bridge: '1.2.5',
    testedReact: Object.freeze(['18.3.1']),
    provides: Object.freeze({}),
});

/** The Pixi capabilities the React 18 adapter needs (the same scene protocol as every React 19 epoch). */
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
 * The React 18 adapter. It owns everything React-side for React 18.3: react-reconciler 0.29.2 (a dependency), its
 * ConcurrentRoot and recoverable-error routing, the event-priority hook, the payload-based host config, the its-fine
 * 1.x context bridge and the hook and component shells. All scene work goes through core's `PixiSession` protocol, so
 * the adapter never names a scene library, and it composes with the same `Pixi8Adapter` as the React 19 epochs.
 *
 * It is an independent implementation, not a cast of a React 19 epoch: see the package README for each difference.
 */
export class React18Adapter extends ReactAdapter<React18Family>
{
    /** The audited facts this adapter implements. */
    readonly info = REACT18;

    private manifestCache: AdapterManifest | undefined;

    get manifest(): AdapterManifest
    {
        if (!this.manifestCache)
        {
            const { reconciler, bridge, testedReact, provides } = this.info;

            this.manifestCache = Object.freeze({
                abi: Object.freeze({ major: 1, minor: 0 }),
                id: 'react-18',
                packageVersion: PACKAGE_VERSION,
                provides,
                requires: REQUIRED_PIXI_CAPABILITIES,
                verification: `@pixi-react-provisional/react-18: react ${testedReact.join(' | ')}; `
                    + `react-reconciler ${reconciler} (exact dependency); its-fine ${bridge} (exact dependency). `
                    + 'Tested in Chromium with Pixi8Adapter (packages/react-18/fixtures); '
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
     * Rejects an installed React outside the 18.3 line its reconciler implements (react-reconciler 0.29.2 declares
     * `react@^18.3.1`). React 19 needs the matching per-minor package (`@pixi-react-provisional/react-19.x`); React
     * 18.2 and earlier are not supported.
     */
    checkEnvironment(): void
    {
        const { line, testedReact, reconciler } = this.info;
        const actual = this.reactVersion();

        if (minorOf(actual) !== line)
        {
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production'
                    ? `@pixi-react-provisional/react-18 supports React ${line}.x (tested: ${testedReact.join(', ')}), `
                        + `but React ${actual} is installed.${actual.split('.')[0] === '19'
                            ? ' For React 19, install and use the adapter package that matches the installed React minor '
                                + `(for example @pixi-react-provisional/react-${minorOf(actual) ?? '19.x'}).`
                            : ''}`
                    : '',
                {
                    code: 'UNSUPPORTED_TUPLE',
                    adapterIds: [this.manifest.id],
                    expected: { react: `${line}.x`, tested: testedReact.join(' || '), reconciler },
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

    /** Builds the 0.29.2 reconciler, host config and root factory for one runtime. */
    protected createRenderer<S extends PixiTypes>(runtime: Runtime<S>): SceneRenderer<S>
    {
        return createRenderer(runtime);
    }
}
