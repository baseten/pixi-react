// Two global JSX surfaces in one program: the facade's all-constructors `PixiElements` and the modular entry's
// registered catalogue declare the same tags with different prop types.
import { Sprite } from 'pixi.js';

import type {} from '@pixi/react';
import type {} from '@pixi-react-provisional/pixi-8/jsx/react-19';

type Registered = { Sprite: typeof Sprite };

declare module '@pixi-react-provisional/pixi-8/jsx'
{
    interface PixiCatalog extends Registered {}
}
