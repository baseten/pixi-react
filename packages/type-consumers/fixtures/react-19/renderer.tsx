/**
 * The modular composition: `createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() })` infers every
 * binding type from the selected adapters, with no explicit type arguments and no global JSX.
 */
import * as React from 'react';
import { createRef, type ComponentType } from 'react';
import {
    type Application,
    BlurFilter,
    Container,
    Graphics,
    Sprite,
    Texture,
    type Ticker,
} from 'pixi.js';
import { createRenderer } from '@pixi-react-provisional/renderer';
import { Pixi8Adapter, type Pixi8Types } from '@pixi-react-provisional/pixi-8';
import {
    type ApplicationRef,
    type ComponentsOf,
    type ElementProps,
    React19Adapter,
    type Root,
} from '@pixi-react-provisional/react-19/19.3';
import { customCatalog, Labelled, Tagged } from './catalog.js';

void React;

const renderer = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });
const { Application: PixiApplication, extend, useExtend, useApplication, useTick, component, applyProps, createRoot } = renderer;

extend({ Container, Sprite, Graphics, BlurFilter });
extend(customCatalog);

const SpriteComponent = component(Sprite);
const LabelledComponent = component(Labelled);
const TaggedComponent = component(Tagged, 'Tagged');
const BlurComponent = component(BlurFilter);
const GraphicsComponent = component(Graphics);

export const components: ComponentsOf<Pixi8Types, typeof customCatalog> = { Labelled: LabelledComponent, Tagged: TaggedComponent };
export const spriteComponent: ComponentType<ElementProps<Pixi8Types, typeof Sprite>> = SpriteComponent;

const appRef = createRef<ApplicationRef<Application>>();
const spriteRef = createRef<Sprite>();

export function Scene()
{
    useExtend({ Labelled });

    const { app, isInitialised } = useApplication();
    const stage: Container = app.stage;

    useTick((ticker) =>
    {
        const typed: Ticker = ticker;

        stage.rotation += typed.deltaTime;
    });
    useTick({
        callback(this: { speed: number }, ticker: Ticker)
        {
            stage.x += ticker.deltaMS * this.speed;
        },
        context: { speed: 2 },
        isEnabled: isInitialised,
        priority: 1,
    });
    // @ts-expect-error The Pixi 8 tick callback receives the Ticker, not a numeric delta.
    useTick((delta: number) => delta);
    // @ts-expect-error The callback's `this` is the context type.
    useTick({ callback(this: { speed: number }) { return this.speed; }, context: { pace: 1 } });

    return (
        <SpriteComponent ref={spriteRef} texture={Texture.EMPTY} onPointerDown={(event) => event.stopPropagation()}>
            <BlurComponent strength={1} />
            <LabelledComponent marker="x" />
            <TaggedComponent tag="b" />
            <GraphicsComponent draw={(graphics) => graphics.clear()} />
        </SpriteComponent>
    );
}

export const app = (
    <PixiApplication
        ref={appRef}
        width={200}
        background="#123456"
        antialias
        resizeTo={window}
        defaultTextStyle={{ fontSize: 12 }}
        onInit={(application) => application.stage.addChild(new Container())}
        onInitError={(error) => console.error(error)}
        destroyOptions={{ children: true }}
    >
        <Scene />
    </PixiApplication>
);

export const canvas: HTMLCanvasElement | null = appRef.current?.getCanvas() ?? null;
export const application: Application | null = appRef.current?.getApplication() ?? null;

export async function lifecycle(target: HTMLCanvasElement)
{
    const root: Root<Pixi8Types> = createRoot(target, { onInit: (initialised: Application) => initialised.stage });
    const initialised: Application = await root.render(<Scene />, { width: 100, height: 100 });

    initialised.stage.addChild(new Sprite());
    await root.unmount();
    await renderer.runtime.dispose();
}

export const applied: Sprite = applyProps<typeof Sprite>(new Sprite(), { x: 1, texture: Texture.WHITE });

// --- Application options come from the Pixi adapter's options
// @ts-expect-error `width` is a number.
export const wrongWidth = <PixiApplication width="wide" />;
// @ts-expect-error onInit receives the Pixi Application.
export const wrongInit = <PixiApplication onInit={(application: Ticker) => application.speed} />;
// @ts-expect-error An ApplicationRef is not an Application ref.
export const wrongAppRef = <PixiApplication ref={createRef<Application>()} />;

// --- component(Ctor) props
// @ts-expect-error A custom constructor's required options stay required.
export const missingMarker = <LabelledComponent />;
// @ts-expect-error A generic constructor keeps its constraint.
export const wrongTag = <TaggedComponent tag="z" />;
// @ts-expect-error Filters take no children.
export const blurChildren = <BlurComponent><SpriteComponent /></BlurComponent>;
// @ts-expect-error A pointer handler cannot take a wheel event.
export const wrongHandler = <SpriteComponent onPointerDown={(event: WheelEvent) => event.deltaY} />;
// @ts-expect-error The ref is the instance type.
export const wrongComponentRef = <SpriteComponent ref={createRef<Graphics>()} />;

// --- applyProps and the hooks
// @ts-expect-error applyProps keeps event payload types.
applyProps<typeof Sprite>(new Sprite(), { onPointerDown: (event: number) => event });
// @ts-expect-error extend takes constructors, not instances.
extend({ sprite: new Sprite() });
// @ts-expect-error useApplication's app is a Pixi Application, not a string.
export const notString: () => string = () => useApplication().app;
