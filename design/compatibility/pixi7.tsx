import { Application, Text, Texture, Sprite, Ticker, ParticleContainer } from 'pixi.js';
new Application({ width: 16, height: 16 });
new Text('legacy', { fill: 0xffffff });
new Ticker().add(delta => { const n: number = delta; void n; });
new ParticleContainer().addChild(new Sprite(Texture.EMPTY));
