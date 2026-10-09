import type { Bind, ReactBindingFamily, ReactAdapter, RendererOptions, Runtime, PixiAdapter, PixiTypes } from './core.js';
/** No React or Pixi dependency, including in emitted declarations. */
export declare function createRenderer<S extends PixiTypes, F extends ReactBindingFamily>(
    adapters: { react: ReactAdapter<F>; pixi: PixiAdapter<S> },
    options?: RendererOptions,
): Bind<F, S> & { readonly runtime: Runtime<S> };
