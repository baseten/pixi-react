import type { Application, ApplicationOptions, Container, DestroyOptions, ExtensionFormatLoose, FederatedPointerEvent, FederatedWheelEvent, Graphics, GraphicsContext, RendererDestroyOptions, TextStyleOptions, Texture, Ticker } from 'pixi.js';
import type { Constructor, NodeDefinition, PropsFamily, PropsOf, Runtime, SceneSession, SceneTypes } from './core.js';
import { SceneAdapter } from './core.js';
/** Representative subset. The complete overload table is owned by issue 8/11. */
type Options<C extends Constructor> = NonNullable<Exclude<ConstructorParameters<C>[0], Texture | GraphicsContext>>;
type DataProps<P> = { [K in keyof P as P[K] extends (...args: never[]) => unknown ? never : K]: P[K] };
export type Pixi8Props<C extends Constructor> = DataProps<Options<C>> & {
    onPointerDown?: (event: FederatedPointerEvent) => void;
    onWheel?: (event: FederatedWheelEvent) => void;
} & (InstanceType<C> extends Graphics ? { draw: (graphics: InstanceType<C>) => void } : {});
export interface Pixi8PropsFamily extends PropsFamily { readonly type: Pixi8Props<Extract<this['constructorType'], Constructor>> }
export interface Pixi8Types extends SceneTypes {
    readonly node: object;
    readonly app: Application;
    readonly options: Partial<ApplicationOptions>;
    readonly appProps: Partial<ApplicationOptions> & {
        extensions?: ExtensionFormatLoose[];
        defaultTextStyle?: TextStyleOptions;
        resizeTo?: HTMLElement | Window;
    };
    readonly destroy: { destroyOptions?: DestroyOptions; rendererDestroyOptions?: RendererDestroyOptions };
    readonly tick: Ticker;
    readonly props: Pixi8PropsFamily;
}
export declare class Pixi8Adapter extends SceneAdapter<Pixi8Types> {
    readonly manifest: import('./core.js').AdapterManifest;
    createSession(runtime: Runtime<Pixi8Types>, target: HTMLElement | HTMLCanvasElement): SceneSession<Pixi8Types>;
    describe<C extends Constructor>(ctor: C): NodeDefinition<InstanceType<C>, PropsOf<Pixi8Types, C>>;
}
/** Child support is selected by the Pixi catalog, never assumed by core. */
export type ContainerInstance = Container;
