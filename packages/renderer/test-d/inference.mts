/** Inference through the factory, consumed with `import` (ESM declarations). */
import {
    CounterFramework,
    Emitter,
    type Equals,
    type InspectionFamily,
    Inspector,
    type IsAny,
    type LegacyScene,
    LegacySceneAdapter,
    Particle,
    type ParticleScene,
    ParticleSceneAdapter,
    type Ticker,
} from './scene.mjs';
import { CompatibilityError, type CompatibilityErrorCode, type RootRecord, type Runtime } from '@pixi-react-provisional/core';
import { createRenderer, type Renderer } from '@pixi-react-provisional/renderer';

// No explicit type arguments: both families are inferred from the adapter instances.
const renderer = createRenderer({ framework: new Inspector(), scene: new ParticleSceneAdapter() });

export const exact: Equals<typeof renderer, Renderer<InspectionFamily, ParticleScene>> = true;
export const notAny: IsAny<typeof renderer> = false;
export const runtimeType: Equals<typeof renderer.runtime, Runtime<ParticleScene>> = true;

// The framework's API carries the selected scene's types.
export const label: string = renderer.app().label;
renderer.onTick((tick) =>
{
    const ticker: Ticker = tick;

    return ticker.deltaMS;
});

const EmitterComponent = renderer.component(Emitter);

export const emitter: Emitter = EmitterComponent({ rate: 2 });
// @ts-expect-error The props of Emitter require `rate`.
EmitterComponent({ label: 'no rate' });
// @ts-expect-error Particle props are its own constructor options, not Emitter's.
renderer.component(Particle)({ rate: 1 });

// The runtime and roots are typed by the scene.
declare const canvas: HTMLCanvasElement;
const root: RootRecord<ParticleScene> = renderer.runtime.createRoot(canvas);

export const app: ParticleScene['app'] = root.app;
export const created: Emitter | Particle = root.scene.create('Emitter', { rate: 1 });
export const init: Promise<ParticleScene['app']> = root.initialise({ width: 1, height: 1 });
// @ts-expect-error Init options come from the scene.
void root.initialise({ width: 1 });
// @ts-expect-error The app is not any: it has no `view`.
export const wrongApp: string = root.app.view;
// @ts-expect-error A tick is the scene's Ticker, not a number.
renderer.onTick((tick: number) => tick);
// @ts-expect-error The factory adds no members the family does not declare.
renderer.useApplication();
// @ts-expect-error The registry only registers constructors of scene nodes.
renderer.runtime.registry.register({ name: 'X', ctor: class { x = 1; }, capabilities: {}, attach: { role: 'child', accepts: [] } });

// A different scene with the same framework yields different types.
const legacy = createRenderer({ framework: new Inspector(), scene: new LegacySceneAdapter() });

export const view: string = legacy.app().view;
legacy.onTick((tick) => tick.toFixed());
// @ts-expect-error Runtimes of different scenes are not interchangeable.
export const mixed: Runtime<ParticleScene> = legacy.runtime;
export const legacyRuntime: Runtime<LegacyScene> = legacy.runtime;

// A family with a real generic bind implementation.
const counter = createRenderer({ framework: new CounterFramework(), scene: new ParticleSceneAdapter() });

export const count: number = counter.count();
export const counterRuntime: Equals<typeof counter.runtime, Runtime<ParticleScene>> = true;
// @ts-expect-error The counter family has no inspection API.
counter.app();

// Composition misuse.
// @ts-expect-error The adapters cannot be swapped.
createRenderer({ framework: new ParticleSceneAdapter(), scene: new Inspector() });
// @ts-expect-error A scene adapter is required.
createRenderer({ framework: new Inspector() });
// @ts-expect-error Capability protocol versions are numbers.
createRenderer({ framework: new Inspector(), scene: new ParticleSceneAdapter() }, { requiredCapabilities: { 'scene.ticker': '1' } });
// @ts-expect-error The registry conflict policy is reject or replace.
createRenderer({ framework: new Inspector(), scene: new ParticleSceneAdapter() }, { registryConflict: 'merge' });
// @ts-expect-error A plain object is not a framework adapter.
createRenderer({ framework: { bind: () => ({}) }, scene: new ParticleSceneAdapter() });

// The shared error contract.
export function describeFailure(error: unknown): string
{
    if (!(error instanceof CompatibilityError))
    {
        return 'unknown';
    }

    const code: CompatibilityErrorCode = error.code;

    if (error.code === 'CAPABILITY_MISSING')
    {
        return `${error.capability ?? ''} ${String(error.actual?.[error.capability ?? ''])}`;
    }

    // @ts-expect-error The cause must be narrowed before use.
    void error.cause.message;

    return code;
}

export const namespaced: CompatibilityErrorCode = 'community.shader.UNSUPPORTED_FORMAT';
// @ts-expect-error A misspelled built-in code is not a namespaced code.
export const misspelled: CompatibilityErrorCode = 'CAPABILTY_MISSING';
// @ts-expect-error A CompatibilityError needs its details.
export const missingDetails = new CompatibilityError('x');
