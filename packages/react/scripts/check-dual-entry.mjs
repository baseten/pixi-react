#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Checks decision D6 on the BUILT facade in plain Node, through the package's own `exports` map: `import` and
 * `require` reach one implementation module (`lib/bind.js`, with the adapters bundled in `lib/adapters.js`) and one
 * default runtime per pixi.js instance, and that `lib/` requires the adapter's react-reconciler and its-fine as
 * dependencies instead of bundling them (issue 49).
 *
 * In plain Node, pixi.js itself loads twice (its ESM and CJS builds), so the ESM and CJS entries are bound to two
 * Pixi instances and get two runtimes, as the modular Pixi 8 adapter package does. A bundler resolves one Pixi
 * instance; that case is checked by binding the one implementation module to one pixi.js module through different
 * namespace objects. Run after `pnpm build`.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(packageDir, 'package.json'));

const cjs = require('@pixi/react');
const esm = await import('@pixi/react');
const bind = require(join(packageDir, 'lib', 'bind.js'));
const pixiCjs = require('pixi.js');
const pixiEsm = await import('pixi.js');
// The bundled Pixi 8 adapter, bound to each module system's pixi.js (as the two entries bind it).
const pixi8Cjs = bind.bindPixi(pixiCjs);
const pixi8Esm = bind.bindPixi(pixiEsm);
const expected = ['Application', 'applyProps', 'createRoot', 'extend', 'useApplication', 'useExtend', 'useTick'];
const loaded = (suffix) => Object.keys(require.cache).filter((file) => file.endsWith(suffix));

// Both entries expose exactly the upstream names.
assert.deepEqual(Object.keys(cjs).filter((name) => name !== '__esModule').sort(), expected, 'require() names');
assert.deepEqual(Object.keys(esm).sort(), expected, 'import names');

// One implementation module: the ESM entry imports the CJS lib/bind.js, and no ESM copy of it exists.
assert.equal(loaded('/lib/bind.js').length, 1, 'lib/bind.js loaded once');
assert.equal(loaded('/lib/adapters.js').length, 1, 'the bundled adapters (lib/adapters.js) loaded once');

// Issue 49: lib/ bundles only our own adapter code. The React 19.3 adapter's react-reconciler and its-fine are this
// package's dependencies, loaded from node_modules (react-reconciler picks its own build by NODE_ENV), once.
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

assert.deepEqual(manifest.dependencies, { 'its-fine': '2.1.1', 'react-reconciler': '0.34.0' }, 'the adapter\'s dependencies, exact');
assert.deepEqual(Object.keys(require.cache).filter((file) => !file.startsWith(join(packageDir, 'lib')) && !file.includes('/node_modules/')), [],
    'no workspace adapter package loaded: the facade runs its bundled adapters');
assert.equal(loaded('/react-reconciler/index.js').length, 1, 'react-reconciler loaded once, as a dependency');
assert.equal(require(join(dirname(require.resolve('react-reconciler/package.json')), 'package.json')).version, '0.34.0', 'react-reconciler 0.34.0');
assert.equal(loaded('/its-fine/dist/index.cjs').length, 1, 'its-fine loaded once, as a dependency');
assert.deepEqual(readdirSync(join(packageDir, 'lib'), { recursive: true }).map(String).filter((file) => (/^adapters\./).test(file)).sort(),
    ['adapters.js', 'adapters.js.map'], 'one adapters chunk: no per-NODE_ENV split');

for (const file of readdirSync(join(packageDir, 'lib'), { recursive: true }).map(String).filter((name) => name.endsWith('.js')))
{
    assert.doesNotMatch(readFileSync(join(packageDir, 'lib', file), 'utf8'),
        /react-reconciler\.(?:development|production)|scheduler\.(?:development|production)|reconcilerVersion:|unstable_scheduleCallback/,
        `lib/${file} contains no reconciler, scheduler or its-fine source`);
}
assert.equal(loaded('/react/index.js').length, 1, 'React loaded once');
assert.deepEqual(readdirSync(join(packageDir, 'lib'), { recursive: true }).filter((file) => String(file).endsWith('.mjs')), ['index.mjs'],
    'lib/index.mjs is the only ESM file');

// The ESM entry's values ARE the facade the one implementation module bound to the ESM Pixi 8 adapter.
const esmFacade = bind.bindFacade(pixi8Esm);

for (const name of expected)
{
    assert.equal(esm[name], esmFacade[name], `import { ${name} } comes from lib/bind.js`);
}

// One bound adapter per Pixi instance, and one facade and one runtime per Pixi 8 adapter class, whichever namespace
// object carries them (a bundler's case).
assert.equal(bind.bindPixi({ ...pixiCjs }), pixi8Cjs, 'one bound Pixi 8 adapter per Pixi instance');
assert.equal(bind.bindFacade({ ...pixi8Cjs }), bind.bindFacade(pixi8Cjs), 'one facade per adapter class');
assert.equal(bind.facadeRuntimeFor({ Pixi8Adapter: pixi8Cjs.Pixi8Adapter }), bind.facadeRuntimeFor(pixi8Cjs), 'one runtime per adapter class');

// The CJS entry registers into the runtime bound to the CJS adapter.
cjs.extend({ DualEntryProbe: pixiCjs.Container });
assert.equal(bind.facadeRuntimeFor(pixi8Cjs).renderer().runtime.registry.has('DualEntryProbe'), true, 'CJS extend reaches the CJS runtime');

// Plain Node loads pixi.js twice, so the two entries are bound to two Pixi instances and keep separate runtimes.
const separatePixi = pixiEsm.Container !== pixiCjs.Container;

assert.equal(bind.facadeRuntimeFor(pixi8Esm).pixi.Container, pixiEsm.Container, 'ESM entry bound to the ESM Pixi');
assert.equal(bind.facadeRuntimeFor(pixi8Cjs).pixi.Container, pixiCjs.Container, 'CJS entry bound to the CJS Pixi');

console.log(JSON.stringify({
    names: expected,
    implementationFiles: [...loaded('/lib/bind.js'), ...loaded('/lib/adapters.js')].map((file) => relative(packageDir, file)),
    dependencies: Object.keys(require.cache).filter((file) => (/[\\/]node_modules[\\/](?:react-reconciler|scheduler|its-fine)[\\/]/).test(file))
        .map((file) => file.slice(file.lastIndexOf('node_modules/') + 'node_modules/'.length)),
    esmEntryUsesImplementation: true,
    oneRuntimePerPixiInstance: true,
    plainNodePixiInstances: separatePixi ? 2 : 1,
}, null, 2));
