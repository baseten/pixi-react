/**
 * Compile-only probe of the RUNTIME-adjacent types, typechecked by each fixture against its own @types/react 18
 * and the packed packages' published declarations. Never executed. It checks that the version-neutral factory infers
 * the Pixi 8 types through the React 18 bindings from the adapter instances alone, and that React 19-only root
 * options are type errors. Element typing uses `component(Ctor)` (local typed components); global React 18 JSX tags
 * are issue 11's entrypoint and its consumer type suite, which replaces any tag typing here.
 */
import { type Application as PixiApplication, type Container, Sprite, type Ticker } from 'pixi.js';
import { createRef } from 'react';
import { Pixi8Adapter, type Pixi8Types } from '@pixi-react-provisional/pixi-8';
import { React18Adapter } from '@pixi-react-provisional/react-18';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { ApplicationRef, Root } from '@pixi-react-provisional/react-18';

export function probe()
{
    const renderer = createRenderer({ react: new React18Adapter(), pixi: new Pixi8Adapter() });
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
        onRecoverableError: (_error, info) => info.componentStack,
    });

    // @ts-expect-error onCaughtError is a React 19 root option; React 18 roots reject it
    createRoot(document.createElement('div'), { onCaughtError: () => undefined });

    // @ts-expect-error onUncaughtError is a React 19 root option; React 18 roots reject it
    createRoot(document.createElement('div'), { onUncaughtError: () => undefined });

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
