/**
 * `@pixi-react-provisional/react-19.3`: the React 19.3 adapter. Depends on exactly react-reconciler 0.34.0 and its-fine
 * 2.1.1.
 * Requires React 19.3.x (tested: 19.3.0). Fragment refs and ViewTransition are rejected with a
 * `CompatibilityError` (`CAPABILITY_MISSING`); see the package README.
 */
import { useActivityBridge } from 'its-fine';
import { createRenderer } from './hostConfig.js';
import { PACKAGE } from './package.js';
import {
    type EpochInfo,
    type EpochRenderer,
    type ParentActivityBridge,
    React19Adapter as React19AdapterBase,
} from '@pixi-react-provisional/react-shared/react-19';

import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '19.3',
    packageName: PACKAGE.name,
    packageVersion: PACKAGE.version,
    reconciler: '0.34.0',
    bridge: '2.1.1',
    testedReact: Object.freeze(['19.3.0']),
    provides: Object.freeze({ 'react.activity': 1 }),
});

/** The React 19.3 adapter (react-reconciler 0.34.0). */
export class React193Adapter extends React19AdapterBase
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

export { React193Adapter as React19Adapter, React19AdapterBase };
export * from '@pixi-react-provisional/react-shared/react-19/public';
