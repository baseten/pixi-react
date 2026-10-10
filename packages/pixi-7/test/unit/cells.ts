/** The three pixi.js 7 versions the unit tests bind, side by side in one process: the floor, 7.4.2 and the newest. */
import * as base from 'pixi.js';
import * as current from 'pixi.js-current';
import * as floor from 'pixi.js-floor';
import { bindPixi } from '../../src/bind';

import type { PixiModule } from '../../src/pixi';

export const cells = [
    { version: '7.2.0', pixi: floor as unknown as PixiModule },
    { version: '7.4.2', pixi: base as unknown as PixiModule },
    { version: '7.4.3', pixi: current as unknown as PixiModule },
] as const;

/** The adapter class bound to `pixi`, as each package entry would bind it. */
export function adapterFor(pixi: PixiModule)
{
    return bindPixi(pixi).Pixi7Adapter;
}
