/**
 * A React 19 consumer of the Pixi 7 adapter that registers part of the Pixi 7 catalogue and two custom classes. Only
 * those get tags.
 */
import { BitmapText, BlurFilter, Container, Graphics, ParticleContainer, Sprite, Text, TilingSprite } from 'pixi.js';

import type {} from '@pixi-react-provisional/pixi-7/jsx/react-19';

/** A Container subclass: Pixi 7 constructs it with one options object, so its required options stay required props. */
export class Labelled extends Container
{
    constructor(options: { marker: string })
    {
        super();
        this.name = options.marker;
    }
}

/** A Sprite subclass: Pixi 7 constructs it as a Sprite, with the texture as its positional argument. */
export class Bunny extends Sprite
{
    hops = 0;
}

export const catalog = { Container, Sprite, Graphics, Text, BitmapText, BlurFilter, TilingSprite, ParticleContainer, Labelled, Bunny };

type Registered = typeof catalog;

declare module '@pixi-react-provisional/pixi-7/jsx'
{
    interface PixiCatalog extends Registered {}
}
