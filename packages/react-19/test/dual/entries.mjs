/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node (no bundler, no DOM) against the BUILT package through its own `exports` map: each subpath once
 * with `import` and once with `require`. Prints a JSON report; the D6 test asserts on it.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const exportNames = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const report = {};

for (const epoch of ['19.0', '19.1', '19.2', '19.3'])
{
    const specifier = `@pixi-react-provisional/react-19/${epoch}`;
    const before = new Set(Object.keys(require.cache));
    const esm = await import(specifier);
    const cjs = require(specifier);
    const loaded = Object.keys(require.cache).filter((file) => !before.has(file));

    report[epoch] = {
        esmExports: exportNames(esm),
        cjsExports: exportNames(cjs),
        differing: exportNames(cjs).filter((name) => esm[name] !== cjs[name]),
        sameAdapterClass: esm.React19Adapter === cjs.React19Adapter,
        implementationFiles: loaded.filter((file) => (/react-19[\\/]dist[\\/]19\.\d[\\/]index\.js$/).test(file)),
        reconcilerFiles: loaded.filter((file) => (/react-reconciler/).test(file)),
    };
}

report.hasDom = typeof globalThis.HTMLElement !== 'undefined';
console.log(JSON.stringify(report));
