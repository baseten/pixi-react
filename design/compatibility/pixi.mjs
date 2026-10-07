import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as P from 'pixi.js';
const version = JSON.parse(readFileSync('node_modules/pixi.js/package.json')).version;
const legacy = version.startsWith('7.');
const parent = new P.Container();
const a = new P.Sprite(P.Texture.EMPTY);
const b = new P.Sprite(P.Texture.EMPTY);
parent.addChild(a, b);
parent.addChildAt(b, 0);
assert.deepEqual(parent.children, [b, a]);
parent.removeChild(a);
assert.equal(a.parent, null);
b.visible = false;
assert.equal(b.visible, false);
b.visible = true;
let event = false;
b.on('pointerdown', () => { event = true; });
b.emit('pointerdown', {});
assert.equal(event, true); // emitter API only; no hit testing claimed
const ticker = new P.Ticker();
let argument;
ticker.add(value => { argument = value; });
ticker.update(100);
assert.equal(legacy ? typeof argument === 'number' : argument === ticker, true);
ticker.destroy();
const capabilities = { asyncInit: typeof P.Application.prototype.init === 'function', particle: typeof P.Particle === 'function', particleContainer: typeof P.ParticleContainer === 'function', cacheAsTexture: typeof parent.cacheAsTexture === 'function', renderLayer: typeof P.RenderLayer === 'function', domContainer: typeof P.DOMContainer === 'function', canvasRenderer: typeof P.CanvasRenderer === 'function' };
const observations = {};
if (P.Particle) {
    const pc = new P.ParticleContainer();
    const p = new P.Particle(P.Texture.EMPTY);
    observations.particleIsContainer = p instanceof P.Container;
    pc.addParticle(p);
    assert.equal(pc.particleChildren.includes(p), true);
    observations.removeParticlesDefaultCount = pc.removeParticles().length;
    pc.destroy();
}
let visibleEvents = 0;
parent.on('visibleChanged', () => visibleEvents++);
parent.visible = false;
observations.visibleChanged = visibleEvents;
if (!legacy) {
    parent.updateTransform({ scaleX: 0, scaleY: 0 });
    observations.zeroScale = [parent.scale.x, parent.scale.y];
    const transformed = new P.Container();
    transformed.setFromMatrix(new P.Matrix().rotate(Math.PI / 6).scale(-1, 1));
    observations.mirroredTransform = { rotation: transformed.rotation, scaleX: transformed.scale.x, skewX: transformed.skew.x };
    transformed.destroy();
}
const files = [];
function scan(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${entry.name}`; if (entry.isDirectory()) scan(p); else if (/\.(d\.ts|mjs)$/.test(p) && /(Application|Container|Particle|Ticker|Federated|Extension|Sprite|Text|global)/i.test(p)) files.push(p); } }
scan('node_modules/pixi.js/lib');
const surfaces = Object.fromEntries(files.sort().map(p => [p.replace('node_modules/pixi.js/', ''), createHash('sha256').update(readFileSync(p)).digest('hex')]));
parent.destroy({ children: true });
a.destroy();
assert.equal(parent.destroyed, true);
console.log(JSON.stringify({ version, capabilities, observations, surfaces }));
