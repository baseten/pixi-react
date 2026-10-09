/**
 * Opt-in unprefixed tags, by the consumer's own module augmentation. `text` and `filter` are React DOM's SVG tags: a
 * tag cannot be declared twice in one program, so they are omitted and stay available as `pixiText`/`pixiFilter`
 * (must-fail/unprefixed-collision shows the error otherwise).
 */
import * as React from 'react';
import { Texture } from 'pixi.js';

import type { UnprefixedPixiElements } from '@pixi-react-provisional/pixi-8/jsx';

void React;

type SafeUnprefixed = Omit<UnprefixedPixiElements, 'text' | 'filter'>;

declare module 'react'
{
    namespace JSX
    {
        interface IntrinsicElements extends SafeUnprefixed {}
    }
}

export const unprefixed = (
    <container x={1}>
        <sprite texture={Texture.EMPTY} />
        <htmlText text="html" />
        <labelled marker="custom" />
        <pixiText text="prefixed names stay available" />
    </container>
);

// @ts-expect-error `text` is still React DOM's SVG element: it has no Pixi `resolution`.
export const svgText = <text resolution={2} />;
// @ts-expect-error Unprefixed tags carry the same props: a sprite has no `marker`.
export const wrongUnprefixed = <sprite marker="x" />;
