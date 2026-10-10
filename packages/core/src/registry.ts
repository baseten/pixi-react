import { isRecord } from './abi.js';
import { CompatibilityError } from './errors.js';

import type { PixiAdapter } from './adapters.js';
import type { Registry } from './contracts.js';
import type {
    AttachRule,
    Catalog,
    Constructor,
    NodeDefinition,
    PixiTypes,
    RegistryConflictPolicy,
} from './types.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

export interface RegistryOptions
{
    readonly policy: RegistryConflictPolicy;
    /** Adapter IDs reported in errors. */
    readonly adapterIds: readonly string[];
    /** Throws when the owning runtime no longer accepts registrations. */
    readonly assertActive: () => void;
}

/**
 * The per-runtime catalog. Each runtime constructs its own; there is no module-level catalog, so two runtimes
 * never share constructors. Every check throws `CompatibilityError` in every build.
 */
export class RuntimeRegistry<S extends PixiTypes> implements Registry<S>
{
    private readonly byName = new Map<string, NodeDefinition>();
    /** Stable names for `component(Ctor)`; never derived from `Ctor.name`. */
    private readonly names = new WeakMap<Constructor, string>();
    private nextId = 0;

    constructor(private readonly pixi: PixiAdapter<S>, private readonly options: RegistryOptions)
    {}

    /** Normalizes a name exactly once, through the Pixi adapter. */
    normalize(name: string): string
    {
        if (typeof name !== 'string' || !name)
        {
            throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `Element names must be non-empty strings, got ${JSON.stringify(name)}.` : '', {
                code: 'UNKNOWN_ELEMENT',
                adapterIds: this.options.adapterIds,
            });
        }

        const normalized = this.pixi.normalizeName(name);

