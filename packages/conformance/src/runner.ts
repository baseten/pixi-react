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

/** Expands teardown errors, including the aggregate `context.cleanup()` throws, into their individual leaves. */
function teardownLeaves(error: unknown): unknown[]
{
    return error instanceof AggregateError ? error.errors.flatMap(teardownLeaves) : [error];
}

/**
 * Thrown by the runner whenever teardown fails. `errors` holds the scenario failure (if any) first, kept whole,
 * followed by every individual teardown failure, with nested teardown aggregates flattened so each one is
 * reported, and matched against expected failures, on its own.
 */
export class ScenarioErrors extends AggregateError
{
    constructor(scenarioId: string, failure: { error: unknown } | undefined, teardownErrors: unknown[])
    {
        const leaves = teardownErrors.flatMap(teardownLeaves);
        const errors = failure ? [failure.error, ...leaves] : leaves;
        const summary = failure ? `Scenario ${scenarioId} failed and its teardown also failed` : `Teardown of ${scenarioId} failed`;

        super(errors, `${summary}: ${leaves.map((leaf) => (leaf instanceof Error ? leaf.message : String(leaf))).join('; ')}`);
    }
}

/**
 * Builds a fresh composition, runs one scenario against it, then disposes everything. An exception during
 * cleanup or disposal fails the scenario: a renderer that throws while tearing down does not conform. Teardown
 * failures are never discarded, even when the scenario itself also failed.
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

    if (teardownErrors.length)
    {
        throw new ScenarioErrors(scenario.id, failed ? { error: failure } : undefined, teardownErrors);
    }

    if (failed)
    {
        throw failure;
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
 * something else, the scenario broke for a different reason and the test fails with that error. When teardown
 * fails, the scenario failure and every individual teardown failure must each match, so an unrelated teardown
 * regression can never be accepted as the known defect.
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
        const reported = error instanceof ScenarioErrors ? error.errors : [error];

        if (reported.every((entry) => expected.match.test(messageOf(entry))))
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

    // Expected failures are validated against the whole catalogue, so a binding's table stays valid when
    // `options.scenarios` selects a subset.
    validateBinding(binding);

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
