/**
 * Setup file of every React 19 fixture: fails any test during which React reports "Detected multiple renderers
 * concurrently rendering the same context provider" (issue 49), whoever replaced `console.error` meanwhile. The
 * shared reconciler of each package copy means no test should ever see it.
 */
import { afterEach, expect } from 'vitest';

const WARNING = /multiple renderers concurrently rendering the same context provider/;
const hits: string[] = [];

function observe(target: (...args: unknown[]) => unknown)
{
    return function observed(this: unknown, ...args: unknown[])
    {
        if (args.some((arg) => WARNING.test(String(arg))))
        {
            hits.push(args.map(String).join(' ').slice(0, 200));
        }

        return target.apply(this, args);
    };
}

let current = observe(console.error.bind(console));

Object.defineProperty(console, 'error', {
    configurable: true,
    get: () => current,
    set: (replacement: (...args: unknown[]) => unknown) =>
    {
        current = observe(replacement);
    },
});

afterEach(() =>
{
    const seen = hits.splice(0);

    expect(seen, 'React warned about multiple renderers').toEqual([]);
});
