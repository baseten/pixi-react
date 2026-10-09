import {
    type Adapters,
    type Bind,
    type BindingFamily,
    CompatibilityError,
    compose,
    type RendererOptions,
    type Runtime,
    type SceneTypes,
} from '@pixi-react-provisional/core';

export type { Adapters, RendererOptions } from '@pixi-react-provisional/core';

/** What `createRenderer` returns: the framework's own bindings for the composed scene, plus its runtime. */
export type Renderer<F extends BindingFamily, S extends SceneTypes> = Bind<F, S> & { readonly runtime: Runtime<S> };

function isBindable(value: unknown): value is object
{
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * A non-extensible bindings value cannot carry `runtime`, so the result inherits from it instead. A function
 * stays callable: the wrapper forwards calls and inherits the function's properties.
 */
function inherit(bindings: object): object
{
    if (typeof bindings !== 'function')
    {
        return Object.create(bindings) as object;
    }

    const call = bindings as (...args: unknown[]) => unknown;

    function wrapper(this: unknown, ...args: unknown[]): unknown
    {
        return call.apply(this, args);
    }

    Object.setPrototypeOf(wrapper, bindings);

    return wrapper;
}

/**
 * Composes one framework adapter with one scene adapter into a new, isolated runtime and returns the framework's
 * bindings for it. The framework and scene families are inferred from the adapter instances; no explicit type
 * arguments are needed. Validation (adapter shape, ABI, capabilities, installed environment) happens before
 * anything is allocated; if binding fails, the runtime is disposed and nothing usable is returned.
 *
 * Every call creates a new runtime: two compositions never share constructors, roots, node metadata or
 * scheduled cleanup.
 */
export function createRenderer<S extends SceneTypes, F extends BindingFamily>(
    adapters: Adapters<S, F>,
    options: RendererOptions = {},
): Renderer<F, S>
{
    const runtime = compose(adapters, options);
    const frameworkId = runtime.manifests.framework.id;
    let bindings: unknown;

    try
    {
        bindings = adapters.framework.bind(runtime);

        if (!isBindable(bindings))
        {
            throw new CompatibilityError(
                `Framework adapter "${frameworkId}" returned ${bindings === null ? 'null' : typeof bindings} from bind(); `
                + 'it must return its bindings object.',
                { code: 'ABI_MISMATCH', adapterIds: [frameworkId] },
            );
        }

        if (Object.prototype.hasOwnProperty.call(bindings, 'runtime'))
        {
            throw new CompatibilityError(
                `Framework adapter "${frameworkId}" returned bindings with a "runtime" key, which createRenderer reserves.`,
                { code: 'ABI_MISMATCH', adapterIds: [frameworkId] },
            );
        }
    }
    catch (error)
    {
        // A failed composition publishes no usable bindings and keeps no allocation alive.
        runtime.dispose().catch(() => undefined);
        throw error;
    }

    const target = Object.isExtensible(bindings) ? bindings : inherit(bindings);

    Object.defineProperty(target, 'runtime', { value: runtime, enumerable: true, writable: false, configurable: false });

    return target as Renderer<F, S>;
}
