import { describe, expect, it, vi } from 'vitest';
import { CompatibilityError, TeardownError } from '../src/index.js';
import {
    canvasElement,
    composeFake,
    FakeNode,
    FakeSceneAdapter,
    hostElement,
    readyRoot,
} from './fakes.js';

async function rejection(promise: Promise<unknown>): Promise<unknown>
{
    try
    {
        await promise;
    }
    catch (error)
    {
        return error;
    }

    throw new Error('expected a rejection');
}

describe('root targets', () =>
{
    it('maps an element target and its new canvas to one root', () =>
    {
        const runtime = composeFake();
        const host = hostElement();
        const previous = host.appendChild(document.createElement('span'));
        const root = runtime.createRoot(host);

        expect(root.target).toBe(host);
        expect([...host.children]).toEqual([root.canvas]);
        expect(previous.isConnected).toBe(false);
        expect(runtime.createRoot(host)).toBe(root);
        expect(runtime.createRoot(root.canvas)).toBe(root);
        expect(runtime.rootFor(root.canvas)).toBe(root);
    });

    it('uses a canvas target directly and returns the same root for it', () =>
    {
        const runtime = composeFake();
        const canvas = canvasElement();
        const root = runtime.createRoot(canvas);

        expect(root.canvas).toBe(canvas);
        expect(runtime.createRoot(canvas)).toBe(root);
        expect(runtime.roots()).toEqual([root]);
    });

    it('refuses a new root for a target whose root is still tearing down', async () =>
    {
        const runtime = composeFake();
        const canvas = canvasElement();
        const root = await readyRoot(runtime, canvas);
        const teardown = root.dispose();

        expect(() => runtime.createRoot(canvas)).toThrow(/await its unmount\(\)/);
        await teardown;
        expect(runtime.createRoot(canvas)).not.toBe(root);
    });
});

