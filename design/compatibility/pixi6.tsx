import { Application, Container, InteractionEvent, ParticleContainer, Sprite, Text, Texture, Ticker } from 'pixi.js';

const container = new Container();
const sprite = new Sprite(Texture.EMPTY);

container.addChild(sprite);
container.addChildAt(sprite, 0);
container.setChildIndex(sprite, 0);
container.removeChild(sprite);
sprite.position.set(12, 34);
sprite.scale.set(0, 2);
sprite.alpha = 0.5;
sprite.visible = false;
sprite.interactive = true;
sprite.buttonMode = true;
sprite.on('pointerdown', (event: InteractionEvent) => event.data.global.x);
const ticker = new Ticker();
const listener = (delta: number) => delta;

ticker.add(listener);
ticker.remove(listener);
ticker.destroy();
const particles = new ParticleContainer(16, { position: true, rotation: true });

particles.addChild(new Sprite(Texture.EMPTY));
particles.destroy({ children: true });
const text = new Text('historical', { fill: 0xffffff });

text.text = 'updated';
text.destroy({ children: true });
// Type-only consumer: no renderer, canvas, DOM events or Application was run.
const app = new Application({ width: 16, height: 16, autoStart: false, sharedTicker: false, resizeTo: document.body });

app.resize();
app.resizeTo = window;
app.destroy(true, { children: true, texture: false, baseTexture: false });
