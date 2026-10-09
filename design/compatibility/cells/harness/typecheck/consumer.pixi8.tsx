/**
 * Compile-only declaration consumer, typechecked against the cell's own @types/react, pixi.js and the PACKED
 * adapters' published declarations (ESM `import` condition, Bundler resolution). Never executed. The factory must
 * infer the Pixi 8 types through the React bindings from the adapter instances alone.
 */
import { type Application as PixiApplication, type Container, Sprite, type Ticker } from 'pixi.js';
import { createRef } from 'react';
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { ApplicationRef, Root } from '%REACT_SPEC%';
import type { Pixi8Types } from '%PIXI_SPEC%';

export function probe()
{
    const renderer = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });
    const { Application, createRoot, useApplication, useTick, component, useContextBridge, ContextBridgeProvider } = renderer;

    const SpriteComponent = component(Sprite);
    const spriteRef = createRef<Sprite>();
    const appRef = createRef<ApplicationRef<PixiApplication>>();

    const Child = () =>
    {
        const app: PixiApplication = useApplication().app;

        useTick((ticker) =>
        {
            const typed: Ticker = ticker;

            void typed;
        });

        // @ts-expect-error the tick argument is Pixi 8's Ticker, not a number
        useTick((delta: number) => delta);

        void app;

        return <SpriteComponent ref={spriteRef} x={1} />;
    };

    const Bridge = () =>
    {
        const ContextBridge = useContextBridge();

        return <ContextBridge><Child /></ContextBridge>;
    };

    const root: Root<Pixi8Types> = createRoot(document.createElement('div'), {
        onInit: (app: PixiApplication) => app.stage,
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
    const stage: Container | null = appRef.current?.getApplication()?.stage ?? null;

    return { tree, rendered, unmounted, stage };
}
