/**
 * Compile-only declaration consumer for the Pixi 7 adapter, typechecked against the cell's own @types/react, pixi.js 7
 * and the PACKED adapters' published declarations (ESM `import` condition, Bundler resolution). Never executed. The
 * factory must infer the Pixi 7 types through the React bindings from the adapter instances alone, and Pixi 8-only
 * props, options and callback signatures must be rejected. A `compat:begin <id>` … `compat:end <id>` block holds
 * assertions that hold only from some pixi.js version on (adapterMatrix `typeAssertions`): the runner keeps it from that
 * version on and replaces it below with a comment naming the assertion and why.
 */
import { type Application as PixiApplication, type Container, Graphics, Sprite, Texture, type Ticker } from 'pixi.js';
import { createRef } from 'react';
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { ApplicationRef, Root } from '%REACT_SPEC%';
import type { Pixi7Types } from '%PIXI_SPEC%';

export function probe()
{
    const renderer = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });
    const { Application, createRoot, useApplication, useTick, component, useContextBridge, ContextBridgeProvider } = renderer;

    const SpriteComponent = component(Sprite);
    const GraphicsComponent = component(Graphics);
    const spriteRef = createRef<Sprite>();
    const appRef = createRef<ApplicationRef<PixiApplication>>();

    const Child = () =>
    {
        const app: PixiApplication = useApplication().app;

        useTick((delta) =>
        {
            const typed: number = delta;

            void typed;
        });

        // @ts-expect-error the tick argument is Pixi 7's numeric delta, not Pixi 8's Ticker
        useTick((ticker: Ticker) => ticker.deltaTime);

        void app;

        return (
            <>
                <SpriteComponent ref={spriteRef} texture={Texture.EMPTY} x={1} name="sprite" eventMode="static" />
                <GraphicsComponent draw={(graphics) => graphics.beginFill(0xff0000).drawRect(0, 0, 1, 1).endFill()} />
                {/* compat:begin pixi8-names-rejected */}
                {/* @ts-expect-error `label` is Pixi 8's name for Pixi 7's `name` */}
                <SpriteComponent label="sprite" />
                {/* @ts-expect-error Pixi 7 Graphics take a GraphicsGeometry, not Pixi 8's GraphicsContext `context` */}
                <GraphicsComponent context={{}} />
                {/* compat:end pixi8-names-rejected */}
            </>
        );
    };

    const Bridge = () =>
    {
        const ContextBridge = useContextBridge();

        return <ContextBridge><Child /></ContextBridge>;
    };

    const root: Root<Pixi7Types> = createRoot(document.createElement('div'), {
        onInit: (app: PixiApplication) => app.stage,
        rendererDestroyOptions: true,
        destroyOptions: { children: true, baseTexture: true },
    });
    const rendered: Promise<PixiApplication> = root.render(<Child />, { width: 1, height: 1 });
    const unmounted: Promise<void> = root.unmount();

    const tree = (
        <ContextBridgeProvider>
            <Application ref={appRef} width={10} resizeTo={null} onInit={(app: PixiApplication) => app.stage}>
                <Bridge />
            </Application>
        </ContextBridgeProvider>
    );
    // @ts-expect-error `preference` is a Pixi 8 renderer option
    const v8Option = <Application preference="webgl" />;
    const stage: Container | null = appRef.current?.getApplication()?.stage ?? null;

    return { tree, v8Option, rendered, unmounted, stage };
}
