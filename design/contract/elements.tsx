import { createRef } from 'react';
import { AnimatedSprite, BitmapText, BlurFilter, Container, HTMLText, Text, Texture, TilingSprite } from 'pixi.js';
import { createRenderer } from './renderer.js';
import { Pixi8Adapter } from './pixi-8.js';
import { React19Adapter } from './react-19.js';
// Positive probes for upstream ConstructorOverrides / OmitKeys / PixiReactElementProps mapping.
const renderer = createRenderer({ framework: new React19Adapter(), scene: new Pixi8Adapter() });
class NoOptions extends Container { constructor() { super(); } }
const ContainerComponent = renderer.component(Container);
const TextComponent = renderer.component(Text);
const BitmapTextComponent = renderer.component(BitmapText);
const HTMLTextComponent = renderer.component(HTMLText, 'HTMLText');
const TilingSpriteComponent = renderer.component(TilingSprite);
const BlurFilterComponent = renderer.component(BlurFilter);
const AnimatedSpriteComponent = renderer.component(AnimatedSprite);
const NoOptionsComponent = renderer.component(NoOptions, 'NoOptions');
const noOptionsRef = createRef<NoOptions>();
export const text = <TextComponent text="hello" style={{ fill: 'red', fontSize: 12 }} x={4} />;
export const bitmapText = <BitmapTextComponent text="hello" style={{ fontSize: 12 }} />;
export const htmlText = <HTMLTextComponent text="<b>hello</b>" style={{ fontSize: 12 }} />;
export const tilingSprite = <TilingSpriteComponent texture={Texture.EMPTY} width={10} height={10} tilePosition={{ x: 1, y: 1 }} />;
export const blurFilter = <BlurFilterComponent strength={2} quality={4} />;
export const animatedSprite = <AnimatedSpriteComponent textures={[Texture.EMPTY]} autoUpdate={false} x={1} />;
export const noOptions = <NoOptionsComponent ref={noOptionsRef}><TextComponent text="child" /></NoOptionsComponent>;
export const children = <ContainerComponent x={1} onPointerTap={(event) => event.stopPropagation()}>
    <TextComponent text="a" />
    <ContainerComponent><BitmapTextComponent text="b" /></ContainerComponent>
</ContainerComponent>;
// @ts-expect-error BlurFilterOptions.strength is a number, not the deprecated positional overload's shape.
export const wrongBlur = <BlurFilterComponent strength="strong" />;
// @ts-expect-error The 8.2.6 AnimatedSprite row keeps its required textures.
export const missingTextures = <AnimatedSpriteComponent />;
// @ts-expect-error Lowercase Pixi event options are omitted; handlers use the React-cased names.
export const lowercaseEvent = <ContainerComponent onclick={() => undefined} />;
