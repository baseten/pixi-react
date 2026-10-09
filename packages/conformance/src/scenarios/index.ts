import { applicationScenarios } from './application';
import { hookScenarios } from './hooks';
import { propScenarios } from './props';
import { rootScenarios } from './root';
import { treeScenarios } from './tree';

import type { Scenario } from '../scenario';

/** Every conformance scenario, in feature-map order. IDs are unique (checked by the package tests). */
export const scenarios: readonly Scenario[] = Object.freeze([
    ...treeScenarios,
    ...propScenarios,
    ...applicationScenarios,
    ...hookScenarios,
    ...rootScenarios,
]);
