import { describe, expect, it } from 'vitest';
import { SceneJournal } from '../src/journal';
import { runExpectedFailure, runScenario, validateBinding } from '../src/runner';
import { defineScenario } from '../src/scenario';

import type { Composition, ConformanceBinding } from '../src/binding';

/** A composition stub: enough for scenarios that do not render. */
function stubComposition(onDispose: () => void = () => undefined): Composition
{
    return {
        api: {} as Composition['api'],
        elements: {} as Composition['elements'],
        elementFor: () => (() => null),
        probe: { journal: new SceneJournal() } as Composition['probe'],
        appOptions: {},
        dispose: onDispose,
    };
}

const binding = (overrides: Partial<ConformanceBinding> = {}): ConformanceBinding => ({
    id: 'stub',
    capabilities: [],
    create: () => stubComposition(),
    ...overrides,
});

const passing = defineScenario({
    id: 'stub.passes',
    feature: 'elements',
    title: 'passes',
    expected: 'passes',
    run: async () => undefined,
});

const failing = defineScenario({
    id: 'stub.fails',
    feature: 'elements',
    title: 'fails',
    expected: 'fails',
    run: async () =>
    {
        throw new Error('known defect: value was 0');
    },
});

describe('runner', () =>
{
    it('disposes the composition after every scenario, even a failing one', async () =>
    {
        let disposed = 0;
        const counting = binding({ create: () => stubComposition(() => { disposed += 1; }) });

        await runScenario(counting, passing);
        await expect(runScenario(counting, failing)).rejects.toThrow('known defect');
        expect(disposed).toBe(2);
    });

    it('fails a scenario whose teardown throws', async () =>
    {
        const faulty = binding({
            create: () => stubComposition(() =>
            {
                throw new Error('teardown fault');
            }),
        });

        await expect(runScenario(faulty, passing)).rejects.toThrow('teardown fault');
    });

    it('accepts an expected failure only when it fails with the recorded error', async () =>
    {
        await expect(runExpectedFailure(binding(), failing, { reason: 'r', match: /value was 0/ })).resolves.toBeUndefined();
        await expect(runExpectedFailure(binding(), failing, { reason: 'r', match: /something else/ }))
            .rejects.toThrow('known defect');
        await expect(runExpectedFailure(binding(), passing, { reason: 'r', match: /.*/ }))
            .rejects.toThrow(/passed .* but is listed as an expected failure/);
    });

    it('rejects expected-failure tables that name unknown scenarios or omit reasons', () =>
    {
        expect(() => validateBinding(binding({ expectedFailures: { 'no.such': { reason: 'x', match: /x/ } } }), [passing]))
            .toThrow(/unknown scenario "no.such"/);
        expect(() => validateBinding(binding({ expectedFailures: { 'stub.passes': { reason: ' ', match: /x/ } } }), [passing]))
            .toThrow(/without a reason/);
    });

    it('requires parity.upstream for parity scenarios', () =>
    {
        const parity = defineScenario({ ...passing, id: 'stub.parity', kind: 'parity' });

        expect(parity.requires).toContain('parity.upstream');
    });
});
