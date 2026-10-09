/**
 * The facade keeps upstream's element types (D4): every pixi.js constructor is a prefixed tag. Upstream types each
 * handler as a union of the pointer and wheel handler types, so a handler parameter needs an annotation.
 */
import * as React from 'react';
import { type FederatedPointerEvent, Texture } from 'pixi.js';

void React;

export const elements = (
    <pixiContainer onPointerTap={(event: FederatedPointerEvent) => event.stopPropagation()}>
        <pixiSprite texture={Texture.EMPTY} />
        <pixiGraphics draw={(graphics) => graphics.clear()} />
        <pixiText text="hello" />
    </pixiContainer>
);

// @ts-expect-error Upstream's props reject unknown option keys.
export const unknownProp = <pixiSprite notAProp />;
