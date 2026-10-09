/**
 * `@pixi-react-provisional/react-18`: the React 18 adapter, bundling react-reconciler 0.29.2 and its-fine 1.2.5.
 * Requires React 18.3.x (certified: 18.3.1).
 *
 * ```ts
 * import { createRenderer } from '@pixi-react-provisional/renderer';
 * import { React18Adapter } from '@pixi-react-provisional/react-18';
 * import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
 *
 * const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
 * ```
 */
export type { React18Info } from './adapter.js';
export { REACT18, React18Adapter, REQUIRED_PIXI_CAPABILITIES } from './adapter.js';
export type { UnsupportedCapability } from './host.js';
export { UNSUPPORTED_CAPABILITIES } from './host.js';
export type {
    ApplicationProps,
    ApplicationRef,
    ElementProps,
    React18Family,
    ReactBindings,
    RecoverableErrorInfo,
    Root,
    RootErrors,
    RootOptions,
} from './types.js';
