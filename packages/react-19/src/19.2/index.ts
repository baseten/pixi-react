/**
 * `@pixi-react-provisional/react-19/19.2`: the React 19.2 epoch, bundling react-reconciler 0.33.0.
 * Requires React 19.2.x (tested: 19.2.0 and 19.2.8).
 */
import { useActivityBridge } from 'its-fine';
import { type EpochInfo, React19Adapter as React19AdapterBase } from '../shared/adapter.js';
import { createRenderer } from './hostConfig.js';

import type { ParentActivityBridge } from '../shared/bindings.js';
import type { EpochRenderer } from '../shared/host.js';
import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '19.2',
    reconciler: '0.33.0',
    testedReact: Object.freeze(['19.2.0', '19.2.8']),
    provides: Object.freeze({ 'react.activity': 1 }),
});

/** The React 19.2 adapter (react-reconciler 0.33.0). */
export class React192Adapter extends React19AdapterBase
{
    readonly epoch = EPOCH;

    protected createRenderer<S extends PixiTypes>(runtime: Runtime<S>): EpochRenderer<S>
    {
        return createRenderer(runtime);
    }

    /** `<Activity mode="hidden">` around an `Application` hides its scene tree and disconnects its effects. */
    protected parentActivityBridge(): ParentActivityBridge
    {
        return useActivityBridge;
    }
}

export { React192Adapter as React19Adapter, React19AdapterBase };
export * from '../shared/public.js';
