import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPOCHS } from './epochs';

import type { EpochRootCallbacks, HostContainer } from '../src/shared/host';
import type { SceneTypes } from '@pixi-react-provisional/core';

const require = createRequire(import.meta.url);

/** The `createContainer` parameter names of the installed bundle (1-indexed argument N is entry N-1). */
function installedParameters(alias: string): string[]
{
    const file = join(dirname(require.resolve(`${alias}/package.json`)), 'cjs', 'react-reconciler.production.js');
    const match = (/exports\.createContainer = function \(([^)]*)\)/).exec(readFileSync(file, 'utf8'));

    return match![1].split(',').map((name) => name.trim()).filter(Boolean);
}

/** Records the arguments a root factory passes to `createContainer`. */
function recordArguments(createContainer: (typeof EPOCHS)[number]['hostConfig']['createContainer']): unknown[]
{
    let recorded: unknown[] = [];
    const reconciler = {
        createContainer: (...args: unknown[]) =>
        {
            recorded = args;

            return {} as never;
        },
    };
    const callbacks: EpochRootCallbacks = {
        onUncaughtError: () => undefined,
        onCaughtError: () => undefined,
        onRecoverableError: () => undefined,
    };

    createContainer(reconciler as never, {} as HostContainer<SceneTypes>, callbacks, 'prefix');

    return recorded;
}

/** The 0.33/0.34 contract for argument 10. Fails for the 19.0/19.1 shape, which passes `null` there. */
function expectIndicatorArgument(args: unknown[], indicator: unknown): void
{
    expect(args, 'argument count').toHaveLength(10);
    expect(typeof args[9], 'argument 10 is a function').toBe('function');
    expect(args[9], 'argument 10 is the epoch\'s default-transition-indicator handler').toBe(indicator);
}

describe('createContainer argument shapes', () =>
{
    it('the installed bundles name argument 10 transitionCallbacks (0.31, 0.32) and onDefaultTransitionIndicator (0.33, 0.34)', () =>
    {
        expect(EPOCHS.map(({ alias }) => installedParameters(alias)[9])).toEqual([
            'transitionCallbacks',
            'transitionCallbacks',
            'onDefaultTransitionIndicator',
            'onDefaultTransitionIndicator',
        ]);

        for (const { alias } of EPOCHS)
        {
            expect(installedParameters(alias), alias).toHaveLength(10);
        }
    });

    for (const { epoch, hostConfig } of EPOCHS.slice(0, 2))
    {
        it(`${epoch} passes ten arguments with transitionCallbacks = null`, () =>
        {
            const args = recordArguments(hostConfig.createContainer);

            expect(args).toHaveLength(10);
            expect(args[1]).toBe(1); // ConcurrentRoot
            expect(args[5]).toBe('prefix');
            expect(args[9]).toBeNull();
        });
    }

    for (const { epoch, hostConfig } of EPOCHS.slice(2))
    {
        const indicator = (hostConfig as typeof EPOCHS[2]['hostConfig']).onDefaultTransitionIndicator;

        it(`${epoch} passes onDefaultTransitionIndicator as argument 10`, () =>
        {
            const args = recordArguments(hostConfig.createContainer);

            expect(args[1]).toBe(1);
            expect(args[6]).toEqual(expect.any(Function));
            expectIndicatorArgument(args, indicator);
            expect((indicator as () => unknown)()).toBeUndefined();
        });

        it(`${epoch} fails the argument-10 check if the 19.0 root factory were reused`, () =>
        {
            const reused = recordArguments(EPOCHS[0].hostConfig.createContainer);

            expect(() => expectIndicatorArgument(reused, indicator)).toThrow();
            expect(hostConfig.createContainer).not.toBe(EPOCHS[0].hostConfig.createContainer);
        });
    }
});
