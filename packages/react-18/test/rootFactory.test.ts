import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/hostConfig';

import type { HostContainer, RootCallbacks } from '../src/host';
import type { PixiTypes } from '@pixi-react-provisional/core';

const require = createRequire(import.meta.url);

/** The `createContainer` parameter names of the installed 0.29.2 development bundle. */
function installedParameters(): string[]
{
    const file = join(dirname(require.resolve('react-reconciler/package.json')), 'cjs', 'react-reconciler.development.js');
    const match = (/function createContainer\(([^)]*)\)/).exec(readFileSync(file, 'utf8'));

    return match![1].split(',').map((name) => name.trim()).filter(Boolean);
}

describe('createContainer (react-reconciler 0.29.2)', () =>
{
    it('the installed bundle takes eight arguments, the seventh being onRecoverableError', () =>
    {
        expect(installedParameters()).toEqual([
            'containerInfo',
            'tag',
            'hydrationCallbacks',
            'isStrictMode',
            'concurrentUpdatesByDefaultOverride',
            'identifierPrefix',
            'onRecoverableError',
            'transitionCallbacks',
        ]);
    });

    it('the root factory creates a ConcurrentRoot and routes onRecoverableError, not the React 19 callbacks', () =>
    {
        let recorded: unknown[] = [];
        const reconciler = {
            createContainer: (...args: unknown[]) =>
            {
                recorded = args;

                return {} as never;
            },
        };
        const callbacks: RootCallbacks = { onRecoverableError: () => undefined };

        createContainer(reconciler as never, {} as HostContainer<PixiTypes>, callbacks, 'prefix');

        expect(recorded).toHaveLength(8);
        expect(recorded[1]).toBe(1); // ConcurrentRoot
        expect(recorded[3]).toBe(false); // not a StrictMode root: StrictMode comes from the tree
        expect(recorded[5]).toBe('prefix');
        expect(recorded[6]).toBe(callbacks.onRecoverableError);
        expect(recorded[7]).toBeNull();
    });
});
