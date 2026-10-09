import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPOCHS } from './epochs';

import type { Runtime, SceneTypes } from '@pixi-react-provisional/core';

const require = createRequire(import.meta.url);

/** Host-config keys the installed bundle reads (`$$$config.<key>`), in its development and production builds. */
function bundleKeys(alias: string): { development: string[]; production: string[] }
{
    const dir = dirname(require.resolve(`${alias}/package.json`));
    const read = (build: string) => [
        ...new Set([...readFileSync(join(dir, 'cjs', `react-reconciler.${build}.js`), 'utf8')
            .matchAll(/\$\$\$config\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])),
    ].sort();

    return { development: read('development'), production: read('production') };
}

/** The host config is a pure object: building it calls nothing on the runtime. */
const runtime = {} as Runtime<SceneTypes>;

describe('host-config keys match each installed reconciler bundle exactly', () =>
{
    for (const { epoch, alias, hostConfig } of EPOCHS)
    {
        describe(`${epoch} (${alias})`, () =>
        {
            const keys = bundleKeys(alias);
            const implemented = Object.keys(hostConfig.createHostConfig(runtime)).sort();
            const unreachable = Object.keys(hostConfig.UNREACHABLE_HOST_KEYS).sort();

            it('bundles the pinned reconciler version', () =>
            {
                expect(require(`${alias}/package.json`).version).toBe(hostConfig.RECONCILER_VERSION);
            });

            it('reads the same keys in development and production', () =>
            {
                expect(keys.production).toEqual(keys.development);
            });

            it('implements only keys the bundle reads (no copied hooks from another epoch)', () =>
            {
                expect(implemented.filter((key) => !keys.development.includes(key))).toEqual([]);
            });

            it('implements or explains every key the bundle reads, and never both', () =>
            {
                expect(keys.development.filter((key) => !implemented.includes(key) && !unreachable.includes(key))).toEqual([]);
                expect(unreachable.filter((key) => !keys.development.includes(key))).toEqual([]);
                expect(implemented.filter((key) => unreachable.includes(key))).toEqual([]);
            });
        });
    }

    it('drops the hooks 0.32 stopped reading and adds the 0.33 suspension and instrumentation hooks', () =>
    {
        const keysOf = (index: number) => Object.keys(EPOCHS[index].hostConfig.createHostConfig(runtime));

        expect(EPOCHS[0].hostConfig.UNREACHABLE_HOST_KEYS).toHaveProperty('afterActiveInstanceBlur');
        expect(EPOCHS[1].hostConfig.UNREACHABLE_HOST_KEYS).not.toHaveProperty('afterActiveInstanceBlur');
        expect(keysOf(0)).not.toContain('trackSchedulerEvent');
        expect(keysOf(1)).toContain('trackSchedulerEvent');
        expect(keysOf(1)).not.toContain('getSuspendedCommitReason');
        expect(keysOf(2)).toEqual(expect.arrayContaining(['getSuspendedCommitReason', 'maySuspendCommitOnUpdate', 'resolveEventType']));
        expect(keysOf(2)).not.toContain('measureInstance');
        expect(keysOf(3)).toEqual(expect.arrayContaining(['measureInstance', 'wasInstanceInViewport', 'startViewTransition']));
    });
});
