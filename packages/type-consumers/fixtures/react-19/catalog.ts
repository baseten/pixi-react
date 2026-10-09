/**
 * The registered catalogue of this consumer: every standard Pixi 8 node of the installed pixi.js plus two custom
 * classes, declared to JSX through `PixiCatalog`. `extend(catalog)` (renderer.tsx) registers the same values.
 */
import { Container, type ContainerOptions } from 'pixi.js';

import type { Pixi8StandardCatalog } from '@pixi-react-provisional/pixi-8';
import type {} from '@pixi-react-provisional/pixi-8/jsx/react-19';

/** A custom node whose constructor options are required. */
export class Labelled extends Container
{
    constructor(options: ContainerOptions & { marker: string })
    {
        super(options);
        this.label = options.marker;
    }
}

/** A generic custom node. */
export class Tagged<T extends 'a' | 'b' = 'a' | 'b'> extends Container
{
    tag: T | undefined;

    constructor(options?: ContainerOptions & { tag?: T })
    {
        super(options);
        this.tag = options?.tag;
    }
}

/** A custom class that is never registered: it has no tag. */
export class Unregistered extends Container {}

export const customCatalog = { Labelled, Tagged };

type Registered = Pixi8StandardCatalog & typeof customCatalog;

declare module '@pixi-react-provisional/pixi-8/jsx'
{
    interface PixiCatalog extends Registered {}
}
