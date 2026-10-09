import { type ComponentType, lazy, type LazyExoticComponent } from 'react';
import catalog from './catalog.json';

export interface ExampleEntry
{
    id: string;
    title: string;
    summary: string;
    composition: 'facade' | 'createRenderer';
    files: string[];
    docs: boolean;
    fixtures: string[];
}

export const examples = catalog.examples as ExampleEntry[];

/** One lazily loaded module per route, so each page loads only its own example. Keys must match catalog.json. */
export const components: Record<string, LazyExoticComponent<ComponentType>> = {
    'basic-scene': lazy(() => import('./examples/basic-scene/BasicScene')),
    'updates-and-events': lazy(() => import('./examples/updates-and-events/UpdatesAndEvents')),
    'custom-components': lazy(() => import('./examples/custom-components/CustomComponents')),
    'hooks-and-ticker': lazy(() => import('./examples/hooks-and-ticker/HooksAndTicker')),
    'init-and-unmount': lazy(() => import('./examples/init-and-unmount/InitAndUnmount')),
    'modular-renderer': lazy(() => import('./examples/modular-renderer/ModularRenderer')),
};
