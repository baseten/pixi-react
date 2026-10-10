/** React 18 JSX (`@types/react` 18.3) through `@pixi-react-provisional/pixi-7/jsx/react-18`, on pixi.js 7. */
import * as React from 'react';
import { createRef } from 'react';
import { type BlurFilter, type FederatedPointerEvent, Graphics, type Sprite, Texture } from 'pixi.js';

import type { Bunny, Labelled } from './catalog.js';

void React;

const spriteRef = createRef<Sprite>();
const filterRef = createRef<BlurFilter>();
const labelledRef = createRef<Labelled>();
const bunnyRef = createRef<Bunny>();
const { geometry } = new Graphics();

export const scene = (
    <pixiContainer key="root" x={1} name="root" eventMode="static" onPointerTap={(event: FederatedPointerEvent) => event.stopPropagation()}>
        <pixiSprite ref={spriteRef} texture={Texture.EMPTY} position={{ x: 1, y: 2 }} anchor={{ x: 0.5, y: 0.5 }} tint="red" onWheel={(event) => event.deltaY}>
            <pixiBlurFilter ref={filterRef} strength={2} quality={3} />
        </pixiSprite>
        <pixiGraphics draw={(graphics) => graphics.beginFill(0xff0000).drawRect(0, 0, 1, 1).endFill()} />
        <pixiGraphics geometry={geometry} />
        <pixiText text="hello" style={{ fontSize: 12 }} />
        <pixiBitmapText text="hello" style={{ fontName: 'font' }} />
        <pixiTilingSprite texture={Texture.EMPTY} width={10} height={10} />
        <pixiParticleContainer maxSize={100} autoResize>
            <pixiSprite texture={Texture.EMPTY} />
        </pixiParticleContainer>
        <pixiLabelled ref={labelledRef} marker="custom" />
        <pixiBunny ref={bunnyRef} texture={Texture.EMPTY} hops={2} />
    </pixiContainer>
);

// @ts-expect-error `label` is Pixi 8's name; Pixi 7 calls it `name`.
export const v8Label = <pixiSprite label="x" />;
// @ts-expect-error Pixi 7 Graphics share a GraphicsGeometry; Pixi 8's GraphicsContext `context` does not exist.
export const v8Context = <pixiGraphics context={{}} />;
// @ts-expect-error A pointer handler receives a FederatedPointerEvent, not a string.
export const wrongEvent = <pixiSprite onPointerDown={(event: string) => event} />;
// @ts-expect-error BlurFilter's strength is a number.
export const wrongBlur = <pixiBlurFilter strength="strong" />;
// @ts-expect-error TilingSprite's texture is a required constructor argument in Pixi 7.
export const missingTexture = <pixiTilingSprite width={10} />;
// @ts-expect-error BitmapText's text is a required constructor argument in Pixi 7.
export const missingText = <pixiBitmapText />;
// @ts-expect-error A custom constructor's required options stay required.
export const missingOptions = <pixiLabelled />;
// @ts-expect-error Readonly instance state (`destroyed`, a getter) is not a prop.
export const readonlyDestroyed = <pixiSprite destroyed />;
// @ts-expect-error A ref receives the instance.
export const wrongRef = <pixiSprite ref={createRef<Texture>()} />;
// @ts-expect-error Filters are leaves.
export const filterChildren = <pixiBlurFilter><pixiSprite /></pixiBlurFilter>;
// @ts-expect-error BitmapText manages its own children.
export const bitmapChildren = <pixiBitmapText text="x"><pixiSprite /></pixiBitmapText>;
// @ts-expect-error HTMLText is a standard node, but this consumer did not register it.
export const unregistered = <pixiHtmlText text="x" />;
// @ts-expect-error Pixi 8-only classes have no Pixi 7 tag.
export const v8Only = <pixiRenderLayer />;
// @ts-expect-error Unprefixed tags are opt-in.
export const unprefixedOff = <sprite />;

// The deprecated global JSX namespace of @types/react 18 is augmented too.
export const globalNamespace: JSX.IntrinsicElements['pixiSprite'] = { texture: Texture.EMPTY };
