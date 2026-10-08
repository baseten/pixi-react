// Optional Assets API presence only: no init, fetch, decoding or renderer calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as P from 'pixi.js';
import { Assets } from '@pixi/assets';

const metadata = (name) => JSON.parse(readFileSync(join('node_modules', name, 'package.json')));
const version = metadata('pixi.js').version;
const pkg = metadata('@pixi/assets');
const methods = ['init', 'load', 'unload', 'add', 'loadBundle'];

assert.equal(pkg.version, version);
for (const method of methods) assert.equal(typeof Assets[method], 'function');
assert.equal(typeof P.Assets, 'undefined');
const sources = {};

for (const path of [...new Set([pkg.main, pkg.module, pkg.bundle, pkg.types].filter(Boolean))])
{
    const content = readFileSync(join('node_modules', '@pixi/assets', path));

    sources[`@pixi/assets/${path}`] = { sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };
}
const capabilities = {
    asyncInit: typeof P.Application.prototype.init === 'function',
    particle: typeof P.Particle === 'function',
    particleContainer: typeof P.ParticleContainer === 'function',
    cacheAsTexture: typeof P.Container.prototype.cacheAsTexture === 'function',
    renderLayer: typeof P.RenderLayer === 'function',
    domContainer: typeof P.DOMContainer === 'function',
    canvasRenderer: typeof P.CanvasRenderer === 'function',
    interactionManager: typeof P.InteractionManager === 'function',
    federatedEventsInDefaultBundle: typeof P.EventSystem === 'function',
    extensions: typeof P.extensions?.add === 'function',
    assetsInDefaultBundle: typeof P.Assets?.load === 'function',
    optionalAssets: typeof Assets.load === 'function',
    loader: typeof P.Loader === 'function',
};
const observations = {
    assets: { version: pkg.version, methods, scope: 'API presence only; no init, fetch, decoding, loading or rendering' },
    publishedSources: sources,
};

process.stdout.write(`${JSON.stringify({ version, capabilities, observations })}\n`);
