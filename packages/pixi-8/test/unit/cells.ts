/** The three pixi.js versions the unit tests bind, side by side in one process. */
import * as floor from 'pixi.js';
import * as mid from 'pixi.js-8.9';
import * as current from 'pixi.js-current';
import { bindPixi } from '../../src/bind';

import type { PixiModule } from '../../src/pixi';

export const cells = [
    { version: '8.2.6', pixi: floor as unknown as PixiModule },
    { version: '8.9.2', pixi: mid as unknown as PixiModule },
    { version: '8.22.0', pixi: current as unknown as PixiModule },
] as const;

export const withParticles = cells.filter((cell) => typeof cell.pixi.Particle === 'function');

/** The adapter class bound to `pixi`, as each package entry would bind it. */
export function adapterFor(pixi: PixiModule)
{
    return bindPixi(pixi).Pixi8Adapter;
}
