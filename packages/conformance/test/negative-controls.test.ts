import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/runner';
import { scenarios } from '../src/scenarios';
import { createFakeBinding } from './fake-binding/binding';

import type { FakeRuntimeFaults } from './fake-binding/runtime';

const byId = (id: string) =>
{
    const scenario = scenarios.find((candidate) => candidate.id === id);

    if (!scenario)
    {
        throw new Error(`unknown scenario ${id}`);
    }

    return scenario;
};

/**
 * Each fault reproduces a real regression in an otherwise passing binding. The listed scenarios must pass
 * against the clean fake binding and fail against the faulty one, with an assertion about the fault.
 */
const controls: Array<{ fault: keyof FakeRuntimeFaults; scenarios: Record<string, RegExp> }> = [
    {
        fault: 'skipEventCleanup',
        scenarios: { 'events.remove': /handler calls/ },
    },
    {
        fault: 'doubleDestroy',
        scenarios: {
            'elements.remove': /destroy count of removed node: expected 2 to be 1/,
            'destruction.once': /destroy count of .*: expected 2 to be 1/,
            'destruction.nested': /destroy count per node/,
            'resources.texture-borrowed': /sprite destroy count: expected 2 to be 1/,
        },
    },
    {
        fault: 'leakInitRejection',
        scenarios: { 'Application.init.failure-no-unhandled-rejection': /unhandled rejections/ },
    },
    {
        fault: 'skipTickerCleanup',
        scenarios: {
            'useTick.unmount-cleanup': /calls: expected 2 to be 1/,
            'useTick.replace-callback': /calls/,
        },
    },
];

describe('negative controls', () =>
{
    for (const { fault, scenarios: expected } of controls)
    {
        describe(fault, () =>
        {
            for (const [id, failure] of Object.entries(expected))
            {
                it(`${id} passes on the clean binding and catches the fault`, async () =>
                {
                    await runScenario(createFakeBinding(), byId(id));
                    await expect(runScenario(createFakeBinding({ [fault]: true }), byId(id))).rejects.toThrow(failure);
                });
            }
        });
    }
});
