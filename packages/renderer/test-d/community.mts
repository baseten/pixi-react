/**
 * A third-party Pixi adapter and React adapter, declared the way a consumer sees published adapters: through the built
 * declarations of core and renderer (package `exports`, no source aliases). Nothing here is React or Pixi.
 */
import { PixiAdapter, ReactAdapter } from '@pixi-react-provisional/core';

import type {
    AdapterManifest,
    Bind,
    Constructor,
    NodeDefinition,
    PixiSession,
    PixiTypes,
    PropsFamily,
    PropsOf,
    ReactBindingFamily,
    RootTarget,
    Runtime,
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

export interface ParticlePixiTypes extends PixiTypes
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

export declare class ParticlePixiAdapter extends PixiAdapter<ParticlePixiTypes>
{
    readonly manifest: AdapterManifest;
    createSession(runtime: Runtime<ParticlePixiTypes>, target: RootTarget): PixiSession<ParticlePixiTypes>;
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}

/** A second, unrelated Pixi type family whose ticks are plain numbers. */
export interface LegacyPixiTypes extends PixiTypes
{
    readonly node: { legacy: true };
    readonly app: { readonly view: string };
    readonly tick: number;
}

export declare class LegacyPixiAdapter extends PixiAdapter<LegacyPixiTypes>
{
    readonly manifest: AdapterManifest;
    createSession(runtime: Runtime<LegacyPixiTypes>, target: RootTarget): PixiSession<LegacyPixiTypes>;
    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;
}

/** The React adapter's own API, generic over the composed Pixi types. */
export interface Inspection<S extends PixiTypes>
{
    app(): S['app'];
    onTick(callback: (tick: S['tick']) => void): () => void;
    component<C extends Constructor>(ctor: C): (props: PropsOf<S, C>) => InstanceType<C>;
}

export interface InspectionFamily extends ReactBindingFamily
{
    readonly type: Inspection<Extract<this['pixi'], PixiTypes>>;
}

export declare class Inspector extends ReactAdapter<InspectionFamily>
{
    readonly manifest: AdapterManifest;
    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<InspectionFamily, S>;
}

/** A real (non-declared) family implementation with a generic bind. */
export interface Counter<S extends PixiTypes>
{
    readonly source: Runtime<S>;
    count(): number;
}

export interface CounterFamily extends ReactBindingFamily
{
    readonly type: Counter<Extract<this['pixi'], PixiTypes>>;
}

export class CounterReactAdapter extends ReactAdapter<CounterFamily>
{
    readonly manifest: AdapterManifest = {
        abi: { major: 1, minor: 0 },
        id: 'community.counter',
        packageVersion: '1.0.0',
        certification: 'none',
        provides: {},
        requires: {},
    };

    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<CounterFamily, S>
    {
        const bindings: Counter<S> = { source: runtime, count: () => runtime.roots().length };

        // `Extract<S, PixiTypes>` is `S` for every S, but TypeScript cannot reduce it for a generic S.
        return bindings as Bind<CounterFamily, S>;
    }
}

export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type IsAny<T> = 0 extends 1 & T ? true : false;
