/**
 * `@pixi-react-provisional/pixi-7/jsx/react-19`: adds the registered catalogue's prefixed elements (`PixiElements`
 * from `./jsx`) to React 19's JSX namespaces: `React.JSX` (classic `React.createElement`), `react/jsx-runtime`
 * (automatic) and `react/jsx-dev-runtime` (development). Import it once, type-only, in a program that uses
 * `@types/react` 19:
 *
 * ```ts
 * import type {} from '@pixi-react-provisional/pixi-7/jsx/react-19';
 * ```
 *
 * The augmentation is global to the TypeScript program. One program cannot declare the same tag with two different
 * prop types, so compositions that need conflicting tags (another Pixi or React major) need separate programs or the
 * local `component(Ctor)` route; type arguments of `createRenderer` do not select a JSX namespace.
 */
import type {} from 'react';
import type {} from 'react/jsx-dev-runtime';
import type {} from 'react/jsx-runtime';
import type { PixiElements } from './index.js';

export type { PixiCatalog, PixiElementProps, PixiElements, UnprefixedPixiElements } from './index.js';

declare module 'react'
{
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX
    {

        interface IntrinsicElements extends PixiElements {}
    }
}

declare module 'react/jsx-runtime'
{
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX
    {

        interface IntrinsicElements extends PixiElements {}
    }
}

declare module 'react/jsx-dev-runtime'
{
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX
    {

        interface IntrinsicElements extends PixiElements {}
    }
}
