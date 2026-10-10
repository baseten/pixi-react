/**
 * The modular composition on Pixi 7: `createRenderer({ react: new React18Adapter(), pixi: new Pixi7Adapter() })`
 * infers every binding type from the selected adapters, with no explicit type arguments and no global JSX. The ticker
 * passes Pixi 7's numeric delta; the application options are Pixi 7's.
 */
import * as React from 'react';
import { createRef } from 'react';
import { type Application, BlurFilter, Container, Graphics, Sprite, Texture, type Ticker } from 'pixi.js';
import { CompatibilityError } from '@pixi-react-provisional/core';
import { Pixi7Adapter, type Pixi7Types, type Pixi7Props } from '@pixi-react-provisional/pixi-7';
import { type ApplicationRef, React18Adapter, type Root } from '@pixi-react-provisional/react-18.3';
import { createRenderer } from '@pixi-react-provisional/renderer';
import { Bunny, Labelled } from './catalog.js';

void React;

const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi7Adapter() });
const { Application: PixiApplication, extend, useApplication, useTick, component, applyProps, createRoot } = renderer;

extend({ Container, Sprite, Graphics, BlurFilter });

const SpriteComponent = component(Sprite);
const BunnyComponent = component(Bunny);
const LabelledComponent = component(Labelled);
const BlurComponent = component(BlurFilter);
const GraphicsComponent = component(Graphics);
const appRef = createRef<ApplicationRef<Application>>();

export function Scene()
{
    const { app, isInitialised } = useApplication();
    const stage: Container = app.stage;

    useTick((delta) =>
    {
        const typed: number = delta;

        stage.rotation += typed;
    });
    useTick({
        callback(this: { speed: number }, delta: number)
        {
            stage.x += delta * this.speed;
        },
        context: { speed: 2 },
        isEnabled: isInitialised,
        priority: 1,
    });
    // @ts-expect-error The Pixi 7 tick callback receives the numeric delta, not Pixi 8's Ticker.
    useTick((ticker: Ticker) => ticker.deltaMS);

    return (
        <SpriteComponent texture={Texture.EMPTY} onPointerDown={(event) => event.stopPropagation()}>
            <BlurComponent strength={1} />
            <LabelledComponent marker="x" />
            <BunnyComponent texture={Texture.EMPTY} />
            <GraphicsComponent draw={(graphics) => graphics.lineStyle(1, 0xffffff).moveTo(0, 0).lineTo(1, 1)} />
        </SpriteComponent>
    );
}

export const app = (
    <PixiApplication ref={appRef} width={10} height={10} backgroundAlpha={0} autoStart={false} defaultTextStyle={{ fontSize: 12 }}
        destroyOptions={{ children: true, baseTexture: true }} rendererDestroyOptions onInit={(application: Application) => application.stage}>
        <Scene />
    </PixiApplication>
);

// @ts-expect-error `preference` is a Pixi 8 renderer option.
export const v8Preference = <PixiApplication preference="webgl" />;
// @ts-expect-error Pixi 7's Application.destroy takes `removeView`; Pixi 8's `releaseGlobalResources` is not an option.
export const v8Destroy = <PixiApplication rendererDestroyOptions={{ releaseGlobalResources: true }} />;

export const root: Root<Pixi7Types> = createRoot(document.createElement('div'));
export const rendered: Promise<Application> = root.render(<Scene />, { width: 1, height: 1 });

export const applied: Sprite = applyProps(new Sprite(Texture.EMPTY), { alpha: 0.5, name: 'n' });
export const spriteProps: Pixi7Props<typeof Sprite> = { texture: Texture.EMPTY, x: 1 };
export const isCompatibilityError = (error: unknown) => error instanceof CompatibilityError;
