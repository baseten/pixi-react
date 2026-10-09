/**
 * Binds the facade to one loaded pixi.js module (D6).
 *
 * pixi.js ships separate ESM and CJS builds, and `Pixi8Adapter` is bound to one Pixi instance. The facade's single
 * CommonJS implementation (this module, with the adapters bundled into it) therefore never imports pixi.js at
 * runtime: `lib/index.js` passes the exports `bindPixi` needs from the pixi.js module `require` loads, and the
 * generated `lib/index.mjs` those of the module `import` loads, by name (never the namespace, so bundlers can drop
 * the Pixi classes an application does not use). Both entries load this one module, which keeps one bound Pixi 8
 * adapter per Pixi instance (`bindPixi`) and one facade, with one default runtime, per adapter class: ESM and CJS
 * consumers that share a pixi.js instance (as in a bundler) share the default runtime.
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

/**
 * Binds the bundled Pixi 8 adapter to the `PIXI8_BINDING_EXPORTS` of one pixi.js module; cached per Pixi instance.
 * The entries import those exports by name from the pixi.js module their own module system loads.
 */
export { bindPixi, PIXI8_BINDING_EXPORTS } from '@pixi-react-provisional/pixi-8';

/** The part of a bound Pixi 8 adapter module (the result of `bindPixi`) the facade binds to. */
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
        throw new TypeError('bindFacade expects a bound Pixi 8 adapter module (the result of bindPixi).');
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
