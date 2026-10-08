import type { Bind, BindingFamily, FrameworkAdapter, RendererOptions, Runtime, SceneAdapter, SceneTypes } from './core.js';
/** No React or Pixi dependency, including in emitted declarations. */
export declare function createRenderer<S extends SceneTypes, F extends BindingFamily>(
    adapters: { react: FrameworkAdapter<F>; pixi: SceneAdapter<S> },
    options?: RendererOptions,
): Bind<F, S> & { readonly runtime: Runtime<S> };
