/**
 * The adapter code the facade runs, bundled into this package (`lib/adapters.js` and the `dist/` bundles): the
 * neutral renderer and core, the React 19.3 adapter (with its bundled react-reconciler, scheduler and its-fine) and
 * the Pixi 8 adapter's peer binding. Release 1 ships the adapters inside `@pixi/react`; it depends on no separately
 * published adapter package. Internal: not exported from the package entry points.
 */
export { bindPixi } from '@pixi-react-provisional/pixi-8';
export { React19Adapter } from '@pixi-react-provisional/react-19/19.3';
export { createRenderer } from '@pixi-react-provisional/renderer';
