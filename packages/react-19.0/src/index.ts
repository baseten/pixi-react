/**
 * `@pixi-react-provisional/react-19.0`: the React 19.0 adapter. Depends on exactly react-reconciler 0.31.0 and its-fine
 * 2.1.1.
 * Requires React 19.0.x (tested: 19.0.0 and 19.0.8).
 */
import { createRenderer } from './hostConfig.js';
import { PACKAGE } from './package.js';
import {
    type EpochInfo,
    type EpochRenderer,
    React19Adapter as React19AdapterBase,
} from '@pixi-react-provisional/react-shared/react-19';

import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '19.0',
    packageName: PACKAGE.name,
    packageVersion: PACKAGE.version,
    reconciler: '0.31.0',
    bridge: '2.1.1',
    testedReact: Object.freeze(['19.0.0', '19.0.8']),
    provides: Object.freeze({}),
});

/** The React 19.0 adapter (react-reconciler 0.31.0). */
export class React190Adapter extends React19AdapterBase
{
    readonly epoch = EPOCH;

    protected createRenderer<S extends PixiTypes>(runtime: Runtime<S>): EpochRenderer<S>
    {
        return createRenderer(runtime);
    }
}

export { React190Adapter as React19Adapter, React19AdapterBase };
export * from '@pixi-react-provisional/react-shared/react-19/public';
