/**
 * Several runtimes of one adapter package rendering at once (issue 49).
 *
 * Pixi roots are a secondary renderer, and a secondary renderer keeps each context's current value in one field of
 * the context object. When each runtime had its own reconciler, a time-sliced render of runtime A that yielded (a
 * transition) left A's pushed provider values in place; a discrete update of runtime B that rendered before A resumed
 * read them, committed A's value instead of its own default (in production too) and made development React warn
 * "Detected multiple renderers concurrently rendering the same context provider". With one reconciler per package
 * copy, B's render interrupts A's yielded render first, as React DOM does for two of its roots.
 *
 * None of these tests uses `act()`: `act()` flushes work without yielding, so it never interleaves two renders.
 */
import { createContext, startTransition, useContext, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot as createDomRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createEpochComposition, type EpochComposition, type EpochModule } from './binding';

const WARNING = /multiple renderers concurrently rendering the same context provider/;
/** Slow children of runtime A's transition: long enough (about 80 ms) that the scheduler yields mid-render. */
const SLOW_CHILDREN = 40;

/** Polls (macrotask by macrotask, so the scheduler runs in between) until `check` holds. */
async function until(check: () => boolean, ms = 5000): Promise<void>
{
    const start = Date.now();

    while (!check())
    {
        if (Date.now() - start > ms)
        {
            throw new Error('timed out');
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function busy(ms: number): void
{
    const end = performance.now() + ms;

    while (performance.now() < end)
    {
        // Spin: a render that takes time, so the scheduler's time slice runs out.
    }
}

interface Interleaving
{
    /** A had rendered some, not all, of its slow children and committed nothing when B's update was dispatched. */
    readonly yieldedMidRender: boolean;
    /** The context value and A's progress each time B rendered after the update. */
    readonly bReads: string[];
    /** The context value B committed, each time it committed after the update. */
    readonly bCommitted: string[];
}

/**
 * Runtime A starts a slow transition render under `<Theme.Provider value="A">`, which yields mid-render; while it is
 * paused, a click (a discrete update) re-renders B, which reads `Theme` outside any provider.
 */
async function interleave(a: EpochComposition, b: EpochComposition): Promise<Interleaving>
{
    const Theme = createContext('default');
    const A = a.elements.container;
    const B = b.elements.container;
    let rendered = 0;
    let aCommitted = 0;
    let setA!: (n: number) => void;
    let setB!: (update: (n: number) => number) => void;
    const bReads: string[] = [];
    const bCommitted: string[] = [];

    const Slow = ({ index }: { index: number }) =>
    {
        busy(2);
        rendered += 1;

        return <A label={`slow-${index}`} />;
    };
    const ATree = () =>
    {
        const [n, set] = useState(0);

        setA = set;
        useLayoutEffect(() =>
        {
            aCommitted = n;
        });

        return (
            <Theme.Provider value="A">
                {Array.from({ length: n ? SLOW_CHILDREN : 0 }, (_, index) => <Slow key={index} index={index} />)}
            </Theme.Provider>
        );
    };
    const BTree = () =>
    {
        const [, set] = useState(0);
        const theme = useContext(Theme);

        setB = set;
        bReads.push(`${theme}|aCommitted=${aCommitted}`);
        useLayoutEffect(() =>
        {
            bCommitted.push(theme);
        });

        return <B label={theme} />;
    };

    await a.renderer.createRoot(document.createElement('div')).render(<ATree />, a.appOptions);
    await b.renderer.createRoot(document.createElement('div')).render(<BTree />, b.appOptions);
    await until(() => bCommitted.length > 0);
    bReads.length = 0;
    bCommitted.length = 0;

    startTransition(() => setA(1));
    await until(() => rendered > 0);

    const yieldedMidRender = rendered < SLOW_CHILDREN && aCommitted === 0;
    const button = document.createElement('button');

    document.body.appendChild(button);

    try
    {
        button.addEventListener('click', () => setB((n) => n + 1));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await until(() => aCommitted === 1 && bCommitted.length > 0);
    }
    finally
    {
        button.remove();
    }

    return { yieldedMidRender, bReads, bCommitted };
}

export function describeMultipleRuntimes(epoch: EpochModule): void
{
    describe('several runtimes of one package (one shared reconciler)', () =>
    {
        const compositions: EpochComposition[] = [];
        const errors: string[] = [];
        const original = console.error;
        let actEnvironment: unknown;

        const compose = () =>
        {
            const composition = createEpochComposition(epoch);

            compositions.push(composition);

            return composition;
        };

        const setup = () =>
        {
            const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown };

            actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
            scope.IS_REACT_ACT_ENVIRONMENT = false;
            errors.length = 0;
            console.error = (...args: unknown[]) =>
            {
                errors.push(args.map(String).join(' '));
            };
        };

        afterEach(async () =>
        {
            console.error = original;
            (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnvironment;
            await Promise.all(compositions.splice(0).map((composition) => composition.dispose()));
        });

        it('two runtimes render a bridged DOM context in turn without a multiple-renderers warning', async () =>
        {
            setup();

            const a = compose();
            const b = compose();
            const Theme = createContext('default');
            const seen: Record<string, string> = {};
            let setTheme!: (value: string) => void;

            const Reader = ({ id, composition }: { id: string; composition: EpochComposition }) =>
            {
                composition.renderer.useApplication();
                seen[id] = useContext(Theme);

                return null;
            };
            const Host = ({ id, composition }: { id: string; composition: EpochComposition }) =>
            {
                const Bridge = composition.renderer.useContextBridge();
                const [root] = useState(() => composition.renderer.createRoot(document.createElement('div')));

                useLayoutEffect(() =>
                {
                    void root.render(<Bridge><Reader id={id} composition={composition} /></Bridge>, composition.appOptions);
                });

                return null;
            };
            const Dom = () =>
            {
                const [theme, set] = useState('one');

                setTheme = set;

                return (
                    <Theme.Provider value={theme}>
                        <a.renderer.ContextBridgeProvider><Host id="a" composition={a} /></a.renderer.ContextBridgeProvider>
                        <b.renderer.ContextBridgeProvider><Host id="b" composition={b} /></b.renderer.ContextBridgeProvider>
                    </Theme.Provider>
                );
            };
            const dom = createDomRoot(document.createElement('div'));

            flushSync(() => dom.render(<Dom />));
            await until(() => seen.a === 'one' && seen.b === 'one');

            for (const value of ['two', 'three', 'four'])
            {
                setTheme(value);
                await until(() => seen.a === value && seen.b === value);
            }

            dom.unmount();

            expect(seen).toEqual({ a: 'four', b: 'four' });
            expect(errors.filter((message) => WARNING.test(message))).toEqual([]);
        });

        it('a discrete update of runtime B while runtime A\'s transition render has yielded reads and commits B\'s own context value', async () =>
        {
            setup();

            const { yieldedMidRender, bReads, bCommitted } = await interleave(compose(), compose());

            // The scenario happened: A yielded mid-render and B rendered before A committed.
            expect(yieldedMidRender).toBe(true);
            expect(bReads).toContain('default|aCommitted=0');
            // B never saw A's provider value, and React saw no second renderer.
            expect(bReads.filter((read) => !read.startsWith('default|'))).toEqual([]);
            expect(bCommitted).not.toHaveLength(0);
            expect(bCommitted.filter((value) => value !== 'default')).toEqual([]);
            expect(errors.filter((message) => WARNING.test(message))).toEqual([]);
        });

        it('control: the same interleaving of two roots of one runtime reads and commits the root\'s own value', async () =>
        {
            setup();

            const a = compose();
            const { yieldedMidRender, bReads, bCommitted } = await interleave(a, a);

            expect(yieldedMidRender).toBe(true);
            expect(bReads).toContain('default|aCommitted=0');
            expect(bReads.filter((read) => !read.startsWith('default|'))).toEqual([]);
            expect(bCommitted.filter((value) => value !== 'default')).toEqual([]);
            expect(errors.filter((message) => WARNING.test(message))).toEqual([]);
        });
    });
}
