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
 * A non-extensible bindings value cannot carry `runtime` as its own property, and a derived object would call its
 * methods with the wrong receiver (private-field brand checks fail, state writes land on the copy). The result is
 * a proxy of the original instead: `runtime` is answered by the proxy, and every other read, write and call reaches
 * the original. Methods inherited from the prototype chain are bound to the original, once per method, so a call
 * through the proxy (or a detached method) runs with the original as `this`. Own properties are returned as they
 * are. `runtime` is readable and non-writable, but it is not an own key of the result.
 */
function attachToNonExtensible<S extends SceneTypes>(bindings: object, runtime: Runtime<S>): object
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
