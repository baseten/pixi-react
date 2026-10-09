import { describeConformance } from '../src';
import { createFakeBinding } from './fake-binding/binding';

// The whole suite against the fake renderer and fake Pixi backend, in jsdom. A second, independent composition
// running the same scenarios shows the binding interface is not shaped around the facade.
describeConformance(createFakeBinding());
