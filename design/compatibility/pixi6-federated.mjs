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
const P = await import('pixi.js');
const events = await import('@pixi/events');
const root = new P.Container();
const target = new P.Sprite(P.Texture.EMPTY);

root.addChild(target);
const boundary = new events.EventBoundary(root);
const event = new events.FederatedPointerEvent(boundary);
const received = [];
const capture = () => received.push('capture');
const atTarget = () => received.push('target');
const bubble = () => received.push('bubble');

root.addEventListener('pointerdown', capture, { capture: true });
target.addEventListener('pointerdown', atTarget);
root.addEventListener('pointerdown', bubble);
event.target = target;
event.type = 'pointerdown';
event.bubbles = true;
boundary.dispatchEvent(event);
assert.deepEqual(received, ['capture', 'target', 'bubble']);
root.removeEventListener('pointerdown', capture, { capture: true });
target.removeEventListener('pointerdown', atTarget);
root.removeEventListener('pointerdown', bubble);
boundary.dispatchEvent(event);
assert.deepEqual(received, ['capture', 'target', 'bubble']);
const pkg = metadata('@pixi/events');
const bundles = {};

assert.equal(pkg.version, version);
for (const format of ['main', 'module', 'bundle'])
{
    if (!pkg[format]) continue;
    const content = readFileSync(join('node_modules', '@pixi/events', pkg[format]));

    bundles[`@pixi/events/${pkg[format]}`] = { sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };
}
root.destroy({ children: true });
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
    optionalFederatedEvents: typeof events.EventSystem === 'function',
    extensions: typeof P.extensions?.add === 'function',
    assetsInDefaultBundle: typeof P.Assets?.load === 'function',
    loader: typeof P.Loader === 'function',
};
const observations = {
    unmodifiedNodeImport: { exit: bareImport.status, diagnostic: bareImport.stderr.match(/(?:ReferenceError|TypeError|Error):[^\n]+/)?.[0] ?? null },
    bootstrap,
    optionalEvents: {
        version: pkg.version,
        eventBoundary: 'synthetic capture-target-bubble and listener removal',
        received,
        scope: 'explicit event target; no hit testing, DOM events or renderer EventSystem installation',
        exports: Object.keys(events).filter((name) => name !== 'default' && name !== '__esModule'),
    },
    publishedBundles: bundles,
};

process.stdout.write(`${JSON.stringify({ version, capabilities, observations })}\n`);
