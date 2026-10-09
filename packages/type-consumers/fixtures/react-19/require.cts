// A CommonJS consumer: `require` resolves each package's `require` condition and its declarations.
import renderer = require('@pixi-react-provisional/renderer');
import pixi8 = require('@pixi-react-provisional/pixi-8');
import react19 = require('@pixi-react-provisional/react-19/19.3');
import type { Application, Ticker } from 'pixi.js';

const bound = renderer.createRenderer({ react: new react19.React19Adapter(), pixi: new pixi8.Pixi8Adapter() });

export function useSpin(): Application
{
    bound.useTick((ticker: Ticker) => ticker.deltaTime);

    return bound.useApplication().app;
}

// @ts-expect-error The tick is the Pixi 8 Ticker.
bound.useTick((delta: string) => delta);