describe('root lifecycle state machine', () =>
{
    it('moves new -> initialising -> ready, runs onInit once before queued work, in call order', async () =>
    {
        const scene = new FakeSceneAdapter();
        const runtime = composeFake(scene);
        const order: string[] = [];
        const root = runtime.createRoot(canvasElement(), { hooks: { onInit: () => order.push('onInit') } });

        expect(root.status).toBe('new');
        expect(root.applicationState).toEqual({ app: root.app, isInitialised: false, isInitialising: false });

        const gate = scene.holdNextInit();
        const first = root.schedule(() => order.push('first'));
        const init = root.initialise({ width: 1 });
        const second = root.schedule(() => order.push('second'));

        expect(root.initialise({ width: 2 })).toBe(init);
        expect(root.status).toBe('initialising');
        expect(root.applicationState.isInitialising).toBe(true);

        gate.release();
        await expect(init).resolves.toBe(root.app);
        await Promise.all([first, second]);

        expect(root.status).toBe('ready');
        expect(order).toEqual(['onInit', 'first', 'second']);
        expect(scene.log.filter((entry) => entry.op === 'init')).toEqual([
            { op: 'init', app: root.app, options: { width: 1 } },
        ]);
        // Once ready and idle, work runs synchronously.
        let ran = false;

        void root.schedule(() =>
        {
            ran = true;
        });
        expect(ran).toBe(true);
        expect(root.applicationState).toBe(root.applicationState);
    });

    it('fails once: onInitError gets the cause, queued and later work rejects INIT_FAILED, no retry', async () =>
    {
        const scene = new FakeSceneAdapter();
        const runtime = composeFake(scene);
        const onInitError = vi.fn();
        const onInit = vi.fn();
        const root = runtime.createRoot(canvasElement(), { hooks: { onInit, onInitError } });
        const cause = new Error('no GPU');
        const gate = scene.holdNextInit();
        const queued = root.schedule(() => 'never');
        const init = root.initialise({});

        gate.fail(cause);

        const failure = await rejection(init) as CompatibilityError;

        expect(failure).toBeInstanceOf(CompatibilityError);
        expect(failure.code).toBe('INIT_FAILED');
        expect(failure.cause).toBe(cause);
        expect(failure.message).toMatch(/no GPU.*unmount it and create a new root/);
        expect(root.status).toBe('failed');
        expect(root.failure).toBe(cause);
        expect(onInitError).toHaveBeenCalledTimes(1);
        expect(onInitError).toHaveBeenCalledWith(cause);
        expect(onInit).not.toHaveBeenCalled();
        expect((await rejection(queued) as CompatibilityError).code).toBe('INIT_FAILED');
        expect((await rejection(root.schedule(() => 1)) as CompatibilityError).code).toBe('INIT_FAILED');
        expect(root.initialise({})).toBe(init);

        await root.dispose();
        expect(root.status).toBe('disposed');
        // A failed init allocated nothing the root owns; the scene cleaned up after itself.
        expect(scene.log.some((entry) => entry.op === 'appDestroy')).toBe(false);
        expect(runtime.roots()).toEqual([]);
    });

    it('never reports an ignored init rejection as unhandled', async () =>
    {
        const scene = new FakeSceneAdapter();
        const unhandled = vi.fn();

        process.on('unhandledRejection', unhandled);

        try
        {
            const root = composeFake(scene).createRoot(canvasElement());
            const gate = scene.holdNextInit();

            void root.initialise({});
            gate.fail(new Error('ignored'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
        }
        finally
        {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('reports a throwing onInit without failing the root or rerunning init', async () =>
    {
        const reported: unknown[] = [];
        const runtime = composeFake(new FakeSceneAdapter(), { onUnhandledError: (error) => reported.push(error) });
        const root = runtime.createRoot(canvasElement(), {
            hooks: {
                onInit: () =>
                {
                    throw new Error('callback bug');
                },
            },
        });

        await root.initialise({});

        expect(root.status).toBe('ready');
        expect(reported).toEqual([new Error('callback bug')]);
    });

    it('unmount during init: waits for init, no onInit, no late work, destroys the app once', async () =>
    {
        const scene = new FakeSceneAdapter();
        const runtime = composeFake(scene);
        const onInit = vi.fn();
        const task = vi.fn();
        const root = runtime.createRoot(canvasElement(), { hooks: { onInit } });
        const gate = scene.holdNextInit();
        const init = root.initialise({});
        const queued = root.schedule(task);
        const signal = root.signal;
        const teardown = root.dispose();

        expect(root.status).toBe('disposing');
        expect(signal.aborted).toBe(true);
        expect((await rejection(queued) as CompatibilityError).code).toBe('ROOT_DISPOSED');

        gate.release();
        await teardown;

        expect((await rejection(init) as CompatibilityError).code).toBe('ROOT_DISPOSED');
        expect(onInit).not.toHaveBeenCalled();
        expect(task).not.toHaveBeenCalled();
        expect(scene.sessions[0].destroyed).toBe(1);
        expect(root.status).toBe('disposed');
    });

    it('keeps an async task tracked while it runs: dispose rejects it instead of letting it resolve late', async () =>
    {
        const root = await readyRoot(composeFake());
        let finish!: (value: string) => void;
        const late = root.schedule(() => new Promise<string>((resolve) =>
        {
            finish = resolve;
        }));
        const teardown = root.dispose();

        // The task settles after teardown started (a reconciler commit flushed by unmount, for example).
        finish('late');

        const error = await rejection(late) as CompatibilityError;

        expect(error).toBeInstanceOf(CompatibilityError);
        expect(error.code).toBe('ROOT_DISPOSED');
        expect(error.message).toMatch(/still running/);
        await teardown;
    });

    it('rejects a task that disposes its own root before returning, instead of resolving or hanging', async () =>
    {
        const root = await readyRoot(composeFake());
        let finish!: (value: string) => void;
        let teardown!: Promise<void>;
        const reentrant = root.schedule(() =>
        {
            teardown = root.dispose();

            return new Promise<string>((resolve) =>
            {
                finish = resolve;
            });
        });

        finish('late');

        const error = await rejection(reentrant) as CompatibilityError;

        expect(error.code).toBe('ROOT_DISPOSED');
        await teardown;

        const syncRoot = await readyRoot(composeFake());
        const syncTask = syncRoot.schedule(() =>
        {
            void syncRoot.dispose();

            return 'value';
        });

        expect(((await rejection(syncTask)) as CompatibilityError).code).toBe('ROOT_DISPOSED');
    });

    it('rejects an async task that never settles when the root is disposed, instead of hanging', async () =>
    {
        const root = await readyRoot(composeFake());
        const stuck = root.schedule(() => new Promise<never>(() => undefined));
        const outcome = Promise.race([
            rejection(stuck),
            new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
        ]);

        await root.dispose();

        expect(((await outcome) as CompatibilityError).code).toBe('ROOT_DISPOSED');
    });

    it('does not report a tracked task that rejects after teardown as unhandled', async () =>
    {
        const unhandled = vi.fn();

        process.on('unhandledRejection', unhandled);

        try
        {
            const root = await readyRoot(composeFake());
            let fail!: (error: Error) => void;
            const task = root.schedule(() => new Promise<never>((_resolve, reject) =>
            {
                fail = reject;
            }));

            await root.dispose();
            fail(new Error('superseded'));
            expect((await rejection(task) as CompatibilityError).code).toBe('ROOT_DISPOSED');
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
        }
        finally
        {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('dispose is idempotent and returns one shared promise', async () =>
    {
        const scene = new FakeSceneAdapter();
        const root = await readyRoot(composeFake(scene));
        const first = root.dispose();

        expect(root.dispose()).toBe(first);
        await first;
        expect(root.dispose()).toBe(first);
        expect(scene.sessions[0].destroyed).toBe(1);
    });

    it('rejects work after teardown starts with ROOT_DISPOSED', async () =>
    {
        const root = await readyRoot(composeFake());

        void root.dispose();

        expect((await rejection(root.schedule(() => 1)) as CompatibilityError).code).toBe('ROOT_DISPOSED');
        expect(() => root.scene.create('Node', {})).toThrow(/is dispos(ing|ed): no further work/);
    });

    it('continues teardown past failures, aggregates them, and still releases the root', async () =>
    {
        const scene = new FakeSceneAdapter({ failDestroyFor: 'bad', failAppDestroy: new Error('app destroy failed') });
        const runtime = composeFake(scene);
        const canvas = canvasElement();
        const root = await readyRoot(runtime, canvas);
        const hookAfter = vi.fn();

        runtime.registry.extend({ Node: FakeNode });
        root.scene.append(root.session.container, root.scene.create('Node', { label: 'bad' }));
        root.onTeardown(() =>
        {
            throw new Error('framework cleanup failed');
        });
        root.onTeardown(hookAfter);

        const first = root.dispose();
        const error = await rejection(first) as TeardownError;

        expect(error).toBeInstanceOf(TeardownError);
        expect(error.errors.map((item: Error) => item.message)).toEqual([
            'framework cleanup failed',
            'destroy failed for bad',
            'app destroy failed',
        ]);
        expect(hookAfter).toHaveBeenCalledTimes(1);
        expect(root.status).toBe('disposed');
        expect(runtime.roots()).toEqual([]);
        // Repeated unmount returns the same settled promise; nothing is destroyed twice.
        expect(root.dispose()).toBe(first);
        await rejection(root.dispose());
        expect(scene.log.filter((entry) => entry.op === 'appDestroy')).toHaveLength(1);
        // The lease was released: another runtime may own the canvas now.
        expect(() => composeFake().createRoot(canvas)).not.toThrow();
    });

    it('defers teardown one turn so a StrictMode remount cancels it, and tracks generations', async () =>
    {
        const scene = new FakeSceneAdapter();
        const root = await readyRoot(composeFake(scene));
        const token = root.token();

        expect(token.current).toBe(true);

        root.deferDispose();
        expect(token.current).toBe(false);
        expect(root.cancelDeferredDispose()).toBe(true);
        expect(root.cancelDeferredDispose()).toBe(false);

        await Promise.resolve();
        await Promise.resolve();
        expect(root.status).toBe('ready');

        const remounted = root.token();

        expect(remounted.generation).toBeGreaterThan(token.generation);
        expect(remounted.current).toBe(true);

        root.deferDispose({ reason: 'final' });
        await vi.waitFor(() => expect(root.status).toBe('disposed'));
        expect(scene.log.filter((entry) => entry.op === 'appDestroy')).toEqual([
            { op: 'appDestroy', app: root.app, options: { reason: 'final' } },
        ]);
        expect(remounted.current).toBe(false);
    });
});
