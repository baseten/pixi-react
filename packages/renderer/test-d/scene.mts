/**
 * A third-party scene and framework, declared the way a consumer sees published adapters: through the built
 * declarations of core and renderer (package `exports`, no source aliases). Nothing here is React or Pixi.
 */
import { FrameworkAdapter, SceneAdapter } from '@pixi-react-provisional/core';

import type {
    AdapterManifest,
    Bind,
    BindingFamily,
    Constructor,
    NodeDefinition,
    PropsFamily,
    PropsOf,
    RootTarget,
    Runtime,
    SceneSession,
    SceneTypes,
} from '@pixi-react-provisional/core';

export class Emitter
{
    constructor(readonly options: { rate: number; label?: string })
    {}
    readonly kind = 'emitter' as const;
}

export class Particle
{
    constructor(readonly options: { index: number })
    {}
    readonly kind = 'particle' as const;
}

export interface Ticker
{
    readonly deltaMS: number;
}

/** Props of a constructor: its first constructor argument. */
export interface ParticlePropsFamily extends PropsFamily
{
    readonly type: ConstructorParameters<Extract<this['constructorType'], abstract new (...args: any) => any>>[0];
}

export interface ParticleScene extends SceneTypes
{
    readonly node: Emitter | Particle;
    readonly app: { readonly label: string; readonly ticker: Ticker };
    readonly options: { width: number; height: number };
    readonly appProps: { label?: string };
    readonly destroy: { keepTextures?: boolean };
    readonly nodeDestroy: { children: boolean };
    readonly tick: Ticker;
    readonly props: ParticlePropsFamily;
}

export declare class ParticleSceneAdapter extends SceneAdapter<ParticleScene>
{
    readonly manifest: AdapterManifest;
    createSession(runtime: Runtime<ParticleScene>, target: RootTarget): SceneSession<ParticleScene>;
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}

/** A second, unrelated scene whose ticks are plain numbers. */
export interface LegacyScene extends SceneTypes
{
    readonly node: { legacy: true };
    readonly app: { readonly view: string };
    readonly tick: number;
}

export declare class LegacySceneAdapter extends SceneAdapter<LegacyScene>
{
    readonly manifest: AdapterManifest;
    createSession(runtime: Runtime<LegacyScene>, target: RootTarget): SceneSession<LegacyScene>;
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}

/** The framework's own API, generic over the composed scene. */
export interface Inspection<S extends SceneTypes>
{
    app(): S['app'];
    onTick(callback: (tick: S['tick']) => void): () => void;
    component<C extends Constructor>(ctor: C): (props: PropsOf<S, C>) => InstanceType<C>;
}

export interface InspectionFamily extends BindingFamily
{
    readonly type: Inspection<Extract<this['scene'], SceneTypes>>;
}

export declare class Inspector extends FrameworkAdapter<InspectionFamily>
{
    readonly manifest: AdapterManifest;
    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<InspectionFamily, S>;
}

/** A real (non-declared) family implementation with a generic bind. */
export interface Counter<S extends SceneTypes>
{
    readonly source: Runtime<S>;
    count(): number;
}

export interface CounterFamily extends BindingFamily
{
    readonly type: Counter<Extract<this['scene'], SceneTypes>>;
}

export class CounterFramework extends FrameworkAdapter<CounterFamily>
{
    readonly manifest: AdapterManifest = {
        abi: { major: 1, minor: 0 },
        id: 'community.counter',
        packageVersion: '1.0.0',
        certification: 'none',
        provides: {},
        requires: {},
    };

    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<CounterFamily, S>
    {
        const bindings: Counter<S> = { source: runtime, count: () => runtime.roots().length };

        // `Extract<S, SceneTypes>` is `S` for every S, but TypeScript cannot reduce it for a generic S.
        return bindings as Bind<CounterFamily, S>;
    }
}

export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type IsAny<T> = 0 extends 1 & T ? true : false;
