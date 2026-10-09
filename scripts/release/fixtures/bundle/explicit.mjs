// Explicit composition with exactly one React adapter and the Pixi adapter, registering two constructors.
import { Pixi8Adapter } from '__PIXI__';
import { __CLASS__ as ReactAdapter } from '__REACT__';
import { createRenderer } from '__RENDERER__';
import { Container, Sprite } from 'pixi.js';

const renderer = createRenderer({ react: new ReactAdapter(), pixi: new Pixi8Adapter() });

renderer.extend({ Container, Sprite });

export const result = () => ({
    registered: ['pixiContainer', 'pixiSprite'].filter((name) => renderer.runtime.registry.has(name)),
    react: renderer.runtime.manifests.react.id,
    pixi: renderer.runtime.manifests.pixi.id,
});
