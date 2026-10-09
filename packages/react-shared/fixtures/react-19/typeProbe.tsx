/**
 * Compile-only consumer probe, typechecked by every fixture against its own @types/react line: the bindings infer
 * the composed Pixi adapter's types from the adapter instances, with no explicit type arguments. Never executed.
 */
import { createRef } from 'react';
import {
    type FakeApplication,
    type FakeContainer,
    type FakeSprite,
    type FakeTicker,
} from '@pixi-react-provisional/conformance/fake-pixi';
import { FakePixiAdapter, type FakePixiTypes } from '@pixi-react-provisional/conformance/fake-pixi-adapter';
import { React19Adapter } from '@pixi-react-provisional/react-19-under-test';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { ApplicationRef, Root } from '@pixi-react-provisional/react-19-under-test';

export function probe(Sprite: typeof FakeSprite)
{
    const renderer = createRenderer({ react: new React19Adapter(), pixi: new FakePixiAdapter() });
    const { Application, createRoot, useApplication, useTick, component, useContextBridge, ContextBridgeProvider } = renderer;

    const SpriteComponent = component(Sprite);
    const spriteRef = createRef<FakeSprite>();
    const appRef = createRef<ApplicationRef<FakeApplication>>();

    const Child = () =>
    {
        const app: FakeApplication = useApplication().app;

        useTick((ticker) =>
        {
            const typed: FakeTicker = ticker;

            void typed;
        });
        useTick({
            callback(this: { n: number }, ticker: FakeTicker)
            {
                ticker.update(this.n);
            },
            context: { n: 1 },
            priority: 1,
        });

        // @ts-expect-error the tick argument is the scene's ticker, not a number
        useTick((delta: number) => delta);

        void app;

        return <SpriteComponent ref={spriteRef} />;
    };

    const Bridge = () =>
    {
        const ContextBridge = useContextBridge();

        return <ContextBridge><Child /></ContextBridge>;
    };

    const root: Root<FakePixiTypes> = createRoot(
        document.createElement('div'),
        {
            onInit: (app: FakeApplication) => app.stage,
            onUncaughtError: (_error, info) => info.componentStack,
            destroyOptions: { children: true },
        },
    );
    const rendered: Promise<FakeApplication> = root.render(<Child />, { width: 1, height: 1 });
    const unmounted: Promise<void> = root.unmount();

    const tree = (
        <ContextBridgeProvider>
            <Application ref={appRef} width={10} resizeTo={null} onInit={(app: FakeApplication) => app.stage}>
                <Bridge />
            </Application>
        </ContextBridgeProvider>
    );
    const container: FakeContainer | null = appRef.current?.getApplication()?.stage ?? null;

    return { tree, rendered, unmounted, container };
}
