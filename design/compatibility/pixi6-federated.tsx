// Optional @pixi/events consumer; compile only with its exact matching 6.x package.
import { Container, Sprite, Texture } from 'pixi.js';
import { EventBoundary, FederatedPointerEvent } from '@pixi/events';

const root = new Container();
const target = new Sprite(Texture.EMPTY);

root.addChild(target);
const boundary = new EventBoundary(root);
const event = new FederatedPointerEvent(boundary);

root.addEventListener('pointerdown', (received) => received.type, { capture: true });
target.addEventListener('pointerdown', (received) => received.type);
event.target = target;
event.type = 'pointerdown';
boundary.dispatchEvent(event);
