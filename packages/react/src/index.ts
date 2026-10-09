/**
 * The CommonJS entry (`lib/index.js`): the facade bound to the pixi.js module that `require` loads. The generated
 * ESM entry (`lib/index.mjs`) binds the module that `import` loads instead; see `bind.ts`. Both pass only the Pixi 8
 * adapter's binding exports (`PIXI8_BINDING_EXPORTS`), imported by name: never the namespace, which would keep every
 * Pixi class in an application bundle.
 */
import { Application as PixiApplication, Container, extensions, Filter, Graphics, ObservablePoint, Point, TextStyle, VERSION } from 'pixi.js';
import { bindFacade, bindPixi } from './bind';
import { type CreateRootOptions } from './typedefs/CreateRootOptions';
import { type UseTickOptions } from './typedefs/UseTickOptions';

import type { TickerCallback } from 'pixi.js';
import type { MaybeInstance } from './helpers/applyProps';
import type { DiffSet } from './typedefs/DiffSet';
import type { HostConfig } from './typedefs/HostConfig';

const facade = bindFacade(bindPixi({
    Application: PixiApplication, Container, extensions, Filter, Graphics, ObservablePoint, Point, TextStyle, VERSION,
}));

export const Application = facade.Application;

/** Creates a new root for a Pixi React app. */
export function createRoot(
    /** @description The DOM node which will serve as the root for this tree. */
    target: HTMLElement | HTMLCanvasElement,

    /** @description Options to configure the tree. */
    options: CreateRootOptions = {},
)
{
    return facade.createRoot(target, options);
}

export * from './global';

/** Apply properties to Pixi.js instance. */
export function applyProps(
    instance: MaybeInstance,
    data: HostConfig['props'] | DiffSet,
)
{
    return facade.applyProps(instance, data);
}

export function extend(objects: {
    [key: string]: new (...args: any) => any },
)
{
    facade.extend(objects);
}

/**
 * @description Retrieves the nearest Pixi.js Application from the Pixi React context.
 */
export function useApplication()
{
    return facade.useApplication();
}

/** Expose Pixi.js components for use in JSX. */
export function useExtend(
    /** @description The Pixi.js components to be exposed. */
    objects: Parameters<typeof extend>[0],
)
{
    facade.useExtend(objects);
}

/** Attaches a callback to the application's Ticker. */
export function useTick<T>(
    /** @description The function to be called on each tick. */
    options: TickerCallback<T> | UseTickOptions<T>,
)
{
    facade.useTick(options);
}

export { type ApplicationRef } from './typedefs/ApplicationRef';
export { type PixiElements } from './typedefs/PixiElements';
export { type PixiReactElementProps } from './typedefs/PixiReactNode';
export { type UnprefixedPixiElements } from './typedefs/UnprefixedPixiElements';
