/**
 * The adapter code the facade runs, bundled into this package (`lib/adapters.js` and the `dist/` bundles): the
 * neutral renderer and core, the React 19.3 adapter and the Pixi 8 adapter's peer binding. `lib/adapters.js` requires
 * the React 19.3 adapter's react-reconciler and its-fine, which are this package's dependencies; the `dist/` bundles
 * include them. Release 1 ships the adapters inside `@pixi/react`; it depends on no separately
 * published adapter package. Internal: not exported from the package entry points.
 */
export { bindPixi, PIXI8_BINDING_EXPORTS } from '@pixi-react-provisional/pixi-8';
export { React19Adapter } from '@pixi-react-provisional/react-19.3';
export { createRenderer } from '@pixi-react-provisional/renderer';
