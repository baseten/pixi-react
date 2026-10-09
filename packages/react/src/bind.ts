/**
 * Binds the facade to one loaded `@pixi-react-provisional/pixi-8` module, and so to one pixi.js instance (D6).
 *
 * pixi.js ships separate ESM and CJS builds, and `Pixi8Adapter` is bound to the instance its own entry loads. The
 * facade's single CommonJS implementation therefore never imports the Pixi adapter itself: `lib/index.js` binds the
 * adapter `require` loads, and the generated `lib/index.mjs` binds the adapter `import` loads. Both entries load
 * this one module, and it keeps one facade, with one default runtime, per adapter class: ESM and CJS consumers that
 * share a pixi.js instance (as in a bundler) share the default runtime.
 */
import { createApplication } from './components/Application';
import { createCreateRoot } from './core/createRoot';
import { createExtend } from './helpers/extend';
import { createUseApplication } from './hooks/useApplication';
import { createUseExtend } from './hooks/useExtend';
import { createUseTick } from './hooks/useTick';
import { createApplyProps } from './runtime/applyProps';
import { createFacadeRuntime, type FacadeRuntime } from './runtime/composition';

import type { Pixi8AdapterConstructor } from '@pixi-react-provisional/pixi-8';

/** The part of the `@pixi-react-provisional/pixi-8` module namespace the facade binds to. */
export interface Pixi8Module
{
    readonly Pixi8Adapter: Pixi8AdapterConstructor;
}

function bind(runtime: FacadeRuntime)
{
    const extend = createExtend(runtime);
    const useApplication = createUseApplication(runtime);

    return {
        Application: createApplication(runtime),
        createRoot: createCreateRoot(runtime),
        applyProps: createApplyProps(runtime),
        extend,
        useApplication,
        useExtend: createUseExtend(extend),
        useTick: createUseTick(runtime, useApplication),
    };
}

/** The public facade API, bound to one Pixi 8 adapter module. */
export type Facade = ReturnType<typeof bind>;

interface Binding
{
    readonly facade: Facade;
    readonly runtime: FacadeRuntime;
}

const bindings = new WeakMap<Pixi8AdapterConstructor, Binding>();

function bindingFor(pixi8: Pixi8Module): Binding
{
    const Pixi8Adapter = pixi8?.Pixi8Adapter;

    if (typeof Pixi8Adapter !== 'function')
    {
        throw new TypeError('bindFacade expects the @pixi-react-provisional/pixi-8 module namespace.');
    }

    let binding = bindings.get(Pixi8Adapter);

    if (!binding)
    {
        const runtime = createFacadeRuntime(Pixi8Adapter);

        binding = { facade: bind(runtime), runtime };
        bindings.set(Pixi8Adapter, binding);
    }

    return binding;
}

/** Returns the facade bound to `pixi8`, creating it on first use: one facade per `Pixi8Adapter` class. */
export function bindFacade(pixi8: Pixi8Module): Facade
{
    return bindingFor(pixi8).facade;
}

/**
 * The default runtime behind the facade bound to `pixi8`. Internal: for the facade's own tests (the conformance
 * binding and the multi-runtime cases); it is not exported from the package entry points.
 */
export function facadeRuntimeFor(pixi8: Pixi8Module): FacadeRuntime
{
    return bindingFor(pixi8).runtime;
}
