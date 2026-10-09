/**
 * `@pixi-react-provisional/react-19/19.3`: the React 19.3 epoch, bundling react-reconciler 0.34.0.
 * Requires React 19.3.x (tested: 19.3.0). Fragment refs and ViewTransition are rejected with a
 * `CompatibilityError` (`CAPABILITY_MISSING`); see the package README.
 */
import { useActivityBridge } from 'its-fine';
import { type EpochInfo, React19Adapter as React19AdapterBase } from '../shared/adapter.js';
import { createRenderer } from './hostConfig.js';

import type { ParentActivityBridge } from '../shared/bindings.js';
import type { EpochRenderer } from '../shared/host.js';
import type { Runtime, SceneTypes } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '19.3',
    reconciler: '0.34.0',
    testedReact: Object.freeze(['19.3.0']),
    provides: Object.freeze({ 'react.activity': 1 }),
});

/** The React 19.3 framework adapter (react-reconciler 0.34.0). */
export class React193Adapter extends React19AdapterBase
{
    readonly epoch = EPOCH;

    protected createRenderer<S extends SceneTypes>(runtime: Runtime<S>): EpochRenderer<S>
    {
        return createRenderer(runtime);
    }

    /** `<Activity mode="hidden">` around an `Application` hides its scene tree and disconnects its effects. */
    protected parentActivityBridge(): ParentActivityBridge
    {
        return useActivityBridge;
    }
}

export { React193Adapter as React19Adapter, React19AdapterBase };
export * from '../shared/public.js';
