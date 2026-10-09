/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node (no bundler, no DOM) against the BUILT package through its own `exports` map, once with
 * `import` and once with `require`. Prints a JSON report; the D6 test asserts on it.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const exportNames = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const specifier = '@pixi-react-provisional/react-18';
const before = new Set(Object.keys(require.cache));
const esm = await import(specifier);
const cjs = require(specifier);
const loaded = Object.keys(require.cache).filter((file) => !before.has(file));

console.log(JSON.stringify({
    esmExports: exportNames(esm),
    cjsExports: exportNames(cjs),
    differing: exportNames(cjs).filter((name) => esm[name] !== cjs[name]),
    sameAdapterClass: esm.React18Adapter === cjs.React18Adapter,
    implementationFiles: loaded.filter((file) => (/react-18[\\/]dist[\\/]index\.js$/).test(file)),
    reconcilerFiles: loaded.filter((file) => (/react-reconciler|its-fine|scheduler/).test(file)),
    reactFiles: loaded.filter((file) => (/[\\/]react[\\/]/).test(file)),
    hasDom: typeof globalThis.HTMLElement !== 'undefined',
}));
