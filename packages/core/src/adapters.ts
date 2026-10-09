import type { PixiSession, RootTarget, Runtime } from './contracts.js';
import type { AdapterManifest, Bind, Constructor, NodeDefinition, PixiTypes, ReactBindingFamily } from './types.js';

/**
 * Base class of every Pixi adapter. It is open: a third-party Pixi adapter subclasses it with its own manifest ID and
 * `PixiTypes`. There is no closed list of known adapters.
 */
export abstract class PixiAdapter<S extends PixiTypes>
{
    /** Type-only witness of the Pixi types; never emitted at runtime. */
    declare readonly pixiTypes: S;

    abstract readonly manifest: AdapterManifest;

    /** Creates the session for one root. `target` is the canvas the root owns. */
    abstract createSession(runtime: Runtime<S>, target: RootTarget): PixiSession<S>;

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
 * Base class of every React adapter. `bind` substitutes the composed Pixi types into the adapter's own
 * `ReactBindingFamily`, so the factory preserves backend-specific types without core naming any React type.
 */
export abstract class ReactAdapter<F extends ReactBindingFamily>
{
    /** Type-only witness of the binding family; never emitted at runtime. */
    declare readonly bindingFamily: F;

    abstract readonly manifest: AdapterManifest;

    abstract bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<F, S>;

    /** See `PixiAdapter.checkEnvironment`. */
    checkEnvironment(): void
    {
        // Nothing to check by default.
    }
}