        if (typeof normalized !== 'string' || !normalized)
        {
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production' ? `Pixi adapter "${this.pixi.manifest.id}" normalized "${name}" to an invalid name.` : '',
                { code: 'ABI_MISMATCH', adapterIds: [this.pixi.manifest.id] },
            );
        }

        return normalized;
    }

    extend<C extends Catalog>(catalog: C): void
    {
        this.options.assertActive();

        if (!isRecord(catalog))
        {
            throw new TypeError(process.env.NODE_ENV !== 'production' ? 'extend() expects an object mapping names to constructors.' : 'Invalid extend() catalog.');
        }

        // Validate the whole catalog first, so a conflict registers nothing.
        const definitions = Object.entries(catalog).map(([key, ctor]) =>
        {
            if (typeof ctor !== 'function')
            {
                throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `extend({ ${key} }) expects a constructor, got ${typeof ctor}.` : '', {
                    code: 'UNSUPPORTED_NODE',
                    adapterIds: this.options.adapterIds,
                });
            }

            return this.describe(ctor, this.normalize(key));
        });

        this.commit(definitions, this.options.policy);
    }

    register<C extends new(...args: never[]) => S['node']>(definition: NodeDefinition<C>): void
    {
        this.options.assertActive();
        this.commit([this.validate(definition)], this.options.policy);
    }

    resolve(name: string): NodeDefinition
    {
        const definition = this.byName.get(name) ?? this.byName.get(this.normalize(name));

        if (!definition)
        {
            const key = this.normalize(name);

            // The full message in every build: an unregistered element is the most common application error.
            throw new CompatibilityError(
                `"${name}" is not registered in this runtime. Register its constructor first, e.g. extend({ ${key} }).`,
                {
                    code: 'UNKNOWN_ELEMENT',
                    adapterIds: this.options.adapterIds,
                    actual: { name },
                },
            );
        }

        return definition;
    }

    has(name: string): boolean
    {
        return this.byName.has(name) || this.byName.has(this.normalize(name));
    }

    nameOf(ctor: Constructor, name?: string): string
    {
        if (typeof ctor !== 'function')
        {
            throw new TypeError(process.env.NODE_ENV !== 'production' ? `nameOf() expects a constructor, got ${typeof ctor}.` : 'Invalid nameOf() constructor.');
        }

        if (name !== undefined)
        {
            const normalized = this.normalize(name);
            const existing = this.byName.get(normalized);

            if (existing && existing.ctor !== ctor)
            {
                throw this.conflict(normalized);
            }

            return normalized;
        }

        let assigned = this.names.get(ctor);

        if (assigned === undefined)
        {
            do
            {
                assigned = `component:${++this.nextId}`;
            }
            while (this.byName.has(assigned));

            this.names.set(ctor, assigned);
        }

        return assigned;
    }

    define<C extends Constructor>(ctor: C, name?: string): NodeDefinition<C>
    {
        this.options.assertActive();

        const resolved = this.nameOf(ctor, name);
        const existing = this.byName.get(resolved);

        if (existing && existing.ctor === ctor)
        {
            return existing as NodeDefinition<C>;
        }

        const definition = this.describe(ctor, resolved);

        // An explicit name bound to another constructor always conflicts (nameOf threw above): `component`
        // exists only in the modular packages, so the upstream replacement policy never applies to it.
        this.commit([definition], 'reject');

        return definition;
    }

    private describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        const definition = this.validate(this.pixi.describe(ctor, name));

        if (definition.ctor !== ctor || definition.name !== name)
        {
            throw new CompatibilityError(
                process.env.NODE_ENV !== 'production' ? `Pixi adapter "${this.pixi.manifest.id}" described "${name}" with a different name or constructor.` : '',
                { code: 'ABI_MISMATCH', adapterIds: [this.pixi.manifest.id], expected: { name }, actual: { name: definition.name } },
            );
        }

        return definition as NodeDefinition<C>;
    }

    /** Checks a descriptor's shape and returns a frozen copy, so a caller cannot mutate a registered definition. */
    private validate<C extends Constructor>(definition: NodeDefinition<C>): NodeDefinition<C>
    {
        const invalid = (reason: string) => new CompatibilityError(`Invalid node definition: ${reason}.`, {
            code: 'UNSUPPORTED_NODE',
            adapterIds: this.options.adapterIds,
        });

        if (!isRecord(definition))
        {
            throw invalid('expected an object');
        }

        const { name, ctor, capabilities, attach } = definition;

        if (typeof name !== 'string' || !name)
        {
            throw invalid('"name" must be a non-empty string');
        }

        if (typeof ctor !== 'function')
        {
            throw invalid(`"${name}" has no constructor`);
        }

        if (!isRecord(capabilities) || Object.values(capabilities).some((version) => !Number.isInteger(version) || version < 0))
        {
            throw invalid(`"${name}" capabilities must map IDs to non-negative integer versions`);
        }

        if (!isRecord(attach) || typeof attach.role !== 'string' || !Array.isArray(attach.accepts)
            || attach.accepts.some((role: unknown) => typeof role !== 'string'))
        {
            throw invalid(`"${name}" attach rule must be { role: string, accepts: string[] }`);
        }

        const rule: AttachRule = Object.freeze({ role: attach.role, accepts: Object.freeze([...attach.accepts]) });

        return Object.freeze({ name, ctor, capabilities: Object.freeze({ ...capabilities }), attach: rule });
    }

    private conflict(name: string): CompatibilityError
    {
        return new CompatibilityError(
            process.env.NODE_ENV !== 'production'
                ? (`"${name}" is already registered in this runtime with a different constructor. Registering another `
                + 'constructor under the same name would silently change what existing elements construct; choose a '
                + 'different name.')
                : '',
            { code: 'REGISTRY_CONFLICT', adapterIds: this.options.adapterIds, actual: { name } },
        );
    }

    private commit(definitions: readonly NodeDefinition[], policy: RegistryConflictPolicy): void
    {
        const pending = new Map<string, NodeDefinition>();

        for (const definition of definitions)
        {
            const existing = pending.get(definition.name) ?? this.byName.get(definition.name);

            if (existing && existing.ctor === definition.ctor)
            {
                continue;
            }

            if (existing && policy === 'reject')
            {
                throw this.conflict(definition.name);
            }

            pending.set(definition.name, definition);
        }

        for (const [name, definition] of pending)
        {
            const replaced = this.byName.get(name);

            // Under `replace`, the displaced constructor no longer owns this name.
            if (replaced && this.names.get(replaced.ctor) === name)
            {
                this.names.delete(replaced.ctor);
            }

            this.byName.set(name, definition);

            if (!this.names.has(definition.ctor))
            {
                this.names.set(definition.ctor, name);
            }
        }
    }
}
