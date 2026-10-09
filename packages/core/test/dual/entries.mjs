/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Runs in plain Node (no bundler, no DOM) against the BUILT package, through its own `exports` map: once with
 * `import` and once with `require`. Prints a JSON report; the D6 test asserts on it.
 */
import { createRequire } from 'node:module';
import * as esm from '@pixi-react-provisional/core';

const require = createRequire(import.meta.url);
const cjs = require('@pixi-react-provisional/core');

const manifest = (id, extra) => ({
    abi: { major: 1, minor: 0 }, id, packageVersion: '0.0.0', certification: 'test', provides: {}, requires: {}, ...extra,
});

// A scene adapter built on the ESM entry and a framework adapter built on the CJS entry compose together.
class Scene extends esm.SceneAdapter
{
    manifest = manifest('dual.scene', { provides: { 'scene.mutation': 1 } });
    createSession() { throw new Error('unused'); }
    describe(ctor, name) { return { name, ctor, capabilities: {}, attach: { role: 'child', accepts: [] } }; }
}

class Framework extends cjs.FrameworkAdapter
{
    manifest = manifest('dual.framework');
    bind() { return {}; }
}

const runtime = esm.compose({ framework: new Framework(), scene: new Scene() });
let unknownElement;

try
{
    runtime.registry.resolve('Missing');
}
catch (error)
{
    unknownElement = error;
}

const exportNames = (module) => Object.keys(module).filter((name) => name !== 'default' && name !== '__esModule').sort();
const implementations = Object.keys(require.cache).filter((file) => (/core[\\/]dist[\\/]cjs[\\/]index\.js$/).test(file));

console.log(JSON.stringify({
    esmExports: exportNames(esm),
    cjsExports: exportNames(cjs),
    differing: exportNames(cjs).filter((name) => esm[name] !== cjs[name]),
    errorIsSharedClass: unknownElement instanceof esm.CompatibilityError && unknownElement instanceof cjs.CompatibilityError,
    errorCode: unknownElement?.code,
    loadedImplementations: implementations.length,
    hasDom: typeof globalThis.HTMLElement !== 'undefined',
}));
