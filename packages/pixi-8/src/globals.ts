/**
 * Pixi's process-global state, which adapter isolation cannot isolate: the extension registry and the default
 * text style. One table of each exists per loaded Pixi module (see `bind.ts`), shared by every runtime and session
 * of this implementation. The algorithms follow `design/adapter-architecture.md#globals-and-ownership`.
 */

/** The two methods of Pixi's `extensions` object the lease table uses. */
export interface ExtensionRegistry
{
    add(...extensions: unknown[]): unknown;
    remove(...extensions: unknown[]): unknown;
}

/** The leases of one application. */
export class ExtensionLeaseHolder
{
    private readonly held = new Set<unknown>();

    constructor(private readonly table: ExtensionLeaseTable)
    {}

    get extensions(): readonly unknown[]
    {
        return [...this.held];
    }

    /**
     * Makes the held set equal to `next`. New extensions are acquired first, in order; if one fails, only the
     * leases acquired by this call are rolled back and the error is rethrown, so the previous set stays intact and
     * a retry can acquire again. Extensions no longer listed are released afterwards; release failures are
     * collected and thrown together once every release ran.
     */
    update(next: readonly unknown[] | undefined): void
    {
        const wanted = new Set(next ?? []);
        const acquired: unknown[] = [];

        try
        {
            for (const extension of wanted)
            {
                if (!this.held.has(extension))
                {
                    this.table.acquire(extension);
                    acquired.push(extension);
                }
            }
        }
        catch (error)
        {
            for (const extension of acquired.reverse())
            {
                try
                {
                    this.table.release(extension);
                }
                catch
                {
                    // The rollback is best effort; the acquisition error is the one to report.
                }
            }

            throw error;
        }

        for (const extension of acquired)
        {
            this.held.add(extension);
        }

        const errors: unknown[] = [];

        for (const extension of [...this.held])
        {
            if (!wanted.has(extension))
            {
                this.held.delete(extension);

                try
                {
                    this.table.release(extension);
                }
                catch (error)
                {
                    errors.push(error);
                }
            }
        }

        throwCollected(errors, 'Releasing extensions failed');
    }

    /** Releases every lease. Idempotent. */
    releaseAll(): void
    {
        this.update([]);
    }
}

/**
 * Reference-counted extension leases, keyed by extension identity. The first acquisition adds the extension to
 * Pixi; the last release removes it. Extensions registered with Pixi directly are not visible to the table: Pixi
 * offers no reliable way to detect them, so callers must not also pass a directly registered extension to an
 * application (design: "callers must coordinate those mutations").
 */
export class ExtensionLeaseTable
{
    private readonly counts = new Map<unknown, number>();

    constructor(private readonly registry: ExtensionRegistry)
    {}

    /** How many leases this table holds on `extension`. */
    count(extension: unknown): number
    {
        return this.counts.get(extension) ?? 0;
    }

    /** Opens a holder: one application's set of leases. */
    holder(): ExtensionLeaseHolder
    {
        return new ExtensionLeaseHolder(this);
    }

    /** @internal Adds a lease; adds the extension to Pixi on the first one. Throws (and holds nothing) on failure. */
    acquire(extension: unknown): void
    {
        const count = this.count(extension);

        if (count === 0)
        {
            this.registry.add(extension);
        }

        this.counts.set(extension, count + 1);
    }

    /** @internal Drops a lease; removes the extension from Pixi on the last one. The lease is gone even if Pixi throws. */
    release(extension: unknown): void
    {
        const count = this.count(extension);

        if (count === 0)
        {
            return;
        }

        if (count > 1)
        {
            this.counts.set(extension, count - 1);

            return;
        }

        this.counts.delete(extension);
        this.registry.remove(extension);
    }
}

type StyleValues = Readonly<Record<string, unknown>>;

interface Presence
{
    present: boolean;
    value: unknown;
}

