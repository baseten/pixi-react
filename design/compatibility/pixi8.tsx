import { Application, Text, Texture, Sprite, Ticker } from 'pixi.js';
const app = new Application();
const initialized: Promise<void> = app.init({ width: 16, height: 16, preference: 'webgl' });
new Text({ text: 'modern', style: { fill: 0xffffff } });
new Sprite({ texture: Texture.EMPTY });
new Ticker().add(ticker => { const n: number = ticker.deltaMS; void n; });
void initialized;
