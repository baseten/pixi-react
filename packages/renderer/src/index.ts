import {
    type Adapters,
    type Bind,
    CompatibilityError,
    compose,
    type PixiTypes,
    type ReactBindingFamily,
    type RendererOptions,
    type Runtime,
} from '@pixi-react-provisional/core';

export type { Adapters, RendererOptions } from '@pixi-react-provisional/core';

/** What `createRenderer` returns: the React adapter's own bindings for the composed Pixi adapter, plus its runtime. */
export type Renderer<F extends ReactBindingFamily, S extends PixiTypes> = Bind<F, S> & { readonly runtime: Runtime<S> };

function isBindable(value: unknown): value is object
{
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * A non-extensible bindings value cannot carry `runtime` as its own property, and a derived object would call its
 * methods with the wrong receiver (private-field brand checks fail, state writes land on the copy). The result is
 * a proxy of the original instead: `runtime` is answered by the proxy, and every other read, write and call reaches
 * the original. Methods inherited from the prototype chain are bound to the original, once per method, so a call
 * through the proxy (or a detached method) runs with the original as `this`. Own properties are returned as they
 * are. `runtime` is readable and non-writable, but it is not an own key of the result.
 */
function attachToNonExtensible<S extends PixiTypes>(bindings: object, runtime: Runtime<S>): object
{
    const bound = new WeakMap<(...args: unknown[]) => unknown, (...args: unknown[]) => unknown>();
    const isRuntime = (key: PropertyKey) => key === 'runtime';

    return new Proxy(bindings, {
        get(target, key)
        {
            if (isRuntime(key))
            {
                return runtime;
            }

            const value: unknown = Reflect.get(target, key, target);

            if (typeof value !== 'function' || Object.prototype.hasOwnProperty.call(target, key))
            {
                return value;
            }

            const method = value as (...args: unknown[]) => unknown;
            let forward = bound.get(method);

            if (!forward)
            {
                forward = method.bind(target) as (...args: unknown[]) => unknown;
                bound.set(method, forward);
            }

            return forward;
        },
        set: (target, key, value) => !isRuntime(key) && Reflect.set(target, key, value, target),
        has: (target, key) => isRuntime(key) || Reflect.has(target, key),
        defineProperty: (target, key, descriptor) => !isRuntime(key) && Reflect.defineProperty(target, key, descriptor),
        deleteProperty: (target, key) => !isRuntime(key) && Reflect.deleteProperty(target, key),
    });
}

/**
 * Composes one React adapter with one Pixi adapter into a new, isolated runtime and returns the React
 * adapter's bindings for it. The React binding family and the Pixi types are inferred from the adapter instances; no explicit type
 * arguments are needed. Validation (adapter shape, ABI, capabilities, installed environment) happens before
 * anything is allocated; if binding fails, the runtime is disposed and nothing usable is returned.
 *
 * Every call creates a new runtime: two compositions never share constructors, roots, node metadata or
 * scheduled cleanup.
 */
export function createRenderer<S extends PixiTypes, F extends ReactBindingFamily>(
    adapters: Adapters<S, F>,
    options: RendererOptions = {},
): Renderer<F, S>
{
    const runtime = compose(adapters, options);
    const reactId = runtime.manifests.react.id;
    let bindings: unknown;

    try
    {
        bindings = adapters.react.bind(runtime);

        if (!isBindable(bindings))
        {
            throw new CompatibilityError(
                `React adapter "${reactId}" returned ${bindings === null ? 'null' : typeof bindings} from bind(); `
                + 'it must return its bindings object.',
                { code: 'ABI_MISMATCH', adapterIds: [reactId] },
            );
        }

        if (Object.prototype.hasOwnProperty.call(bindings, 'runtime'))
        {
            throw new CompatibilityError(
                `React adapter "${reactId}" returned bindings with a "runtime" key, which createRenderer reserves.`,
                { code: 'ABI_MISMATCH', adapterIds: [reactId] },
            );
        }
    }
    catch (error)
    {
        // A failed composition publishes no usable bindings and keeps no allocation alive.
        runtime.dispose().catch(() => undefined);
        throw error;
    }

    try
    {
        if (!Object.isExtensible(bindings))
        {
            return attachToNonExtensible(bindings, runtime) as Renderer<F, S>;
        }

        // Throws if the bindings (for example an adapter's Proxy) refuse the property.
        Object.defineProperty(bindings, 'runtime', { value: runtime, enumerable: true, writable: false, configurable: false });
    }
    catch (error)
    {
        // Attaching the runtime is part of composition: if it fails, nothing created by bind() stays alive.
        runtime.dispose().catch(() => undefined);
        throw error;
    }

    return bindings as Renderer<F, S>;
}
