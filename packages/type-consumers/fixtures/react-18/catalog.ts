/**
 * A React 18 consumer that registers part of the standard catalogue and one custom class. Only those get tags. The
 * runtime `extend(catalog)` comes from the React 18 adapter (issue 12); this program checks the JSX types alone.
 */
import { BlurFilter, Container, type ContainerOptions, Graphics, Sprite, Text } from 'pixi.js';

import type {} from '@pixi-react-provisional/pixi-8/jsx/react-18';

export class Labelled extends Container
{
    constructor(options: ContainerOptions & { marker: string })
    {
        super(options);
        this.label = options.marker;
    }
}

export const catalog = { Container, Sprite, Graphics, Text, BlurFilter, Labelled };

type Registered = typeof catalog;

declare module '@pixi-react-provisional/pixi-8/jsx'
{
    interface PixiCatalog extends Registered {}
}
