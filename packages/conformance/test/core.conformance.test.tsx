import { describeConformance, scenarios } from '../src';
import { createCoreBinding, createCoreParityBinding } from './core-binding/binding';

// The whole suite against core + renderer composed with fake adapters, in jsdom.
describeConformance(createCoreBinding());

// D4: the facade can opt the modular registry into upstream's silent `extend` replacement.
describeConformance(createCoreParityBinding(), {
    scenarios: scenarios.filter((scenario) => scenario.id === 'extend.replace-name'),
});
