// Historical scene/API audit, not a browser, renderer or adapter certificate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const metadata = (name) => JSON.parse(readFileSync(join('node_modules', name, 'package.json')));
const version = metadata('pixi.js').version;
const bareImport = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import("pixi.js")'], { encoding: 'utf8' });
const bootstrap = [];

// Old bundles eagerly construct Texture.WHITE and expect browser global aliases.
// This fixture supplies only the import-time canvas fill; it cannot render.
if (bareImport.status !== 0 && (/ReferenceError: (self|window|document) is not defined/).test(bareImport.stderr))
{
    globalThis.self = globalThis;
    globalThis.window = globalThis;
    globalThis.CanvasRenderingContext2D = class ImportCanvasContext {};
    globalThis.document = {
        createElement(tag)
        {
            assert.equal(tag, 'canvas');

            return {
                width: 0,
                height: 0,
                getContext(type)
                {
                    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') return null;
                    assert.equal(type, '2d');

                    return { fillStyle: '', fillRect: (...args) => bootstrap.push({ operation: 'import-time-fillRect', args }) };
                },
            };
        },
    };
    bootstrap.push({ operation: 'browser-global-import-fixture', globals: ['self', 'window', 'document', 'CanvasRenderingContext2D'], webgl: 'unavailable' });
}
const bundles = {};

for (const name of ['@pixi/app', '@pixi/display', '@pixi/ticker', '@pixi/spritesheet'])
{
    const pkg = metadata(name);

    for (const format of ['main', 'module', 'bundle'])
    {
        const path = pkg[format];

        if (!path) continue;
        const content = readFileSync(join('node_modules', name, path), 'utf8');

        bundles[`${name}/${path}`] = {
            packageVersion: pkg.version,
            sha256: createHash('sha256').update(content).digest('hex'),
            bytes: Buffer.byteLength(content),
            embeddedCoreDefinitions: ['BaseTexture', 'Texture', 'Renderer'].filter((symbol) => new RegExp(`function ${symbol}\\(`).test(content)),
        };
    }
}
const spriteDeclarationsPath = '@pixi/spritesheet/index.d.ts';
const spriteDeclarations = readFileSync(join('node_modules', spriteDeclarationsPath), 'utf8');
const spritesheet = {
    declarations: {
        path: spriteDeclarationsPath,
        sha256: createHash('sha256').update(spriteDeclarations).digest('hex'),
        parseSignatures: spriteDeclarations.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('parse(')),
    },
    scope: 'Texture.EMPTY with no frames; no image loading, texture upload or rendering',
};
let P;

