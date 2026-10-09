import { Container } from 'pixi.js';
import { createContext, startTransition, useContext, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import * as facade from '../../src';
import { facadeCoreRuntime } from '../utils/facadeRuntime';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { React19Adapter } from '@pixi-react-provisional/react-19.3';
import { createRenderer } from '@pixi-react-provisional/renderer';

/**
 * Issue 49, in a real browser with real Pixi: the default facade's runtime (A) and a `createRenderer` runtime (B) of
 * the same react-19.3 package copy, interleaved. A starts a slow transition render that yields mid-render; while it
 * is paused, a click re-renders B. Both runtimes share the package copy's one reconciler, so B's render interrupts
 * A's yielded render: B reads its own default context value and React sees no second renderer. With a reconciler
 * per runtime, B read A's provider value and React warned. No `act()`: it never yields.
 *
 * In this workspace the facade's sources and the explicit runtime load the same built react-19.3 module. A published
 * `@pixi/react` bundles its own copy, which stays a separate reconciler from an installed react-19.3 (the documented
 * limit of one reconciler per package copy).
 */
const WARNING = /multiple renderers concurrently rendering the same context provider/;
const SLOW_CHILDREN = 40;
const options = { autoStart: false, sharedTicker: false, width: 16, height: 16, preference: 'webgl' } as const;

async function until(check: () => boolean, ms = 8000): Promise<void>
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

describe('the facade runtime and a createRenderer runtime of one react-19.3 copy', () =>
{
    const original = console.error;
    const cleanups: (() => unknown)[] = [];

    afterEach(async () =>
    {
        console.error = original;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        for (const cleanup of cleanups.splice(0).reverse())
        {
            await cleanup();
        }
    });

    it('a discrete update of the explicit runtime while the facade runtime\'s transition render has yielded reads its own context value', async () =>
    {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

        const errors: string[] = [];

        console.error = (...args: unknown[]) =>
        {
            errors.push(args.map(String).join(' '));
        };

        const other = createRenderer({ react: new React19Adapter(), pixi: new Pixi8Adapter() });

        cleanups.push(() => other.runtime.dispose());
        facade.extend({ Container });
        other.extend({ Container });

        const Theme = createContext('default');
        let rendered = 0;
        let aCommitted = 0;
        let setA!: (n: number) => void;
        let setB!: (update: (n: number) => number) => void;
        const bReads: string[] = [];
        const bCommitted: string[] = [];

        const Slow = () =>
        {
            busy(2);
            rendered += 1;

            return <pixiContainer />;
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
                    {Array.from({ length: n ? SLOW_CHILDREN : 0 }, (_, index) => <Slow key={index} />)}
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

            return <pixiContainer label={theme} />;
        };

        const canvasA = document.createElement('canvas');
        const rootA = facade.createRoot(canvasA);
        const rootB = other.createRoot(document.createElement('canvas'));

        // The facade's upstream Root has no unmount: release the facade root through its runtime.
        cleanups.push(() => facadeCoreRuntime().rootFor(canvasA)?.dispose());

        await rootA.render(<ATree />, options);
        await rootB.render(<BTree />, options);
        await until(() => bCommitted.length > 0);
        bReads.length = 0;
        bCommitted.length = 0;

        startTransition(() => setA(1));
        await until(() => rendered > 0);

        const yieldedMidRender = rendered < SLOW_CHILDREN && aCommitted === 0;
        const button = document.createElement('button');

        document.body.appendChild(button);
        cleanups.push(() => button.remove());
        button.addEventListener('click', () => setB((n) => n + 1));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await until(() => aCommitted === 1 && bCommitted.length > 0);

        expect(yieldedMidRender).toBe(true);
        expect(bReads).toContain('default|aCommitted=0');
        expect(bReads.filter((read) => !read.startsWith('default|'))).toEqual([]);
        expect(bCommitted.filter((value) => value !== 'default')).toEqual([]);
        expect(errors.filter((message) => WARNING.test(message))).toEqual([]);
    });
});
