import { describe, it } from 'vitest';
import { createScenarioContext } from './context';
import { scenarios as allScenarios } from './scenarios';

import type { Capability, ConformanceBinding, ExpectedFailure } from './binding';
import type { Scenario } from './scenario';

/** Capabilities a scenario needs that the binding does not provide. */
export function missingCapabilities(binding: ConformanceBinding, scenario: Scenario): Capability[]
{
    return scenario.requires.filter((capability) => !binding.capabilities.includes(capability));
}

/**
 * Builds a fresh composition, runs one scenario against it, then disposes everything. An exception during
 * cleanup or disposal fails the scenario: a renderer that throws while tearing down does not conform.
 */
export async function runScenario(binding: ConformanceBinding, scenario: Scenario): Promise<void>
{
    const composition = await binding.create();
    const handle = createScenarioContext(composition);
    let failure: unknown;
    let failed = false;

    try
    {
        await scenario.run(handle.context);
    }
    catch (error)
    {
        failure = error;
        failed = true;
    }

    const teardownErrors: unknown[] = [];

    try
    {
        await handle.cleanup();
    }
    catch (error)
    {
        teardownErrors.push(error);
    }

    try
    {
        await composition.dispose();
    }
    catch (error)
    {
        teardownErrors.push(error);
    }

    if (failed)
    {
        throw failure;
    }

    if (teardownErrors.length)
    {
        throw teardownErrors.length === 1
            ? teardownErrors[0]
            : new AggregateError(teardownErrors, `Teardown of ${scenario.id} failed`);
    }
}

/** Throws if the binding's expected-failure table names unknown scenarios or omits a reason. */
export function validateBinding(binding: ConformanceBinding, scenarios: readonly Scenario[] = allScenarios): void
{
    const ids = new Set(scenarios.map((scenario) => scenario.id));

    for (const [id, expected] of Object.entries(binding.expectedFailures ?? {}))
    {
        if (!ids.has(id))
        {
            throw new Error(`Binding ${binding.id} lists an expected failure for unknown scenario "${id}".`);
        }

        if (!expected.reason.trim())
        {
            throw new Error(`Binding ${binding.id} lists expected failure "${id}" without a reason.`);
        }
    }
}

function messageOf(error: unknown): string
{
    if (error instanceof AggregateError)
    {
        return [error.message, ...error.errors.map(messageOf)].join('\n');
    }

    return error instanceof Error ? error.message : String(error);
}

/**
 * Runs an expected failure. It must throw an error matching `expected.match`. If it passes, the defect is
 * fixed (or the scenario was weakened) and the entry must be removed, so the test fails loudly. If it throws
 * something else, the scenario broke for a different reason and the test fails with that error.
 */
export async function runExpectedFailure(
    binding: ConformanceBinding,
    scenario: Scenario,
    expected: ExpectedFailure,
): Promise<void>
{
    try
    {
        await runScenario(binding, scenario);
    }
    catch (error)
    {
        if (expected.match.test(messageOf(error)))
        {
            return;
        }

        throw error;
    }

    throw new Error(
        `Scenario ${scenario.id} passed against ${binding.id} but is listed as an expected failure `
        + `("${expected.reason}"). Remove the entry from the binding's expectedFailures.`,
    );
}

export interface DescribeConformanceOptions
{
    scenarios?: readonly Scenario[];
    /** Per-scenario test timeout in milliseconds. */
    timeout?: number;
}

/**
 * Registers the conformance suite for `binding` with Vitest. Scenarios whose capabilities the binding lacks
 * are registered as skipped, with the missing capability IDs in the title.
 */
export function describeConformance(binding: ConformanceBinding, options: DescribeConformanceOptions = {}): void
{
    const scenarios = options.scenarios ?? allScenarios;
    const expectedFailures = binding.expectedFailures ?? {};

    validateBinding(binding, scenarios);

    describe(`conformance: ${binding.id}`, () =>
    {
        for (const scenario of scenarios)
        {
            const title = `${scenario.id}: ${scenario.title}`;
            const missing = missingCapabilities(binding, scenario);
            const expected = expectedFailures[scenario.id];

            if (missing.length)
            {
                const pending = scenario.pendingOn ? `; runs once ${scenario.pendingOn} provides a binding` : '';

                it.skip(`${title} [requires ${missing.join(', ')}${pending}]`, () => undefined);
            }
            else if (expected)
            {
                it(
                    `${title} [expected failure: ${expected.reason}]`,
                    () => runExpectedFailure(binding, scenario, expected),
                    options.timeout,
                );
            }
            else
            {
                it(title, () => runScenario(binding, scenario), options.timeout);
            }
        }
    });
}
