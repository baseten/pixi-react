import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { React19Adapter } from '@pixi-react-provisional/react-19.3';
import { createRenderer } from '@pixi-react-provisional/renderer';

/**
 * The explicit composition: the renderer factory with the React 19.3 adapter and the Pixi 8 adapter. Create it once,
 * in a module of your own, and import the bindings from here instead of from @pixi/react. Each renderer is an
 * isolated runtime: its registry, roots and Applications are its own.
 *
 * The workspace names are provisional; the release maps them to the public names (see design/release.md).
 */
export const renderer = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });

export const {
    Application,
    component,
    useApplication,
    useTick,
} = renderer;
