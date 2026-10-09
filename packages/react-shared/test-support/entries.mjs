/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node (no bundler, no DOM) against a BUILT adapter package, once with `import` and once with
 * `require`, through the package's own `exports` map. Prints a JSON report that the package's unit test asserts on.
 *
 * Usage: node entries.mjs <packageDir>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDir = process.argv[2];
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
// Self-reference: the package resolves its own name through its `exports` map, as a consumer's import would.
const require = createRequire(join(packageDir, 'package.json'));
const exportNames = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const before = new Set(Object.keys(require.cache));
const esm = await import(pathToFileURL(join(packageDir, manifest.exports['.'].import.default)).href);
const cjs = require(manifest.name);
const loaded = Object.keys(require.cache).filter((file) => !before.has(file));
const versionOf = (name) => JSON.parse(readFileSync(join(dirname(require.resolve(`${name}/package.json`)), 'package.json'), 'utf8')).version;
const adapterClass = Object.keys(cjs).find((name) => (/^React\d+Adapter$/).test(name));

console.log(JSON.stringify({
    esmExports: exportNames(esm),
    cjsExports: exportNames(cjs),
    differing: exportNames(cjs).filter((name) => esm[name] !== cjs[name]),
    sameAdapterClass: esm[adapterClass] === cjs[adapterClass],
    implementationFiles: loaded.filter((file) => file.startsWith(join(packageDir, 'dist'))).map((file) => relative(packageDir, file)),
    reconcilerLoaded: loaded.some((file) => (/[\\/]react-reconciler[\\/]/).test(file)),
    resolved: Object.fromEntries(['react-reconciler', 'its-fine'].map((name) => [name, versionOf(name)])),
    hasDom: typeof globalThis.HTMLElement !== 'undefined',
}));
