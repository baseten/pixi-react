/** JSX elements of the registered catalogue (catalog.ts) through `@pixi-react-provisional/pixi-8/jsx/react-19`. */
import * as React from 'react';
import { createRef } from 'react';
import {
    type BlurFilter,
    type Container,
    type FederatedPointerEvent,
    type FederatedWheelEvent,
    type Graphics,
    type Sprite,
    Texture,
} from 'pixi.js';

import type { PixiElementProps, PixiElements } from '@pixi-react-provisional/pixi-8/jsx';
import type { Labelled, Tagged } from './catalog.js';

void React;

const spriteRef = createRef<Sprite>();
const labelledRef = createRef<Labelled>();
const filterRef = createRef<BlurFilter>();

export const scene = (
    <pixiContainer key="root" x={10} sortableChildren onPointerTap={(event) => event.stopPropagation()}>
        <pixiSprite ref={spriteRef} texture={Texture.EMPTY} anchor={0.5} position={{ x: 1, y: 2 }} />
        <pixiGraphics draw={(graphics) => graphics.clear().rect(0, 0, 1, 1).fill(0xff0000)} />
        <pixiText text="hello" style={{ fill: 'red', fontSize: 12 }} />
        <pixiBitmapText text="bitmap" style={{ fontSize: 12 }} />
        <pixiHtmlText text="<b>html</b>" style={{ fontSize: 12 }} />
        <pixiTilingSprite texture={Texture.EMPTY} width={10} height={10} tilePosition={{ x: 1, y: 1 }} />
        <pixiNineSliceSprite texture={Texture.EMPTY} leftWidth={1} />
        <pixiAnimatedSprite textures={[Texture.EMPTY]} autoUpdate={false} />
        <pixiContainer onWheel={(event) => event.deltaY} onPointerDown={(event) => event.pointerId}>
            <pixiSprite texture={Texture.WHITE}>
                <pixiBlurFilter ref={filterRef} strength={2} quality={4} />
                <pixiAlphaFilter alpha={0.5} />
            </pixiSprite>
        </pixiContainer>
        <pixiLabelled ref={labelledRef} marker="registered">
            <pixiTagged tag="a" />
        </pixiLabelled>
        {null}
    </pixiContainer>
);

// Element props are the reusable mapping: they can be extended like upstream's `PixiElements['pixiTilingSprite']`.
export type TilingSpriteProps = PixiElements['pixiTilingSprite'] & { image?: string };
export const drawProps: PixiElementProps<typeof import('pixi.js').Graphics>['draw'] = (graphics: Graphics) => graphics.clear();
export const pointer = (event: FederatedPointerEvent) => event.pointerId;
export const wheel = (event: FederatedWheelEvent) => event.deltaY;
export const handlers = <pixiContainer onPointerMove={pointer} onWheel={wheel} onClick={null} />;
export const containerRef = createRef<Container>();
export const refs = <pixiContainer ref={containerRef} />;

// --- wrong events
// @ts-expect-error A pointer handler receives a FederatedPointerEvent, not a number.
export const wrongEventPayload = <pixiSprite onPointerDown={(event: number) => event} />;
// @ts-expect-error A wheel handler receives a FederatedWheelEvent, which is not a FederatedPointerEvent.
export const wrongWheelPayload = <pixiContainer onWheel={pointer} />;
// @ts-expect-error Pixi-cased event options are omitted; handlers use the React-cased names.
export const lowercaseEvent = <pixiContainer onclick={() => undefined} />;
// @ts-expect-error There is no such event prop.
export const unknownEvent = <pixiContainer onPointerSlide={() => undefined} />;

// --- wrong constructor options
// @ts-expect-error BlurFilterOptions.strength is a number (the override table's options form, not the positional overload).
export const wrongBlur = <pixiBlurFilter strength="strong" />;
// @ts-expect-error A custom constructor's required options stay required.
export const missingOptions = <pixiLabelled />;
// @ts-expect-error A generic custom constructor keeps its option constraint.
export const wrongGeneric = <pixiTagged tag="c" />;
// @ts-expect-error AnimatedSprite needs its textures.
export const missingTextures = <pixiAnimatedSprite />;
// @ts-expect-error Text options take a style object, not a number.
export const wrongStyle = <pixiText text="x" style={12} />;

// --- readonly and non-option members
// @ts-expect-error Readonly instance metadata is not a prop.
export const readonlyUid = <pixiSprite uid={1} />;
// @ts-expect-error Computed, readonly transforms are not props.
export const readonlyWorld = <pixiContainer worldTransform={undefined} />;
// @ts-expect-error Methods are not props.
export const methodProp = <pixiContainer addChild={() => undefined} />;

// --- refs, draw and children
// @ts-expect-error A ref receives the instance: a Texture ref does not fit a Sprite.
export const wrongRef = <pixiSprite ref={createRef<Texture>()} />;
// @ts-expect-error `draw` exists only on Graphics.
export const drawOnSprite = <pixiSprite draw={() => undefined} />;
// @ts-expect-error The draw callback receives the Graphics instance, not a Sprite.
export const wrongDraw = <pixiGraphics draw={(sprite: Sprite) => sprite.anchor} />;
// @ts-expect-error Filters are leaves: they take no JSX children.
export const filterChildren = <pixiBlurFilter><pixiSprite /></pixiBlurFilter>;

// --- tags follow the registered catalogue
// @ts-expect-error Abstract classes have no tag.
export const abstractTag = <pixiAbstractText />;
// @ts-expect-error Internal classes have no tag.
export const internalTag = <pixiBlurFilterPass />;
// @ts-expect-error Resources are props, not elements.
export const resourceTag = <pixiTexture />;
// @ts-expect-error Deprecated aliases have no tag.
export const deprecatedTag = <pixiNineSlicePlane />;
// @ts-expect-error A class that is not in the registered catalogue has no tag.
export const unregisteredTag = <pixiUnregistered />;
