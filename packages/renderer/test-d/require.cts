/** The same factory consumed with `require` (CJS declarations) shares core's types with the ESM entry. */
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Bind, BindingFamily, FrameworkAdapter, Runtime, SceneAdapter, SceneTypes } from '@pixi-react-provisional/core';

interface Scene extends SceneTypes
{
    readonly app: { readonly cjs: true };
}

interface AppReader<S extends SceneTypes>
{
    app(): S['app'];
}

interface Family extends BindingFamily
{
    readonly type: AppReader<Extract<this['scene'], SceneTypes>>;
}

declare const scene: SceneAdapter<Scene>;

declare const framework: FrameworkAdapter<Family>;

const renderer = createRenderer({ framework, scene });

export const cjs: true = renderer.app().cjs;
export const runtime: Runtime<Scene> = renderer.runtime;
export type Bound = Bind<Family, Scene>;
// @ts-expect-error The require entry is typed as precisely as the import entry.
export const wrong: false = renderer.app().cjs;
