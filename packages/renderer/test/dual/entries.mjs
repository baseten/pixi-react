/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Plain Node, built packages, real `exports` resolution: the renderer through `import` and `require`, and core
 * reached both directly and through the renderer, resolve to one instance.
 */
import { createRequire } from 'node:module';
import * as core from '@pixi-react-provisional/core';
import * as esm from '@pixi-react-provisional/renderer';

const require = createRequire(import.meta.url);
const cjs = require('@pixi-react-provisional/renderer');
const cjsCore = require('@pixi-react-provisional/core');

const manifest = (id, extra) => ({
    abi: { major: 1, minor: 0 }, id, packageVersion: '0', certification: 'test', provides: {}, requires: {}, ...extra,
});

class Scene extends core.SceneAdapter
{
    manifest = manifest('dual.scene');
    createSession() { throw new Error('unused'); }
    describe(ctor, name) { return { name, ctor, capabilities: {}, attach: { role: 'child', accepts: [] } }; }
}

class Framework extends cjsCore.FrameworkAdapter
{
    manifest = manifest('dual.framework');
    bind() { return {}; }
}

const fromImport = esm.createRenderer({ framework: new Framework(), scene: new Scene() });
const fromRequire = cjs.createRenderer({ framework: new Framework(), scene: new Scene() });
let error;

try
{
    cjs.createRenderer({ framework: new Framework(), scene: new Scene() }, { requiredCapabilities: { missing: 1 } });
}
catch (caught)
{
    error = caught;
}

const loaded = (pattern) => Object.keys(require.cache).filter((file) => pattern.test(file)).length;

console.log(JSON.stringify({
    sameFactory: esm.createRenderer === cjs.createRenderer,
    sameRuntimeClass: Object.getPrototypeOf(fromImport.runtime) === Object.getPrototypeOf(fromRequire.runtime),
    distinctRuntimes: fromImport.runtime !== fromRequire.runtime,
    errorIsCoreClass: error instanceof core.CompatibilityError && error instanceof cjsCore.CompatibilityError,
    errorCode: error?.code,
    coreImplementations: loaded(/core[\\/]dist[\\/]cjs[\\/]index\.js$/),
    rendererImplementations: loaded(/renderer[\\/]dist[\\/]cjs[\\/]index\.js$/),
}));