interface PropertyRecord
{
    /** What the property returns to when no writer survives. */
    baseline: Presence;
    /** What the registry last installed (or adopted); a mismatch means an external write. */
    installed: Presence;
    readonly writers: Map<object, { value: unknown; order: number }>;
}

function samePresence(a: Presence, b: Presence): boolean
{
    return a.present === b.present && (!a.present || Object.is(a.value, b.value));
}

/**
 * The shared writer registry for one Pixi `TextStyle.defaultTextStyle` object: last explicit writer wins per
 * property, departing writers restore the newest survivor or the baseline, and external writes become the new
 * baseline. Cleanup never counts as a write, and writes only while the property still holds what the registry
 * last installed.
 */
export class DefaultStyleRegistry
{
    private readonly properties = new Map<string, PropertyRecord>();
    /** Each writer's latest explicit values. */
    private readonly writerValues = new Map<object, Map<string, unknown>>();
    private order = 0;

    constructor(private readonly defaults: Record<string, unknown>)
    {}

    /** Whether `writer` currently holds an explicit value for any property. */
    isWriter(writer: object): boolean
    {
        return this.writerValues.has(writer);
    }

    /**
     * Records `writer`'s complete style. Properties whose value changed (or that are new) are explicit writes and
     * become the newest; properties the writer no longer lists are removed from it; unchanged ones keep their order.
     */
    write(writer: object, style: StyleValues | undefined): void
    {
        const previous = this.writerValues.get(writer) ?? new Map<string, unknown>();
        const next = new Map(Object.entries(style ?? {}).filter(([, value]) => value !== undefined));

        for (const key of previous.keys())
        {
            if (!next.has(key))
            {
                this.change(key, (record) => record.writers.delete(writer));
            }
        }

        for (const [key, value] of next)
        {
            if (!previous.has(key) || !Object.is(previous.get(key), value))
            {
                this.change(key, (record) => record.writers.set(writer, { value, order: ++this.order }));
            }
        }

        if (next.size)
        {
            this.writerValues.set(writer, next);
        }
        else
        {
            this.writerValues.delete(writer);
        }
    }

    /** Removes every entry of `writer`. Idempotent; a second call makes no write. */
    release(writer: object): void
    {
        this.write(writer, undefined);
    }

    private read(key: string): Presence
    {
        return Object.prototype.hasOwnProperty.call(this.defaults, key)
            ? { present: true, value: this.defaults[key] }
            : { present: false, value: undefined };
    }

    private change(key: string, operation: (record: PropertyRecord) => void): void
    {
        const current = this.read(key);
        let record = this.properties.get(key);

        if (!record)
        {
            record = { baseline: current, installed: current, writers: new Map() };
            this.properties.set(key, record);
        }
        else if (!samePresence(current, record.installed))
        {
            // An external write since the registry last installed this property: it becomes the baseline, and every
            // earlier writer entry retires. Those writers contribute again only through a later explicit change.
            record.baseline = current;
            record.installed = current;
            record.writers.clear();
        }

        operation(record);

        let newest: { value: unknown; order: number } | undefined;

        for (const entry of record.writers.values())
        {
            if (!newest || entry.order > newest.order)
            {
                newest = entry;
            }
        }

        const target: Presence = newest ? { present: true, value: newest.value } : record.baseline;

        if (!samePresence(target, current))
        {
            if (target.present)
            {
                this.defaults[key] = target.value;
            }
            else
            {
                delete this.defaults[key];
            }
        }

        record.installed = target;

        if (!newest)
        {
            // Nothing is owned any more: the next writer captures a fresh baseline.
            this.properties.delete(key);
        }
    }
}

/** Throws nothing, the single error, or an AggregateError of all of them. */
export function throwCollected(errors: readonly unknown[], message: string): void
{
    if (errors.length === 1)
    {
        throw errors[0];
    }

    if (errors.length > 1)
    {
        throw new AggregateError(errors, `${message}: ${errors.map((error) => (error instanceof Error ? error.message : String(error))).join('; ')}`);
    }
}
