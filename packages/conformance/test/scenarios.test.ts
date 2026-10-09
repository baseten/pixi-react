import { describe, expect, it } from 'vitest';
import featureMap from '../FEATURE-MAP.md?raw';
import { FEATURES } from '../src/features';
import { scenarios } from '../src/scenarios';

describe('scenario catalogue', () =>
{
    it('has unique dotted IDs prefixed by their feature area', () =>
    {
        const ids = scenarios.map((scenario) => scenario.id);

        expect(new Set(ids).size).toBe(ids.length);

        for (const scenario of scenarios)
        {
            expect(scenario.id, scenario.id).toMatch(/^[\w-]+(\.[\w-]+)+$/);
            expect(scenario.id.startsWith(`${scenario.feature.split('.')[0]}.`), scenario.id).toBe(true);
        }
    });

    it('covers every public feature', () =>
    {
        const covered = new Set(scenarios.map((scenario) => scenario.feature));

        expect(Object.keys(FEATURES).filter((feature) => !covered.has(feature as keyof typeof FEATURES))).toEqual([]);
    });

    it('lists every scenario and feature in FEATURE-MAP.md', () =>
    {
        for (const scenario of scenarios)
        {
            expect(featureMap, scenario.id).toContain(`\`${scenario.id}\``);
        }

        for (const feature of Object.keys(FEATURES))
        {
            expect(featureMap, feature).toContain(`Feature \`${feature}\`.`);
        }
    });

    it('lists the React 18 scenarios, which the React 18 binding (issue 12) now runs: none is pending', () =>
    {
        const react18 = scenarios.filter((scenario) => scenario.requires.includes('react.18'));

        expect(react18.map((scenario) => scenario.id)).toEqual([
            'root.concurrency.react-18-concurrent-root',
            'root.errors.react-18-recoverable-error',
            'root.errors.react-18-modern-callbacks-rejected',
        ]);
        expect(react18.filter((scenario) => scenario.pendingOn !== undefined)).toEqual([]);
    });
});
