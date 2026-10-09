import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as hostConfig from '../src/hostConfig';

import type { HostContainer } from '../src/host';
import type { PixiTypes } from '@pixi-react-provisional/core';

const require = createRequire(import.meta.url);
const ALIAS = 'react-reconciler';

/**
 * Host-config keys the installed bundle reads (`$$$hostConfig.<key>`). 0.29 ships a development build and a minified
 * production build; the production build reads a subset (no hydration warnings, no act warnings).
 */
function bundleKeys(): { development: string[]; production: string[] }
{
    const dir = dirname(require.resolve(`${ALIAS}/package.json`));
    const read = (file: string) => [
        ...new Set([...readFileSync(join(dir, 'cjs', file), 'utf8')
            .matchAll(/\$\$\$hostConfig\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])),
    ].sort();

    return {
        development: read('react-reconciler.development.js'),
        production: read('react-reconciler.production.min.js'),
    };
}

describe('host-config keys match the installed react-reconciler 0.29.2 bundle exactly', () =>
{
    const keys = bundleKeys();
    const implemented = Object.keys(hostConfig.createHostConfig()).sort();
    const unreachable = Object.keys(hostConfig.UNREACHABLE_HOST_KEYS).sort();

    it('depends on the pinned reconciler version', () =>
    {
        expect(require(`${ALIAS}/package.json`).version).toBe(hostConfig.RECONCILER_VERSION);
    });

    it('reads in production only keys the development build also reads', () =>
    {
        expect(keys.production.length).toBeGreaterThan(0);
        expect(keys.production.filter((key) => !keys.development.includes(key))).toEqual([]);
    });

    it('implements only keys the bundle reads (no hooks copied from a React 19 epoch)', () =>
    {
        expect(implemented.filter((key) => !keys.development.includes(key))).toEqual([]);
    });

    it('implements or explains every key the bundle reads, and never both', () =>
    {
        expect(keys.development.filter((key) => !implemented.includes(key) && !unreachable.includes(key))).toEqual([]);
        expect(unreachable.filter((key) => !keys.development.includes(key))).toEqual([]);
        expect(implemented.filter((key) => unreachable.includes(key))).toEqual([]);
    });

    it('builds one shared reconciler for every runtime of the package copy', () =>
    {
        expect(hostConfig.sharedReconciler()).toBe(hostConfig.sharedReconciler());
    });

    it('rejects a node no runtime created', () =>
    {
        expect(() => hostConfig.createHostConfig().appendChild({}, {})).toThrow(/not owned/);
    });

    it('forgets a deleted node, so a retained instance does not keep its runtime alive', () =>
    {
        const config = hostConfig.createHostConfig();
        const node = {};
        const record = { pixi: { create: () => node, publicInstance: (instance: unknown) => instance } };
        const runtime = { nodeInfo: (instance: unknown) => (instance === node ? { root: record } : undefined) };
        const container = { record, runtime } as unknown as HostContainer<PixiTypes>;

        config.createInstance('pixiContainer', {}, container, null as never, null as never);

        expect(config.getPublicInstance(node)).toBe(node);

        config.detachDeletedInstance(node);

        expect(() => config.getPublicInstance(node)).toThrow(/not owned/);
    });

    it('uses the React 18 shapes, not the React 19 ones', () =>
    {
        expect(implemented).toEqual(expect.arrayContaining(['getCurrentEventPriority', 'prepareUpdate', 'commitUpdate']));

        for (const react19Key of [
            'resolveUpdatePriority',
            'setCurrentUpdatePriority',
            'getCurrentUpdatePriority',
            'maySuspendCommit',
            'HostTransitionContext',
            'NotPendingTransition',
            'rendererPackageName',
        ])
        {
            expect(implemented, react19Key).not.toContain(react19Key);
            expect(keys.development, react19Key).not.toContain(react19Key);
        }
    });
});

describe('payload-based updates', () =>
{
    it('prepareUpdate reports a change only for scene props, never for children alone', () =>
    {
        const draw = () => undefined;

        expect(hostConfig.prepareUpdate({ x: 1, children: 'a' }, { x: 1, children: 'b' })).toBeNull();
        expect(hostConfig.prepareUpdate({ x: 1 }, { x: 2 })).toBe(hostConfig.UPDATE_PAYLOAD);
        expect(hostConfig.prepareUpdate({ x: 1 }, {})).toBe(hostConfig.UPDATE_PAYLOAD);
        expect(hostConfig.prepareUpdate({}, { x: undefined })).toBe(hostConfig.UPDATE_PAYLOAD);
        expect(hostConfig.prepareUpdate({ draw }, { draw })).toBeNull();
        expect(hostConfig.prepareUpdate({ draw }, { draw: () => undefined })).toBe(hostConfig.UPDATE_PAYLOAD);
        expect(hostConfig.prepareUpdate({ x: Number.NaN }, { x: Number.NaN })).toBeNull();
    });

    it('commitUpdate forwards previous and next props (not the payload) to the scene', () =>
    {
        const updates: unknown[] = [];
        const node = {};
        const record = { pixi: { create: () => node, update: (...args: unknown[]) => updates.push(args) } };
        const runtime = { nodeInfo: (target: unknown) => (target === node ? { root: record } : undefined) };
        const container = { runtime, record } as unknown as HostContainer<PixiTypes>;
        const config = hostConfig.createHostConfig();

        expect(config.createInstance('pixiContainer', {}, container, {}, null)).toBe(node);
        config.commitUpdate(node, hostConfig.UPDATE_PAYLOAD, 'pixiContainer', { x: 1 }, { x: 2 }, null);

        expect(updates).toEqual([[node, { x: 1 }, { x: 2 }]]);
    });
});

describe('event priority (getCurrentEventPriority)', () =>
{
    const withEvent = (type: string | undefined, read: () => number) =>
    {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'event');

        Object.defineProperty(window, 'event', { configurable: true, get: () => (type ? { type } : undefined) });

        try
        {
            return read();
        }
        finally
        {
            if (descriptor)
            {
                Object.defineProperty(window, 'event', descriptor);
            }
            else
            {
                delete (window as { event?: unknown }).event;
            }
        }
    };

    it('maps discrete and continuous DOM events to the 0.29 lanes, and defaults otherwise', () =>
    {
        expect(withEvent('pointerdown', hostConfig.getCurrentEventPriority)).toBe(1);
        expect(withEvent('click', hostConfig.getCurrentEventPriority)).toBe(1);
        expect(withEvent('pointermove', hostConfig.getCurrentEventPriority)).toBe(4);
        expect(withEvent('wheel', hostConfig.getCurrentEventPriority)).toBe(4);
        expect(withEvent('message', hostConfig.getCurrentEventPriority)).toBe(16);
        expect(withEvent(undefined, hostConfig.getCurrentEventPriority)).toBe(16);
    });

    it('uses the constants of the reconciler it depends on', () =>
    {
        const constants = require(`${ALIAS}/constants`);

        expect([constants.DiscreteEventPriority, constants.ContinuousEventPriority, constants.DefaultEventPriority])
            .toEqual([1, 4, 16]);
        expect(constants.ConcurrentRoot).toBe(1);
    });
});
