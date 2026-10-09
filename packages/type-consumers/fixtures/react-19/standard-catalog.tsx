/**
 * `Pixi8StandardCatalog` is a `Catalog` (core's `Readonly<Record<string, Constructor>>`): it can be passed to
 * `extend` and mapped by `ComponentsOf`, while its keys stay exact.
 */
import * as React from 'react';
import {
    AlphaFilter, AnimatedSprite, BitmapText, BlurFilter, ColorMatrixFilter, Container, DisplacementFilter, Filter,
    Graphics, HTMLText, Mesh, MeshPlane, MeshRope, MeshSimple, NineSliceSprite, NoiseFilter, RenderContainer, Sprite,
    Text, TilingSprite,
} from 'pixi.js';
import { createRenderer } from '@pixi-react-provisional/renderer';
import { Pixi8Adapter, type Pixi8FloorCatalog, type Pixi8StandardCatalog, type Pixi8Types } from '@pixi-react-provisional/pixi-8';
import { type ComponentsOf, React19Adapter } from '@pixi-react-provisional/react-19.3';

import type { Catalog } from '@pixi-react-provisional/core';

void React;

export const floor: Pixi8FloorCatalog = {
    Container, Sprite, AnimatedSprite, Graphics, Text, BitmapText, HTMLText, TilingSprite, NineSliceSprite, Mesh,
    MeshPlane, MeshRope, MeshSimple, RenderContainer, Filter, AlphaFilter, BlurFilter, ColorMatrixFilter,
    DisplacementFilter, NoiseFilter,
};

declare const standard: Pixi8StandardCatalog;

export const asCatalog: Catalog = standard;
export const floorAsCatalog: Catalog = floor;

const renderer = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });

renderer.extend(standard);
renderer.extend(floor);

declare const components: ComponentsOf<Pixi8Types, Pixi8StandardCatalog>;

export const SpriteComponent = components.Sprite;
export const sprite = <components.Sprite texture={undefined} x={1} />;
export const blur = <components.BlurFilter strength={2} />;

// Keys stay exact: `keyof` does not widen to `string`.
export const key: keyof Pixi8StandardCatalog = 'Sprite';
// @ts-expect-error Not a standard node.
export const wrongKey: keyof Pixi8StandardCatalog = 'Texture';
// @ts-expect-error No component for a key outside the catalog.
export const missing = components.Texture;
