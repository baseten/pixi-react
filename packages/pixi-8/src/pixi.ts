/**
 * The shape of the pixi.js module the implementation is bound to. The implementation never imports pixi.js at
 * runtime: each entry point binds the module its own module system loaded (see `bind.ts`), so a consumer's
 * `import { Sprite } from 'pixi.js'` and the adapter always share one Pixi instance.
 *
 * Exports added after the 8.2.6 floor are optional and structurally typed, so the emitted declarations compile
 * against every Pixi version in the peer range.
 */
import type * as Pixi from 'pixi.js';

/** A Pixi 8.5+ `Particle`: not a Container, attached through its ParticleContainer. */
export interface ParticleLike
{
    texture: { destroy(destroySource?: boolean): void } | null;
    alpha: number;
}

/** A Pixi 8.5+ `ParticleContainer`. */
export interface ParticleContainerLike
{
    particleChildren: ParticleLike[];
    addParticle(...particles: ParticleLike[]): unknown;
    addParticleAt(particle: ParticleLike, index: number): unknown;
    removeParticleAt(index: number): unknown;
    removeParticles(beginIndex?: number, endIndex?: number): ParticleLike[];
}

type AnyConstructor = new (...args: any[]) => object;

/** Exports that only some versions in the peer range have. */
export interface OptionalPixiExports
{
    /** 8.5+ */
    Particle?: AnyConstructor;
    /** 8.5+ */
    ParticleContainer?: AnyConstructor;
    /** 8.7+ */
    RenderLayer?: AnyConstructor;
    /** 8.9+ */
    DOMContainer?: AnyConstructor;
}

export type PixiModule = typeof Pixi & OptionalPixiExports;
