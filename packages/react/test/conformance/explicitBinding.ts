import { appOptions } from './facadeBinding';
import { createPixi8Probe } from './pixiProbe';
import { PIXI8_SCENE_CAPABILITIES } from '@pixi-react-provisional/conformance';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { React19Adapter } from '@pixi-react-provisional/react-19.3';
import { createRenderer } from '@pixi-react-provisional/renderer';

import type { Composition, ConformanceBinding, PixiElement, ReactBindingApi } from '@pixi-react-provisional/conformance';

/**
 * The explicit-factory binding: the same pair the facade composes, `createRenderer({ react: new React19Adapter(),
 * pixi: new Pixi8Adapter() })`, without the facade's parity shims. Every scenario gets a fresh runtime. It does not
 * provide `parity.upstream`: the modular packages ship the corrected global and registry behaviour (D4).
 */
export const explicitBinding: ConformanceBinding = {
    id: 'createRenderer: React19Adapter (19.3) + Pixi8Adapter',
    capabilities: ['react.19', 'pixi.globals', 'dom.resize', 'pixi.filter-children', ...PIXI8_SCENE_CAPABILITIES],
    expectedFailures: {},
    create(): Composition
    {
        let roots = () => 0;
        const probe = createPixi8Probe(() => roots());
        const renderer = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });
        const element = (name: string) => `pixi${name}` as unknown as PixiElement;

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
