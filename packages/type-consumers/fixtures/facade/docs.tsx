/**
 * The baseline's documented TypeScript examples (docs/docs/typescript.mdx and extend.mdx at 30cf1f86), compiled
 * against the packed `@pixi/react` facade, whose declarations keep upstream's all-constructors `PixiElements` (D4).
 *
 * `Viewport` mirrors the public shape of pixi-viewport 6's class (its options with the required `events`, its world
 * size and plugin members). The real package is not installed: its 6.0.3 declarations fail a strict consumer on their
 * own (extensionless relative imports under NodeNext, and an import of the untyped `penner`).
 */
import * as React from 'react';
import { Container, type EventSystem, type Texture } from 'pixi.js';
import { Application, extend, type PixiElements, type PixiReactElementProps, useApplication, useTick } from '@pixi/react';

void React;

// "Extending Built-in Components"
export type TilingSpriteProps = PixiElements['pixiTilingSprite'] & {
    image?: string;
    texture?: Texture;
};

interface IViewportOptions
{
    screenWidth?: number;
    screenHeight?: number;
    worldWidth?: number | null;
    worldHeight?: number | null;
    threshold?: number;
    passiveWheel?: boolean;
    stopPropagation?: boolean;
    noTicker?: boolean;
    events: EventSystem;
    disableOnContextMenu?: boolean;
    allowPreserveDragOutside?: boolean;
}

export class Viewport extends Container
{
    screenWidth: number;
    screenHeight: number;
    readonly plugins: Map<string, unknown> = new Map();

    constructor(options: IViewportOptions)
    {
        super();
        this.screenWidth = options.screenWidth ?? 0;
        this.screenHeight = options.screenHeight ?? 0;
    }

    moveCenter(x: number, y: number): this
    {
        this.position.set(x, y);

        return this;
    }
}

// "Custom Components"
declare module '@pixi/react'
{
    interface PixiElements
    {
        viewport: PixiReactElementProps<typeof Viewport>;
    }
}

// extend.mdx
extend({ Container, Viewport });

function Child()
{
    const { app } = useApplication();

    useTick((ticker) => ticker.deltaTime);

    return (
        <viewport screenWidth={app.screen.width} screenHeight={100} events={app.renderer.events} passiveWheel={false}>
            <pixiContainer x={1} />
        </viewport>
    );
}

export const tree = (
    <Application resizeTo={window}>
        <Child />
    </Application>
);

// @ts-expect-error The custom component's options are typed from its constructor: `events` is required.
export const missingEvents = <viewport screenWidth={1} />;
