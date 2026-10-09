/** Nodes and options added within the peer range, as the installed pixi.js 8.22.0 declares them. */
import * as React from 'react';
import { createRef } from 'react';
import { type RenderLayer, Texture } from 'pixi.js';

void React;

const layerRef = createRef<RenderLayer>();

export const later = (
    <pixiContainer>
        <pixiParticleContainer>
            <pixiParticle texture={Texture.WHITE} x={1} />
        </pixiParticleContainer>
        <pixiRenderLayer ref={layerRef} sortableChildren />
        <pixiPerspectiveMesh texture={Texture.WHITE} />
        <pixiSplitText text="split" style={{ fontSize: 12 }} />
        <pixiSplitBitmapText text="split" style={{ fontSize: 12 }} />
        <pixiAnimatedSprite textures={[Texture.EMPTY]} loop={false} animationSpeed={2} />
    </pixiContainer>
);

// @ts-expect-error SplitText's options require a style.
export const splitStyle = <pixiSplitText text="x" />;
// @ts-expect-error A Particle needs its texture.
export const particleTexture = <pixiParticle />;
// @ts-expect-error Particles are leaves.
export const particleChildren = <pixiParticle texture={Texture.WHITE}><pixiSprite /></pixiParticle>;
// @ts-expect-error A RenderLayer takes no JSX children: membership is `layer.attach(node)`.
export const layerChildren = <pixiRenderLayer><pixiSprite /></pixiRenderLayer>;
// @ts-expect-error A DOMContainer takes no JSX children.
export const domChildren = <pixiDOMContainer><pixiSprite /></pixiDOMContainer>;
// @ts-expect-error AnimatedSpriteOptions.loop is a boolean.
export const wrongLoop = <pixiAnimatedSprite textures={[Texture.EMPTY]} loop="yes" />;
