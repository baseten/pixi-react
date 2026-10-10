/**
 * The React 18.0 package's published declarations, installed with React 18.0.0 (its exact peer) and @types/react 18.3:
 * `createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() })` infers the bindings from the adapters,
 * and React 19-only root options are rejected. The other React 18 minors share these declarations (react-shared).
 */
import * as React from 'react';
import { createRef } from 'react';
import { type Application, Container, Sprite, Texture, type Ticker } from 'pixi.js';
import { Pixi8Adapter, type Pixi8Types } from '@pixi-react-provisional/pixi-8';
import { type ApplicationRef, EPOCH, React180Adapter, React18Adapter, type Root } from '@pixi-react-provisional/react-18.0';
import { createRenderer } from '@pixi-react-provisional/renderer';

void React;

const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
const { Application: PixiApplication, extend, useApplication, useTick, component, createRoot } = renderer;

extend({ Container, Sprite });

const SpriteComponent = component(Sprite);
const appRef = createRef<ApplicationRef<Application>>();
const spriteRef = createRef<Sprite>();

export function Scene()
{
    const stage: Container = useApplication().app.stage;

    useTick((ticker: Ticker) =>
    {
        stage.rotation += ticker.deltaTime;
    });

    return <SpriteComponent ref={spriteRef} texture={Texture.EMPTY} label="sprite" x={1} />;
}

export const app = (
    <PixiApplication ref={appRef} width={10} height={10} onInit={(application: Application) => application.stage}>
        <Scene />
    </PixiApplication>
);

// @ts-expect-error onCaughtError is a React 19 root option; React 18 roots take only onRecoverableError.
export const caught = createRoot(document.createElement('div'), { onCaughtError: () => undefined });

export const root: Root<Pixi8Types> = createRoot(document.createElement('div'), { onRecoverableError: () => undefined });
export const epoch: '18.0' | `18.${number}` = EPOCH.epoch;
export const sameClass: typeof React18Adapter = React180Adapter;