try
{
    P = await import('pixi.js');
}
catch (error)
{
    // Preserve the default ESM failure; a supplementary CJS route is labelled separately.
    const cjs = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const P = require('pixi.js');
        const sheet = new P.Spritesheet(P.Texture.EMPTY, { frames: {}, meta: { scale: '1' } });
        let callbacks = 0;
        const result = sheet.parse(textures => { callbacks++; assert.deepEqual(textures, {}); });
        assert.equal(callbacks, 1);
        assert.equal(result, undefined);
        sheet.destroy(false);
        process.stdout.write(JSON.stringify({ route: 'supplementary CommonJS require', callbacks, returnType: 'undefined' }));
    `], { encoding: 'utf8' });

    spritesheet.commonjs = { exit: cjs.status, result: cjs.status === 0 ? JSON.parse(cjs.stdout) : null, diagnostic: cjs.stderr.match(/(?:ReferenceError|TypeError|Error):[^\n]+/)?.[0] ?? null };
    process.stdout.write(`${JSON.stringify({ version, capabilities: null, observations: { spritesheet, publishedBundles: bundles } })}\n`);
    throw error;
}
const sheet = new P.Spritesheet(P.Texture.EMPTY, { frames: {}, meta: { scale: '1' } });

if (Number(version.split('.')[1]) >= 5)
{
    const parsed = sheet.parse();

    assert.ok(parsed instanceof Promise);
    assert.deepEqual(await parsed, {});
    spritesheet.runtime = { route: 'default ESM import', noArgumentReturn: 'Promise', resolvedTextureCount: 0 };
}
else
{
    let callbacks = 0;
    const parsed = sheet.parse((textures) =>
    {
        callbacks++;
        assert.deepEqual(textures, {});
    });

    assert.equal(callbacks, 1);
    assert.equal(parsed, undefined);
    spritesheet.runtime = { route: 'default ESM import with recorded bootstrap where needed', callbacks, callbackReturn: 'undefined' };
}
sheet.destroy(false);
const embeddedTickerPaths = Object.entries(bundles).filter(([path, bundle]) => path.startsWith('@pixi/ticker/') && bundle.embeddedCoreDefinitions.length > 0).map(([path]) => path);
const packaging = embeddedTickerPaths.length > 0
    ? { status: 'embedded-core-definitions', errors: ['ticker embeds core implementation'], inspectedPaths: embeddedTickerPaths }
    : { status: 'no-core-definitions-in-inspected-ticker' };

if (version === '6.5.0') assert.equal(packaging.status, 'embedded-core-definitions');
if (version === '6.5.1' || version === '6.5.10') assert.equal(packaging.status, 'no-core-definitions-in-inspected-ticker');
const parent = new P.Container();
const a = new P.Sprite(P.Texture.EMPTY);
const b = new P.Sprite(P.Texture.EMPTY);

parent.addChild(a, b);
assert.deepEqual(parent.children, [a, b]);
parent.addChildAt(b, 0);
assert.deepEqual(parent.children, [b, a]);
parent.setChildIndex(a, 0);
assert.deepEqual(parent.children, [a, b]);
parent.removeChild(a);
assert.equal(a.parent, null);
b.position.set(12, 34);
b.scale.set(0, 2);
b.alpha = 0.5;
b.visible = false;
b.interactive = true;
b.buttonMode = true;
assert.deepEqual([b.x, b.y, b.scale.x, b.scale.y, b.alpha, b.visible, b.interactive, b.buttonMode], [12, 34, 0, 2, 0.5, false, true, true]);
let received;
const listener = (event) => { received = event; };
const emitted = { probe: 'event-emitter-only' };

b.on('pointerdown', listener);
b.emit('pointerdown', emitted);
assert.equal(received, emitted);
b.off('pointerdown', listener);
received = null;
b.emit('pointerdown', emitted);
assert.equal(received, null);
const ticker = new P.Ticker();
const deltas = [];
const tick = (delta) => deltas.push({ argument: delta, deltaMS: ticker.deltaMS, elapsedMS: ticker.elapsedMS });

ticker.add(tick);
ticker.update(100);
ticker.update(116);
assert.equal(deltas.length, 2);
assert.ok(deltas.every((sample) => typeof sample.argument === 'number' && sample.argument > 0));
assert.equal(deltas[1].elapsedMS, 16);
ticker.remove(tick);
ticker.update(132);
assert.equal(deltas.length, 2);
ticker.destroy();
const particleContainer = new P.ParticleContainer(16, { position: true, rotation: true });
const particleSprite = new P.Sprite(P.Texture.EMPTY);

particleContainer.addChild(particleSprite);
assert.equal(particleContainer.children[0], particleSprite);
particleContainer.destroy({ children: true });
const destroyEvents = [];

b.on('destroyed', () => destroyEvents.push({ publicDestroyedDuringEvent: b.destroyed ?? null }));
parent.destroy({ children: true });
a.destroy();
assert.equal(b.parent, null);
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
    loader: typeof P.Loader === 'function',
};
const observations = {
    unmodifiedNodeImport: { exit: bareImport.status, diagnostic: bareImport.stderr.match(/(?:ReferenceError|TypeError|Error):[^\n]+/)?.[0] ?? null },
    bootstrap,
    spritesheet,
    packaging,
    scene: 'construct-add-reorder-remove-properties-destroy',
    eventScope: 'EventEmitter on/emit/off only; no DOM events, propagation or hit testing',
    application: {
        constructorArity: P.Application.length,
        initMethod: typeof P.Application.prototype.init,
        destroyMethod: typeof P.Application.prototype.destroy,
        registerPlugin: typeof P.Application.registerPlugin,
        registeredPlugins: P.Application._plugins.map((plugin) => plugin.name),
        resizeScope: 'registered ResizePlugin and consumer types only; no real renderer or resize events',
        runtimeConstruction: 'not-exercised-requires-renderer',
    },
    ticker: { callback: 'numeric deltaTime', samples: deltas, scheduling: 'manual update calls only' },
    particleContainer: 'Sprite children; no Particle class',
    destruction: { publicDestroyedAfterDestroy: b.destroyed ?? null, events: destroyEvents },
    publishedBundles: bundles,
};

process.stdout.write(`${JSON.stringify({ version, capabilities, observations })}\n`);
