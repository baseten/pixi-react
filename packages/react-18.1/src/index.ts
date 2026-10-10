/**
 * `@pixi-react-provisional/react-18.1`: the React 18.1 adapter. Depends on exactly react-reconciler 0.28.0 and its-fine
 * 1.2.5. Requires React 18.1.x (tested: 18.1.0).
 *
 * ```ts
 * import { createRenderer } from '@pixi-react-provisional/renderer';
 * import { React18Adapter } from '@pixi-react-provisional/react-18.1';
 * import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
 *
 * const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
 * ```
 */
import { createRenderer } from './hostConfig.js';
import { PACKAGE } from './package.js';
import {
    type EpochInfo,
    React18Adapter as React18AdapterBase,
    type SceneRenderer,
} from '@pixi-react-provisional/react-shared/react-18';

import type { PixiTypes, Runtime } from '@pixi-react-provisional/core';

export const EPOCH: EpochInfo = Object.freeze({
    epoch: '18.1',
    packageName: PACKAGE.name,
    packageVersion: PACKAGE.version,
    reconciler: '0.28.0',
    bridge: '1.2.5',
    testedReact: Object.freeze(['18.1.0']),
    provides: Object.freeze({}),
});

/** The React 18.1 adapter (react-reconciler 0.28.0). */
export class React181Adapter extends React18AdapterBase
{
    readonly epoch = EPOCH;

    protected createRenderer<S extends PixiTypes>(runtime: Runtime<S>): SceneRenderer<S>
    {
        return createRenderer(runtime);
    }
}

export { React181Adapter as React18Adapter, React18AdapterBase };
export * from '@pixi-react-provisional/react-shared/react-18/public';
