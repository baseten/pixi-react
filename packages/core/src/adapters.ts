import type { RootTarget, Runtime, SceneSession } from './contracts.js';
import type { AdapterManifest, Bind, BindingFamily, Constructor, NodeDefinition, SceneTypes } from './types.js';

/**
 * Base class of every scene adapter. It is open: a third-party scene subclasses it with its own manifest ID and
 * `SceneTypes`. There is no closed list of known adapters.
 */
export abstract class SceneAdapter<S extends SceneTypes>
{
    /** Type-only witness of the scene types; never emitted at runtime. */
    declare readonly sceneTypes: S;

    abstract readonly manifest: AdapterManifest;

    /** Creates the session for one root. `target` is the canvas the root owns. */
    abstract createSession(runtime: Runtime<S>, target: RootTarget): SceneSession<S>;

    /** Pure metadata lookup; constructs nothing. Throws `CompatibilityError` (`UNSUPPORTED_NODE`) in every build. */
    abstract describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>;

    /**
     * Normalizes an element or catalog name once, at registration and lookup (for example a prefixed tag to its
     * catalog key). The default keeps the name unchanged.
     */
    normalizeName(name: string): string
    {
        return name;
    }

    /**
     * Asserts the installed tuple is supported, before anything is allocated. Throw a `CompatibilityError`
     * (`UNSUPPORTED_TUPLE`); any other error is wrapped in one. The default accepts every environment.
     */
    checkEnvironment(): void
    {
        // Nothing to check by default.
    }

    /** Applies props to an instance that no root owns (standalone `applyProps`). Optional. */
    applyProps?(node: S['node'], props: unknown): void;
}

/**
 * Base class of every framework adapter. `bind` substitutes the composed scene into the adapter's own
 * `BindingFamily`, so the factory preserves backend-specific types without core naming any framework type.
 */
export abstract class FrameworkAdapter<F extends BindingFamily>
{
    /** Type-only witness of the binding family; never emitted at runtime. */
    declare readonly bindingFamily: F;

    abstract readonly manifest: AdapterManifest;

    abstract bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<F, S>;

    /** See `SceneAdapter.checkEnvironment`. */
    checkEnvironment(): void
    {
        // Nothing to check by default.
    }
}
