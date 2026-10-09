/**
 * The pixi.js exports the implementation is bound to. The implementation never imports pixi.js at runtime: each
 * entry point binds the module its own module system loaded (see `bind.ts`), so a consumer's
 * `import { Sprite } from 'pixi.js'` and the adapter always share one Pixi instance.
 *
 * The entries import exactly `PIXI8_BINDING_EXPORTS` by name and pass them as a `PixiBinding`, never the module
 * namespace: a namespace object passed to a function keeps every Pixi export alive in every bundler. Built-ins the
 * adapter must recognize but must not keep (Sprite, Text, Mesh, the filters, and the optional exports below) are
 * recognized from the constructors an application registers (`builtins.ts`), so a class nobody registers is never
 * referenced and a bundler can drop it, as with upstream's `extend`.
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
    /** 8.11+: the shared base of `SplitText` and `SplitBitmapText`. */
    AbstractSplitText?: abstract new (...args: any[]) => object;
    /** 8.11+ */
    SplitText?: AnyConstructor;
    /** 8.11+ */
    SplitBitmapText?: AnyConstructor;
}

/**
 * A whole pixi.js module namespace, with the exports added later in the peer range typed as optional. A namespace is
 * also a valid `PixiBinding` (tests bind namespaces), but the entry points never pass one.
 */
export type PixiModule = typeof Pixi & OptionalPixiExports;

/**
 * The pixi.js exports the implementation uses at runtime, imported by name by each entry point. Every one exists on
 * the 8.2.6 floor, so a strict ESM named import never fails within the peer range. Keep the list short: each name is
 * kept in every application bundle. `Application`, `Container`, `Filter`, `Graphics`, `extensions` and `TextStyle`
 * are the upstream 8.0.5 facade's own runtime imports; `Point`, `ObservablePoint` and `VERSION` add no module.
 */
export const PIXI8_BINDING_EXPORTS = Object.freeze([
    'Application',
    'Container',
    'Filter',
    'Graphics',
    'ObservablePoint',
    'Point',
    'TextStyle',
    'VERSION',
    'extensions',
] as const);

/** The name of a pixi.js export the implementation is bound to. */
export type PixiBindingExport = typeof PIXI8_BINDING_EXPORTS[number];

/** The pixi.js exports the implementation is bound to: `PIXI8_BINDING_EXPORTS`, taken from one loaded pixi.js module. */
export type PixiBinding = Pick<typeof Pixi, PixiBindingExport>;
