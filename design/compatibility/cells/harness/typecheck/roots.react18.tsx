/** React 18 roots: recoverable errors are reported; the React 19 root error callbacks are type errors. */
import { PixiAdapterClass, ReactAdapterClass } from './adapter';
import { createRenderer } from '@pixi-react-provisional/renderer';

export function roots()
{
    const { createRoot } = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });

    createRoot(document.createElement('div'), { onRecoverableError: (_error, info) => info.componentStack });

    // @ts-expect-error onCaughtError is a React 19 root option; React 18 roots reject it
    createRoot(document.createElement('div'), { onCaughtError: () => undefined });

    // @ts-expect-error onUncaughtError is a React 19 root option; React 18 roots reject it
    createRoot(document.createElement('div'), { onUncaughtError: () => undefined });
}
