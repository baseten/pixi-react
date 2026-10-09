import { describe, expect, it } from 'vitest';
import { PixiJournal } from '../src/journal';
import { runExpectedFailure, runScenario, ScenarioErrors, validateBinding } from '../src/runner';
import { defineScenario } from '../src/scenario';

import type { Composition, ConformanceBinding } from '../src/binding';

/** A composition stub: enough for scenarios that do not render. */
function stubComposition(onDispose: () => void = () => undefined): Composition
{
    return {
        api: {} as Composition['api'],
        elements: {} as Composition['elements'],
        elementFor: () => (() => null),
        probe: { journal: new PixiJournal() } as Composition['probe'],
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

    it('reports teardown failures together with a scenario failure', async () =>
    {
        const faulty = binding({
            create: () => stubComposition(() =>
            {
                throw new Error('teardown fault');
            }),
        });
        const error = await runScenario(faulty, failing).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ScenarioErrors);
        expect((error as ScenarioErrors).errors.map((e) => (e as Error).message))
            .toEqual(['known defect: value was 0', 'teardown fault']);
    });

    it('never accepts an unrelated teardown failure as the recorded defect', async () =>
    {
        const faulty = binding({
            create: () => stubComposition(() =>
            {
                throw new Error('teardown fault');
            }),
        });

        await expect(runExpectedFailure(faulty, failing, { reason: 'r', match: /value was 0/ }))
            .rejects.toBeInstanceOf(ScenarioErrors);
        // A defect that shows up in both the scenario and its teardown is still accepted.
        await expect(runExpectedFailure(faulty, failing, { reason: 'r', match: /value was 0|teardown fault/ }))
            .resolves.toBeUndefined();
    });

    it('matches each nested teardown failure on its own', async () =>
    {
        // context.cleanup() reports several failures as one AggregateError; each must match individually.
        const nested = binding({
            create: () => stubComposition(() =>
            {
                throw new AggregateError([new Error('value was 0 again'), new Error('unrelated leak')], 'cleanup failed');
            }),
        });
        const error = await runScenario(nested, failing).catch((e: unknown) => e);

        expect((error as ScenarioErrors).errors.map((e) => (e as Error).message))
            .toEqual(['known defect: value was 0', 'value was 0 again', 'unrelated leak']);
        await expect(runExpectedFailure(nested, failing, { reason: 'r', match: /value was 0/ }))
            .rejects.toBeInstanceOf(ScenarioErrors);
        await expect(runExpectedFailure(nested, passing, { reason: 'r', match: /value was 0/ }))
            .rejects.toBeInstanceOf(ScenarioErrors);
    });

    it('validates expected failures against the whole catalogue when running a subset', () =>
    {
        const known = binding({ expectedFailures: { 'elements.mount': { reason: 'r', match: /x/ } } });

        // describeConformance validates with the default (full) catalogue, whatever subset it then runs.
        expect(() => validateBinding(known)).not.toThrow();
        expect(() => validateBinding(binding({ expectedFailures: { 'no.such': { reason: 'r', match: /x/ } } })))
            .toThrow(/unknown scenario "no.such"/);
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
