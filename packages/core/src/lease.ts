import { CompatibilityError, CoreErrorCodes } from './errors.js';

/**
 * DOM target ownership leases. This is the only state core shares between runtimes, and it holds nothing but
 * the owning runtime's identity: no catalogs, roots or React state.
 *
 * The table lives on `globalThis` under a registered symbol so that independently installed copies of core
 * (which are distinct runtimes) still cannot own one target concurrently. The key is versioned: a future
 * incompatible lease format must use a new key. The key names no package: core also ships bundled inside the
 * default facade package, and that copy must share this table with any separately installed core, whatever name
 * the modular packages are published under.
 */
const LEASES = Symbol.for('pixi-react:core:target-leases@1');

export interface LeaseHolder
{
    /** Identity of the owning runtime. */
    readonly owner: symbol;
    /** For diagnostics only. */
    readonly description: string;
}

type LeaseTable = WeakMap<object, LeaseHolder>;

function table(): LeaseTable
{
    const scope = globalThis as unknown as Record<symbol, unknown>;
    const existing = scope[LEASES];

    if (existing instanceof WeakMap)
    {
        return existing as LeaseTable;
    }

    const created: LeaseTable = new WeakMap();

    Object.defineProperty(scope, LEASES, { value: created, enumerable: false, configurable: false, writable: false });

    return created;
}

/** The current holder of `target`, if any. */
export function leaseHolder(target: object): LeaseHolder | undefined
{
    return table().get(target);
}

/**
 * Leases every target to `holder`, or none of them: throws `core.TARGET_LEASED` if another owner holds one.
 * Re-acquiring a target the holder already owns is a no-op.
 */
export function acquireLeases(targets: readonly object[], holder: LeaseHolder): void
{
    assertNotLeased(targets, holder);

    const leases = table();

    for (const target of targets)
    {
        leases.set(target, holder);
    }
}

/** Throws `core.TARGET_LEASED` if an owner other than `holder` holds any of `targets`. Acquires nothing. */
export function assertNotLeased(targets: readonly object[], holder: LeaseHolder): void
{
    const leases = table();

    for (const target of targets)
    {
        const current = leases.get(target);

        if (current && current.owner !== holder.owner)
        {
            throw new CompatibilityError(
                `This DOM target is already owned by ${current.description}. Unmount that root and await its `
                + `teardown before ${holder.description} uses the target, or render into a different element.`,
                {
                    code: CoreErrorCodes.TARGET_LEASED,
                    adapterIds: [],
                    expected: { owner: holder.description },
                    actual: { owner: current.description },
                },
            );
        }
    }
}

/** Releases the targets `holder` owns; targets owned by someone else are left untouched. */
export function releaseLeases(targets: readonly object[], holder: LeaseHolder): void
{
    const leases = table();

    for (const target of targets)
    {
        if (leases.get(target)?.owner === holder.owner)
        {
            leases.delete(target);
        }
    }
}
