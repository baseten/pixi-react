// Additional 6.5 declaration surface; not part of the earlier 6.x consumer.
import { Container, ExtensionType, Sprite, Texture, extensions } from 'pixi.js';

const sprites = new Container<Sprite>();
const child = sprites.addChild(new Sprite(Texture.EMPTY));
const sprite: Sprite = child;

void sprite;
class ProbeApplicationPlugin
{
    static extension = ExtensionType.Application;
    static init(): void { /* Type-only registration contract. */ }
    static destroy(): void { /* Type-only registration contract. */ }
}

extensions.add(ProbeApplicationPlugin);
extensions.remove(ProbeApplicationPlugin);
