/**
 * `@pixi-react-provisional/pixi-7/jsx/react-18`: the React 18 JSX entry, types only. It adds the registered
 * catalogue's prefixed elements (`PixiElements` from `./jsx`) to every JSX namespace of `@types/react` 18.3:
 * `React.JSX` (classic `React.createElement`), `react/jsx-runtime` (automatic), `react/jsx-dev-runtime`
 * (development) and the deprecated global `JSX`. React 19's types have no global `JSX`; in 18.3 `React.JSX` extends
 * the global namespace, not the reverse, so code that names `JSX.IntrinsicElements` needs its own augmentation. Import it once, type-only, in a program
 * that uses `@types/react` 18.3:
 *
 * ```ts
 * import type {} from '@pixi-react-provisional/pixi-7/jsx/react-18';
 * ```
 *
 * Use it with the React 18 adapter (`@pixi-react-provisional/react-18`) composed with `Pixi7Adapter`. Like the React 19
 * entry, the augmentation is global to the program: conflicting tags (the Pixi 8 adapter's entry, for example) need
 * separate programs.
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

declare global
{
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX
    {

        interface IntrinsicElements extends PixiElements {}
    }
}
