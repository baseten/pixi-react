import type { Capability } from './binding';
import type { ScenarioContext } from './context';
import type { FeatureId } from './features';

/**
 * - `contract`: desired behaviour every binding must show (the adapter contract on
 *   `claude/issue-4-contract-fixes`, or upstream behaviour that the contract keeps).
 * - `parity`: recorded current upstream `@pixi/react` behaviour that decision D4 keeps in the facade but a
 *   modular composition may change in a documented future major. Parity scenarios require
 *   `parity.upstream`. They record what the facade does today; they never certify a confirmed defect.
 */
export type ScenarioKind = 'contract' | 'parity';

export interface Scenario
{
    /** Stable dotted ID, used by the feature map and by bindings' expected-failure tables. */
    readonly id: string;
    readonly feature: FeatureId;
    readonly title: string;
    readonly kind: ScenarioKind;
    readonly requires: readonly Capability[];
    /** The expected outcome in words; reproduced in the feature map. */
    readonly expected: string;
    /** Issue that owns running this scenario when no current binding provides its capabilities. */
    readonly pendingOn?: string;
    run(ctx: ScenarioContext): Promise<void>;
}

export interface ScenarioDefinition
{
    id: string;
    feature: FeatureId;
    title: string;
    kind?: ScenarioKind;
    requires?: readonly Capability[];
    expected: string;
    pendingOn?: string;
    run(ctx: ScenarioContext): Promise<void>;
}

export function defineScenario(definition: ScenarioDefinition): Scenario
{
    const kind = definition.kind ?? 'contract';
    const requires = [...(definition.requires ?? [])];

    if (kind === 'parity' && !requires.includes('parity.upstream'))
    {
        requires.push('parity.upstream');
    }

    return Object.freeze({ ...definition, kind, requires: Object.freeze(requires) });
}
