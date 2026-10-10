/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node against the BUILT package through its own `exports` map, once with `import` and once with
 * `require`. Prints a JSON report; the D6 test asserts on it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as esmPixi from 'pixi.js';
import * as esm from '@pixi-react-provisional/pixi-7';

const require = createRequire(import.meta.url);
const cjs = require('@pixi-react-provisional/pixi-7');
const cjsPixi = require('pixi.js');

const names = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const loaded = (pattern) => Object.keys(require.cache).filter((file) => pattern.test(file)).length;
const esmAdapter = new esm.Pixi7Adapter();
const wrapper = readFileSync(require.resolve('@pixi-react-provisional/pixi-7').replace(/cjs[\\/]index\.js$/, 'esm/index.mjs'), 'utf8');
const pixiImports = [...wrapper.matchAll(/^import (.+) from 'pixi\.js';$/gm)].map((match) => match[1]);
const cjsAdapter = new cjs.Pixi7Adapter();

console.log(JSON.stringify({
    esmExports: names(esm),
    cjsExports: names(cjs),
    // Node loads pixi.js's ESM and CJS builds as two instances; each entry binds the instance its system loads.
    pixiInstancesDiffer: esmPixi.Container !== cjsPixi.Container,
    esmBoundToEsmPixi: esmAdapter.pixi.Container === esmPixi.Container,
    cjsBoundToCjsPixi: cjsAdapter.pixi.Container === cjsPixi.Container,
    // One implementation module: binding the same Pixi instance through either entry yields the same exports.
    sharedBindPixi: esm.bindPixi === cjs.bindPixi,
    sameInstanceSameClass: cjs.bindPixi(esmPixi).Pixi7Adapter === esm.Pixi7Adapter
        && esm.bindPixi(cjsPixi).Pixi7Adapter === cjs.Pixi7Adapter,
    loadedImplementations: loaded(/pixi-7[\\/]dist[\\/]cjs[\\/]bind\.js$/),
    loadedCore: loaded(/core[\\/]dist[\\/]cjs[\\/]index\.js$/),
    sharedConstants: esm.PIXI7_BOUNDS === cjs.PIXI7_BOUNDS,
    manifestId: esmAdapter.manifest.id,
    // Tree shaking: the ESM wrapper imports the binding exports by name, never the namespace, and binds only those.
    esmPixiImports: pixiImports,
    bindingExports: [...esm.PIXI7_BINDING_EXPORTS],
    esmBoundExports: Object.keys(esmAdapter.pixi).sort(),
    cjsBoundExports: Object.keys(cjsAdapter.pixi).sort(),
    reactLoaded: Object.keys(require.cache).some((file) => (/[\\/]node_modules[\\/](react|react-dom|react-reconciler|its-fine)[\\/]/).test(file)),
}));
