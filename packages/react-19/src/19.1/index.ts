/**
 * `@pixi-react-provisional/react-19/19.1`: the React 19.1 epoch, bundling react-reconciler 0.32.0.
 * Requires React 19.1.x (tested: 19.1.0 and 19.1.9).
 */
import { type EpochInfo, React19Adapter as React19AdapterBase } from '../shared/adapter.js';
import { createRenderer } from './hostConfig.js';

import type { EpochRenderer } from '../shared/host.js';
import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '19.1',
    reconciler: '0.32.0',
    testedReact: Object.freeze(['19.1.0', '19.1.9']),
    provides: Object.freeze({}),
});

/** The React 19.1 adapter (react-reconciler 0.32.0). */
export class React191Adapter extends React19AdapterBase
{
    readonly epoch = EPOCH;

    protected createRenderer<S extends PixiTypes>(runtime: Runtime<S>): EpochRenderer<S>
    {
        return createRenderer(runtime);
    }
}

export { React191Adapter as React19Adapter, React19AdapterBase };
export * from '../shared/public.js';
