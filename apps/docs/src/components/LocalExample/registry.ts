/**
 * The examples the docs embed, from the example app's own files (apps/examples, issue 18): the code tabs show these
 * sources (without the test-harness lines) and the live preview runs these modules, built against the workspace
 * @pixi/react. apps/examples/test/catalog.test.mjs checks that this list matches the catalog's `docs` entries.
 */
import { type ComponentType } from 'react';
import BasicScene from '!!raw-loader!@pixi-react-provisional/examples/src/examples/basic-scene/BasicScene.tsx';
import CustomComponents from '!!raw-loader!@pixi-react-provisional/examples/src/examples/custom-components/CustomComponents.tsx';
import Star from '!!raw-loader!@pixi-react-provisional/examples/src/examples/custom-components/Star.ts';
import HooksAndTicker from '!!raw-loader!@pixi-react-provisional/examples/src/examples/hooks-and-ticker/HooksAndTicker.tsx';
import InitAndUnmount from '!!raw-loader!@pixi-react-provisional/examples/src/examples/init-and-unmount/InitAndUnmount.tsx';
import UpdatesAndEvents from '!!raw-loader!@pixi-react-provisional/examples/src/examples/updates-and-events/UpdatesAndEvents.tsx';
import catalog from '@pixi-react-provisional/examples/catalog.json';

type Loader = () => Promise<{ default: ComponentType }>;

export interface LocalExampleEntry
{
    id: string;
    title: string;
    summary: string;
    /** Paths relative to apps/examples/src/examples, with their source. */
    files: { path: string; code: string }[];
    load: Loader;
}

const sources: Record<string, string> = {
    'basic-scene/BasicScene.tsx': BasicScene,
    'custom-components/CustomComponents.tsx': CustomComponents,
    'custom-components/Star.ts': Star,
    'hooks-and-ticker/HooksAndTicker.tsx': HooksAndTicker,
    'init-and-unmount/InitAndUnmount.tsx': InitAndUnmount,
    'updates-and-events/UpdatesAndEvents.tsx': UpdatesAndEvents,
};

const loaders: Record<string, Loader> = {
    'basic-scene': () => import('@pixi-react-provisional/examples/src/examples/basic-scene/BasicScene.tsx'),
    'custom-components': () => import('@pixi-react-provisional/examples/src/examples/custom-components/CustomComponents.tsx'),
    'hooks-and-ticker': () => import('@pixi-react-provisional/examples/src/examples/hooks-and-ticker/HooksAndTicker.tsx'),
    'init-and-unmount': () => import('@pixi-react-provisional/examples/src/examples/init-and-unmount/InitAndUnmount.tsx'),
    'updates-and-events': () => import('@pixi-react-provisional/examples/src/examples/updates-and-events/UpdatesAndEvents.tsx'),
};

export const localExamples: Record<string, LocalExampleEntry> = Object.fromEntries(catalog.examples
    .filter((example) => example.docs)
    .map((example) => [example.id, {
        id: example.id,
        title: example.title,
        summary: example.summary,
        files: example.files.map((path) => ({ path, code: sources[path] })),
        load: loaders[example.id],
    }]));
