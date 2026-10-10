/**
 * Harness for the Pixi-specific browser tests: a fresh composition (real Pixi7Adapter, fake React 19
 * adapter) and the conformance scenario context that drives it, torn down after each test.
 */
import { afterEach } from 'vitest';
import { createPixi7Composition } from '../binding';
import { createScenarioContext } from '@pixi-react-provisional/conformance';

import type { ComponentType } from 'react';
import type { Pixi7AdapterOptions } from '../../../src/index';

const active: Array<() => Promise<void>> = [];

afterEach(async () =>
{
    for (const cleanup of active.splice(0).reverse())
    {
        await cleanup();
    }
});

export function setup(options: Pixi7AdapterOptions = {})
{
    const composition = createPixi7Composition(options);
    const handle = createScenarioContext(composition);

    active.push(async () =>
    {
        try
        {
            await handle.cleanup();
        }
        finally
        {
            await composition.dispose();
        }
    });

    return { ...handle.context, renderer: composition.renderer, adapter: composition.adapter };
}

export type Harness = ReturnType<typeof setup>;

/** An element type for a registered catalog name. Props are untyped here: typed JSX is the ./jsx entries. */
export function element(name: string): ComponentType<any>
{
    return name as unknown as ComponentType<any>;
}
