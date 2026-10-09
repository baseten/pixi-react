/** The same factory consumed with `require` (CJS declarations) shares core's types with the ESM entry. */
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Bind, PixiAdapter, PixiTypes, ReactAdapter, ReactBindingFamily, Runtime } from '@pixi-react-provisional/core';

interface Types extends PixiTypes
{
    readonly app: { readonly cjs: true };
}

interface AppReader<S extends PixiTypes>
{
    app(): S['app'];
}

interface Family extends ReactBindingFamily
{
    readonly type: AppReader<Extract<this['pixi'], PixiTypes>>;
}

declare const pixi: PixiAdapter<Types>;

declare const react: ReactAdapter<Family>;

const renderer = createRenderer({ react, pixi });

export const cjs: true = renderer.app().cjs;
export const runtime: Runtime<Types> = renderer.runtime;
export type Bound = Bind<Family, Types>;
// @ts-expect-error The require entry is typed as precisely as the import entry.
export const wrong: false = renderer.app().cjs;
