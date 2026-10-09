/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node against the BUILT package through its own `exports` map, once with `import` and once with
 * `require`. Prints a JSON report; the D6 test asserts on it.
 */
import { createRequire } from 'node:module';
import * as esmPixi from 'pixi.js';
import * as esm from '@pixi-react-provisional/pixi-8';

const require = createRequire(import.meta.url);
const cjs = require('@pixi-react-provisional/pixi-8');
const cjsPixi = require('pixi.js');

const names = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const loaded = (pattern) => Object.keys(require.cache).filter((file) => pattern.test(file)).length;
const esmAdapter = new esm.Pixi8Adapter();
const cjsAdapter = new cjs.Pixi8Adapter();

console.log(JSON.stringify({
    esmExports: names(esm),
    cjsExports: names(cjs),
    // Node loads pixi.js's ESM and CJS builds as two instances; each entry binds the instance its system loads.
    pixiInstancesDiffer: esmPixi.Container !== cjsPixi.Container,
    esmBoundToEsmPixi: esmAdapter.pixi.Container === esmPixi.Container,
    cjsBoundToCjsPixi: cjsAdapter.pixi.Container === cjsPixi.Container,
    // One implementation module: binding the same Pixi instance through either entry yields the same exports.
    sharedBindPixi: esm.bindPixi === cjs.bindPixi,
    sameInstanceSameClass: cjs.bindPixi(esmPixi).Pixi8Adapter === esm.Pixi8Adapter
        && esm.bindPixi(cjsPixi).Pixi8Adapter === cjs.Pixi8Adapter,
    loadedImplementations: loaded(/pixi-8[\\/]dist[\\/]cjs[\\/]bind\.js$/),
    loadedCore: loaded(/core[\\/]dist[\\/]cjs[\\/]index\.js$/),
    sharedConstants: esm.PIXI8_BOUNDS === cjs.PIXI8_BOUNDS,
    manifestId: esmAdapter.manifest.id,
    reactLoaded: Object.keys(require.cache).some((file) => (/[\\/]node_modules[\\/](react|react-dom|react-reconciler|its-fine)[\\/]/).test(file)),
}));
