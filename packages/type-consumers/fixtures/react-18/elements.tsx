/** React 18 JSX (`@types/react` 18.3) through `@pixi-react-provisional/pixi-8/jsx/react-18`. */
import * as React from 'react';
import { createRef } from 'react';
import { type BlurFilter, type FederatedPointerEvent, type Sprite, Texture } from 'pixi.js';

import type { Labelled } from './catalog.js';

void React;

const spriteRef = createRef<Sprite>();
const filterRef = createRef<BlurFilter>();
const labelledRef = createRef<Labelled>();

export const scene = (
    <pixiContainer key="root" x={1} onPointerTap={(event: FederatedPointerEvent) => event.stopPropagation()}>
        <pixiSprite ref={spriteRef} texture={Texture.EMPTY} onWheel={(event) => event.deltaY}>
            <pixiBlurFilter ref={filterRef} strength={2} />
        </pixiSprite>
        <pixiGraphics draw={(graphics) => graphics.clear()} />
        <pixiText text="hello" style={{ fontSize: 12 }} />
        <pixiLabelled ref={labelledRef} marker="custom" />
    </pixiContainer>
);

// The deprecated global JSX namespace of @types/react 18 is augmented too.
export const globalNamespace: JSX.IntrinsicElements['pixiSprite'] = { texture: Texture.EMPTY };

// @ts-expect-error A pointer handler receives a FederatedPointerEvent, not a string.
export const wrongEvent = <pixiSprite onPointerDown={(event: string) => event} />;
// @ts-expect-error BlurFilterOptions.strength is a number.
export const wrongBlur = <pixiBlurFilter strength="strong" />;
// @ts-expect-error A custom constructor's required options stay required.
export const missingOptions = <pixiLabelled />;
// @ts-expect-error Readonly instance metadata is not a prop.
export const readonlyUid = <pixiSprite uid={1} />;
// @ts-expect-error A ref receives the instance.
export const wrongRef = <pixiSprite ref={createRef<Texture>()} />;
// @ts-expect-error Filters are leaves.
export const filterChildren = <pixiBlurFilter><pixiSprite /></pixiBlurFilter>;
// @ts-expect-error TilingSprite is a standard node, but this consumer did not register it.
export const unregistered = <pixiTilingSprite texture={Texture.EMPTY} />;
// @ts-expect-error Unprefixed tags are opt-in.
export const unprefixedOff = <sprite />;
