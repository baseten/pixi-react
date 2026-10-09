/** React 19 roots: all three root error callbacks are accepted. */
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import { createRenderer } from '@pixi-react-provisional/renderer';

export function roots()
{
    const { createRoot } = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });

    createRoot(document.createElement('div'), {
        onCaughtError: (_error, info) => info.componentStack,
        onUncaughtError: (_error, info) => info.componentStack,
        onRecoverableError: (_error, info) => info.componentStack,
    });
}
