import { appOptions } from './facadeBinding';
import { createPixiProbe } from './pixiProbe';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { React19Adapter } from '@pixi-react-provisional/react-19/19.3';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Composition, ConformanceBinding, ReactBindingApi, SceneElement } from '@pixi-react-provisional/conformance';

/**
 * The explicit-factory binding: the same pair the facade composes, `createRenderer({ framework: new React19Adapter(),
 * scene: new Pixi8Adapter() })`, without the facade's parity shims. Every scenario gets a fresh runtime. It does not
 * provide `parity.upstream`: the modular packages ship the corrected global and registry behaviour (D4).
 */
export const explicitBinding: ConformanceBinding = {
    id: 'createRenderer: React19Adapter (19.3) + Pixi8Adapter',
    capabilities: ['framework.react-19', 'scene.globals', 'dom.resize'],
    expectedFailures: {},
    create(): Composition
    {
        let roots = () => 0;
        const probe = createPixiProbe(() => roots());
        const renderer = createRenderer({ framework: new React19Adapter(), scene: new Pixi8Adapter() });
        const element = (name: string) => `pixi${name}` as unknown as SceneElement;

        roots = () => renderer.runtime.roots().length;
        renderer.extend(probe.catalog);

        return {
            api: renderer as unknown as ReactBindingApi,
            elements: {
                container: element('Container'),
                sprite: element('Sprite'),
                graphics: element('Graphics'),
                text: element('Text'),
            },
            elementFor: element,
            probe,
            appOptions,
            async dispose()
            {
                try
                {
                    await renderer.runtime.dispose();
                }
                finally
                {
                    probe.restore();
                }
            },
        };
    },
};
