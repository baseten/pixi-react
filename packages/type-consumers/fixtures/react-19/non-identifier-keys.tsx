/**
 * A catalog key that is not an identifier (`'world-layer'`) is registered unchanged by `normalizePixiName`, so its
 * element name is the key itself, never a prefixed or recased form.
 */
import { type Container } from 'pixi.js';
import type { Pixi8PrefixedName, Pixi8UnprefixedName } from '@pixi-react-provisional/pixi-8';
import type { PrefixedElementsOf, UnprefixedElementsOf } from '@pixi-react-provisional/pixi-8/jsx';

interface Layers
{
    'world-layer': typeof Container;
    Sprite2: typeof Container;
}

export const prefixed: Pixi8PrefixedName<'world-layer'> = 'world-layer';
export const unprefixed: Pixi8UnprefixedName<'world-layer'> = 'world-layer';
// @ts-expect-error the runtime never resolves a prefixed form of a non-identifier key
export const wrongPrefixed: Pixi8PrefixedName<'world-layer'> = 'pixiWorld-layer';

export const identifierStillPrefixed: Pixi8PrefixedName<'Sprite2'> = 'pixiSprite2';

declare const elements: PrefixedElementsOf<Layers>;
declare const unprefixedElements: UnprefixedElementsOf<Layers>;

export const worldLayer = elements['world-layer'];
export const worldLayerUnprefixed = unprefixedElements['world-layer'];
export const sprite2 = elements.pixiSprite2;
// @ts-expect-error no prefixed tag exists for a non-identifier key
export const missing = elements['pixiWorld-layer'];
