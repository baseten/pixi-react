/** Whether `key` is a getter-only accessor or a non-writable data property anywhere on `target`'s prototype chain. */
function isReadOnly(target: object, key: string): boolean
{
    for (let current: object | null = target; current; current = Object.getPrototypeOf(current))
    {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);

        if (descriptor)
        {
            return 'value' in descriptor ? descriptor.writable === false : descriptor.set === undefined;
        }
    }

    return false;
}

/**
 * Upstream parity (D4): after initialization, on every render, upstream copied each application option onto the
 * Pixi `Application` instance (`app[key] = value`), including options Pixi only reads at init. The facade keeps
 * that. Read-only members (such as `canvas`) are skipped: upstream's assignment threw there, inside a render promise
 * nothing handled (an approved failure-path repair).
 */
export function assignApplicationOptions(app: object, options: Readonly<Record<string, unknown>>): void
{
    for (const [key, value] of Object.entries(options))
    {
        if (!isReadOnly(app, key))
        {
            (app as Record<string, unknown>)[key] = value;
        }
    }
}
