import { describe, expect, it } from 'vitest';
import { CompatibilityError, CoreErrorCodes, TeardownError } from '../src/index.js';
import { canvasElement, composeFake, FakeNode, FakeSceneAdapter, hostElement, readyRoot } from './fakes.js';

function caught(action: () => unknown): CompatibilityError
{
    try
    {
        action();
    }
    catch (error)
    {
        return error as CompatibilityError;
    }

    throw new Error('expected an error');
}

describe('two runtimes are isolated', () =>
{
    it('do not share constructors: one name may map to different constructors per runtime', () =>
    {
        const first = composeFake();
        const second = composeFake();

        class Other extends FakeNode
        {}

        first.registry.extend({ Shared: FakeNode });
        second.registry.extend({ Shared: Other });

        expect(first.registry.resolve('Shared').ctor).toBe(FakeNode);
        expect(second.registry.resolve('Shared').ctor).toBe(Other);
        expect(caught(() => second.registry.resolve('Missing')).code).toBe('UNKNOWN_ELEMENT');
        first.registry.extend({ OnlyFirst: FakeNode });
        expect(second.registry.has('OnlyFirst')).toBe(false);
    });

    it('do not share roots or node ownership', async () =>
    {
        const first = composeFake();
        const second = composeFake();

        first.registry.extend({ Node: FakeNode });
        second.registry.extend({ Node: FakeNode });

        const a = await readyRoot(first);
        const b = await readyRoot(second);
        const node = a.scene.create('Node', {});

        expect(first.roots()).toEqual([a]);
        expect(second.roots()).toEqual([b]);
        expect(second.rootFor(a.canvas)).toBeUndefined();
        expect(second.nodeInfo(node)).toBeUndefined();
        expect(caught(() => b.scene.append(b.session.container, node)).code).toBe('UNSUPPORTED_NODE');
    });

    it('do not share scheduled cleanup: disposing one runtime leaves the other running', async () =>
    {
        const scene = new FakeSceneAdapter();
        const first = composeFake(scene);
        const second = composeFake(scene);
        const a = await readyRoot(first);
        const b = await readyRoot(second);

        a.deferDispose();
        b.deferDispose();
        b.cancelDeferredDispose();
        await first.dispose();
        await Promise.resolve();

        expect(a.status).toBe('disposed');
        expect(b.status).toBe('ready');
        expect(second.status).toBe('active');
        expect(() => second.registry.extend({ Node: FakeNode })).not.toThrow();
    });
});

describe('DOM target ownership lease', () =>
{
    it('rejects a second runtime on the same canvas, element or created canvas', async () =>
    {
        const first = composeFake();
        const second = composeFake();
        const canvas = canvasElement();
        const host = hostElement();

        first.createRoot(canvas);
        const hosted = first.createRoot(host);

        for (const target of [canvas, host, hosted.canvas])
        {
            const error = caught(() => second.createRoot(target));

            expect(error).toBeInstanceOf(CompatibilityError);
            expect(error.code).toBe(CoreErrorCodes.TARGET_LEASED);
            expect(error.message).toMatch(/already owned by runtime \d+ \(test\.framework \+ test\.scene\)/);
        }

        expect(hosted.canvas.isConnected).toBe(true);
    });

    it('rejects an element whose children include another runtime\'s canvas, without touching the DOM', () =>
    {
        const first = composeFake();
        const second = composeFake();
        const outer = hostElement();
        const inner = outer.appendChild(document.createElement('div'));
        const root = first.createRoot(inner);

        expect(caught(() => second.createRoot(outer)).code).toBe(CoreErrorCodes.TARGET_LEASED);
        expect(root.canvas.isConnected).toBe(true);
    });

    it('is released after teardown, so another runtime may then own the target', async () =>
    {
        const first = composeFake();
        const second = composeFake();
        const canvas = canvasElement();
        const root = await readyRoot(first, canvas);

        await root.dispose();

        expect(second.createRoot(canvas).runtime).toBe(second);
    });

    it('releases the lease when session creation fails', () =>
    {
        class BrokenScene extends FakeSceneAdapter
        {
            createSession(): never
            {
                throw new Error('cannot create a session');
            }
        }

        const canvas = canvasElement();

        expect(() => composeFake(new BrokenScene()).createRoot(canvas)).toThrow('cannot create a session');
        expect(() => composeFake().createRoot(canvas)).not.toThrow();
    });
});

describe('runtime disposal', () =>
{
    it('snapshots the roots, tears each down once, runs cleanup, and freezes new work', async () =>
    {
        const scene = new FakeSceneAdapter();
        const runtime = composeFake(scene);
        const roots = [await readyRoot(runtime), await readyRoot(runtime), runtime.createRoot(canvasElement())];
        const order: string[] = [];

        runtime.onDispose(() =>
        {
            order.push(`cleanup after ${runtime.roots().length} roots`);
        });

        const disposal = runtime.dispose();

        expect(runtime.dispose()).toBe(disposal);
        expect(runtime.status).toBe('disposing');
        expect(caught(() => runtime.createRoot(canvasElement())).code).toBe('ROOT_DISPOSED');
        expect(caught(() => runtime.registry.extend({ Node: FakeNode })).code).toBe('ROOT_DISPOSED');

        await disposal;

        expect(runtime.status).toBe('disposed');
        expect(roots.map((root) => root.status)).toEqual(['disposed', 'disposed', 'disposed']);
        expect(scene.sessions.map((session) => session.destroyed)).toEqual([1, 1, 0]);
        expect(order).toEqual(['cleanup after 0 roots']);
    });

    it('aggregates root and cleanup failures', async () =>
    {
        const scene = new FakeSceneAdapter({ failAppDestroy: new Error('app destroy failed') });
        const runtime = composeFake(scene);

        await readyRoot(runtime);
        runtime.onDispose(() =>
        {
            throw new Error('cleanup failed');
        });

        let error: TeardownError | undefined;

        try
        {
            await runtime.dispose();
        }
        catch (caughtError)
        {
            error = caughtError as TeardownError;
        }

        expect(error).toBeInstanceOf(TeardownError);
        expect(error?.errors).toHaveLength(2);
        expect(error?.errors[0]).toBeInstanceOf(TeardownError);
        expect((error?.errors[1] as Error).message).toBe('cleanup failed');
        expect(runtime.status).toBe('disposed');
    });
});
