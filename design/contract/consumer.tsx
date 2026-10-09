import { createRef } from 'react';
import { Container, Graphics, Sprite, Texture, type Application, type Ticker } from 'pixi.js';
import { createRenderer } from './renderer.js';
import { Pixi8Adapter } from './pixi-8.js';
import { React19Adapter, type ApplicationRef, type ElementProps } from './react-19.js';
import type { Pixi8Types } from './pixi-8.js';
const renderer = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });
class Custom extends Container { constructor(options: { marker: string }) { super(); this.label = options.marker; } }
renderer.extend({ Custom, Sprite, Graphics });
const CustomComponent = renderer.component(Custom);
const SpriteComponent = renderer.component(Sprite);
const GraphicsComponent = renderer.component(Graphics);
const spriteRef = createRef<Sprite>();
const appRef = createRef<ApplicationRef<Application>>();
const applied: Sprite = renderer.applyProps<typeof Sprite>(new Sprite(), { x: 10 });
void applied;
// @ts-expect-error Explicit constructor type preserves event payloads in applyProps.
renderer.applyProps<typeof Sprite>(new Sprite(), { onPointerDown: (event: number) => event });
export function Scene() {
    renderer.useExtend({ Custom });
    const app: Application = renderer.useApplication().app;
    renderer.useTick((ticker: Ticker) => { app.stage.rotation += ticker.deltaTime; });
    renderer.useTick({ context: spriteRef, callback(ticker) { if (this.current) this.current.rotation += ticker.deltaTime; } });
    // @ts-expect-error Pixi8 callback receives a Ticker, not a Pixi7 delta number.
    renderer.useTick((delta: number) => delta);
    return <renderer.Application ref={appRef} width={200} onInit={(a) => a.stage.addChild(new Container())}>
        <CustomComponent marker="registered" />
        <SpriteComponent ref={spriteRef} texture={Texture.EMPTY} onPointerDown={(event) => event.stopPropagation()} />
        <GraphicsComponent draw={(g) => g.clear()} />
    </renderer.Application>;
}
// @ts-expect-error Custom constructor options remain required.
export const wrongCustom = <CustomComponent />;
// @ts-expect-error A pointer handler cannot accept a number.
export const wrongEvent = <SpriteComponent onPointerDown={(event: number) => event} />;
// @ts-expect-error Ref targets are instances, not constructors or other objects.
export const wrongRef = <SpriteComponent ref={createRef<Texture>()} />;
// @ts-expect-error Readonly instance metadata is not a constructor prop.
export const wrongReadonly = <SpriteComponent uid={1} />;
declare module 'react' { namespace JSX { interface IntrinsicElements { contractSprite: ElementProps<Pixi8Types, typeof Sprite> } } }
export const intrinsic = <contractSprite texture={Texture.EMPTY} />;
export async function lifecycle(canvas: HTMLCanvasElement) {
    const root = renderer.createRoot(canvas, { onRecoverableError: (error) => console.error(error) });
    const app: Application = await root.render(<Scene />, { width: 200 });
    app.stage.addChild(new Container());
    await root.unmount();
    await renderer.runtime.dispose();
}
