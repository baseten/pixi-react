/**
 * `@pixi-react-provisional/pixi-8/jsx`: Pixi 8 element types for React JSX, with no global side effect. It names
 * React's `Key`, `Ref` and `ReactNode` from the `@types/react` the consumer installed (18.3 or 19), and the Pixi
 * types from the installed `pixi.js`.
 *
 * Importing this module augments nothing. `./jsx/react-19` and `./jsx/react-18` add `PixiElements` to React's JSX;
 * a consumer can instead write their own augmentation with the types below (unprefixed or custom names).
 *
 * The tags follow the registered catalogue: `PixiCatalog` is empty until the consumer declares the constructors they
 * `extend`, so a tag exists only for a registered class:
 *
 * ```ts
 * const catalog = { Container, Sprite, Viewport };
 * extend(catalog);
 * type Registered = typeof catalog;
 * declare module '@pixi-react-provisional/pixi-8/jsx' { interface PixiCatalog extends Registered {} }
 * ```
 */
import type { Key, ReactNode, Ref } from 'react';
import type { Constructor, PropsOf } from '@pixi-react-provisional/core';
import type { Pixi8NodeKeys, Pixi8PrefixedName, Pixi8Types, Pixi8UnprefixedName } from '@pixi-react-provisional/pixi-8';

/**
 * The constructors whose elements JSX accepts. Empty by default; augment it with the catalog you register (or with
 * `Pixi8StandardCatalog`, or a `Pick` of it). Values that are not concrete node constructors are ignored.
 */

export interface PixiCatalog {}

/**
 * The JSX props of one constructor: its Pixi 8 props (constructor options, event handlers, `draw` on Graphics) plus
 * React's `key`, an instance `ref` and, for nodes that take children, `children`. Upstream's `PixiReactElementProps`.
 */
export type PixiElementProps<C extends Constructor> = PropsOf<Pixi8Types, C> & {
    key?: Key | null;
    ref?: Ref<InstanceType<C>>;
    children?: ReactNode;
};

/** Prefixed elements (`pixiSprite`) of any catalog. */
export type PrefixedElementsOf<Cat> = {
    [K in Pixi8NodeKeys<Cat> as Pixi8PrefixedName<K>]: PixiElementProps<Extract<Cat[K], Constructor>>;
};

/** Unprefixed elements (`sprite`, `htmlText`) of any catalog. */
export type UnprefixedElementsOf<Cat> = {
    [K in Pixi8NodeKeys<Cat> as Pixi8UnprefixedName<K>]: PixiElementProps<Extract<Cat[K], Constructor>>;
};

/** The prefixed elements of the registered catalogue. `./jsx/react-19` and `./jsx/react-18` add these to JSX. */

export interface PixiElements extends PrefixedElementsOf<PixiCatalog> {}

/**
 * The unprefixed elements of the registered catalogue, for an opt-in augmentation. Some names collide with
 * React DOM's intrinsic elements (`text` and `filter` are SVG tags): such a tag cannot be declared twice in one
 * program, so omit it (`Omit<UnprefixedPixiElements, 'text' | 'filter'>`) and use its prefixed form.
 */
export type UnprefixedPixiElements = UnprefixedElementsOf<PixiCatalog>;
