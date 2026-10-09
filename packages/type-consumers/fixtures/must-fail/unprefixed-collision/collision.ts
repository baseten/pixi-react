import { Filter, Text } from 'pixi.js';

import type { UnprefixedPixiElements } from '@pixi-react-provisional/pixi-8/jsx';
import type {} from 'react';

type Registered = { Text: typeof Text; Filter: typeof Filter };

declare module '@pixi-react-provisional/pixi-8/jsx'
{
    interface PixiCatalog extends Registered {}
}

declare module 'react'
{
    namespace JSX
    {
        interface IntrinsicElements extends UnprefixedPixiElements {}
    }
}
