/** At the 8.2.6 floor the later nodes are absent and AnimatedSprite has its positional constructor's options. */
import * as React from 'react';
import { Texture } from 'pixi.js';

void React;

export const floor = <pixiAnimatedSprite textures={[Texture.EMPTY]} autoUpdate={false} x={1} />;

// @ts-expect-error ParticleContainer is not exported by pixi.js 8.2.6.
export const noParticles = <pixiParticleContainer />;
// @ts-expect-error RenderLayer is not exported by pixi.js 8.2.6.
export const noLayer = <pixiRenderLayer />;
// @ts-expect-error SplitText is not exported by pixi.js 8.2.6.
export const noSplit = <pixiSplitText text="x" />;
// @ts-expect-error The 8.2.6 AnimatedSprite constructor has no `loop` option.
export const noLoop = <pixiAnimatedSprite textures={[Texture.EMPTY]} loop={false} />;
