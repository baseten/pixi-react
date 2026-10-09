import { Container, type ContainerOptions } from 'pixi.js';
import { type PixiReactElementProps } from '@pixi/react';

class Panel extends Container
{
    constructor(options: ContainerOptions & { title: string })
    {
        super(options);
        this.label = options.title;
    }
}

declare module '@pixi/react'
{
    interface PixiElements
    {
        panel: PixiReactElementProps<typeof Panel>;
    }
}

// Rejected: `title` is not a Text option, and Panel's own options were never consulted.
export const panel = <panel title="settings" />;
