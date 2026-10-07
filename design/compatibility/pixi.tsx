import { Application, Container, Sprite, Texture, Ticker, extensions, ExtensionType, type FederatedPointerEvent } from 'pixi.js';
const container = new Container();
const sprite = new Sprite(Texture.EMPTY);
container.addChild(sprite);
container.addChildAt(sprite, 0);
container.removeChild(sprite);
container.visible = false;
container.on('pointerdown', (event: FederatedPointerEvent) => event.global.x);
new Ticker().add(value => { void value; });
const app: Application = null!;
app.destroy(true, { children: true });
void extensions;
void ExtensionType;
// Deliberately shared 7/8 public surface; version-specific additions are separate probes.
