import { act as reactAct, type ReactNode, StrictMode } from 'react';
import { createRoot, type Root as DomRoot } from 'react-dom/client';

import type { Composition, NodeKind, PixiElement, PixiProbe, ReactBindingApi } from './binding';
import type { PixiJournal } from './journal';

export interface Deferred<T>
{
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

export function deferred<T = void>(): Deferred<T>
{
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) =>
    {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

export interface MountedApp
{
    readonly app: unknown;
    readonly stage: unknown;
    /** Re-renders the same `<Application>` with new children and props (the `onInit` identity is kept). */
    rerender(children?: ReactNode, props?: Record<string, unknown>): Promise<void>;
}

export interface RenderOptions
{
    strict?: boolean;
}

/** What a scenario receives. Everything is bound to one fresh composition. */
export interface ScenarioContext
{
    readonly composition: Composition;
    readonly api: ReactBindingApi;
    readonly elements: Readonly<Record<NodeKind, PixiElement>>;
    readonly probe: PixiProbe;
    readonly journal: PixiJournal;
    /** DOM element hosting the primary React DOM root. Attached to `document.body`. */
    readonly host: HTMLElement;

    act(callback: () => unknown): Promise<void>;
    /** Renders into the primary React DOM root inside `act`. */
    render(element: ReactNode, options?: RenderOptions): Promise<void>;
    /** Renders into the primary React DOM root, then awaits `until` inside an `act` scope. */
    renderUntil<T>(element: ReactNode, until: Promise<T>, options?: RenderOptions): Promise<T>;
    /** Unmounts the primary React DOM root inside `act`. */
    unmount(): Promise<void>;
    /**
     * Renders `<Application {...appOptions} {...props}>{children}</Application>` into the primary root and
     * resolves once `onInit` has run and the scene commit has flushed.
     */
    mountApp(children?: ReactNode, props?: Record<string, unknown>, options?: RenderOptions): Promise<MountedApp>;
    /**
     * Awaits `promise` inside an `act` scope, then yields one macrotask inside the same scope so promise
     * continuations scheduled by the renderer (for example after an application initialization settles)
     * run and their React work is flushed when the scope exits.
     */
    actUntil(promise: Promise<unknown>): Promise<void>;
    /**
     * Runs `callback` with the React act environment switched off, for scenarios that observe scheduling
     * outside `act` (batching, `Root.render` resolution). Restores the environment afterwards.
     */
    outsideAct<T>(callback: () => Promise<T> | T): Promise<T>;
    /**
     * Yields macrotasks until `predicate` holds, failing after `maxTasks` yields. It waits for a condition
     * driven by the renderer's own scheduler; it is not a timed sleep.
     */
    waitFor(predicate: () => boolean, maxTasks?: number): Promise<void>;
    /** Advances the app's ticker manually inside `act`. */
    tick(app: unknown, ms?: number): Promise<void>;
    /** Dispatches a scene event inside `act`. */
    dispatch(app: unknown, node: unknown, type: string): Promise<void>;
    /** Yields one macrotask so the host can report unhandled rejections. Not a timed sleep. */
    yieldTask(): Promise<void>;
    /** A DOM element of a fixed size outside the React tree, attached to the body and removed on cleanup. */
    createSizedElement(width: number, height: number): HTMLElement;
    /** Captures `console.error` calls for the rest of the scenario (silencing them). */
    captureConsoleErrors(): unknown[][];
    /** Captures unhandled promise rejections for the rest of the scenario. */
    captureUnhandledRejections(): unknown[];
    deferred<T = void>(): Deferred<T>;
    onCleanup(callback: () => unknown): void;
}

interface ActEnvironment
{
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function yieldTask(): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, 0);
    });
}

export async function act(callback: () => unknown): Promise<void>
{
    await reactAct(async () =>
    {
        await callback();
    });
}

function captureRejectionsInBrowser(sink: unknown[]): () => void
{
    // Capture phase on the target runs before the test host's own (bubble phase) listener.
    const listener = (event: PromiseRejectionEvent) =>
    {
        sink.push(event.reason);
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    window.addEventListener('unhandledrejection', listener, { capture: true });

    return () => window.removeEventListener('unhandledrejection', listener, { capture: true });
}

interface NodeProcessLike
{
    listeners(event: 'unhandledRejection'): Array<(reason: unknown) => void>;
    removeAllListeners(event: 'unhandledRejection'): void;
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
}

function captureRejectionsInNode(sink: unknown[]): () => void
{
    const proc = (globalThis as unknown as { process: NodeProcessLike }).process;
    const previous = proc.listeners('unhandledRejection');
    const listener = (reason: unknown) =>
    {
        sink.push(reason);
    };

    proc.removeAllListeners('unhandledRejection');
    proc.on('unhandledRejection', listener);

    return () =>
    {
        proc.off('unhandledRejection', listener);
        previous.forEach((previousListener) => proc.on('unhandledRejection', previousListener));
    };
}

function isBrowser()
{
    // jsdom defines `window` but never dispatches `unhandledrejection`; Node reports through `process`.
    return typeof window !== 'undefined' && !(/jsdom/i).test(globalThis.navigator?.userAgent ?? '');
}

export interface ScenarioContextHandle
{
    readonly context: ScenarioContext;
    cleanup(): Promise<void>;
}

export function createScenarioContext(composition: Composition): ScenarioContextHandle
{
    const environment = globalThis as ActEnvironment;
    const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

    environment.IS_REACT_ACT_ENVIRONMENT = true;

    const host = document.createElement('div');

    host.dataset.conformance = 'host';
    document.body.appendChild(host);

    let domRoot: DomRoot | null = null;
    const cleanups: Array<() => unknown> = [];
    const { Application } = composition.api;

    const wrap = (element: ReactNode, options: RenderOptions) =>
        (options.strict ? <StrictMode>{element}</StrictMode> : element);

    const render = async (element: ReactNode, options: RenderOptions = {}) =>
    {
        domRoot ??= createRoot(host);
        const root = domRoot;

        await act(() => root.render(wrap(element, options)));
    };

    async function renderUntil<T>(element: ReactNode, until: Promise<T>, options: RenderOptions = {})
    {
        domRoot ??= createRoot(host);
        const root = domRoot;

        // React DOM flushes a render when the act scope exits, so the render needs its own scope. The wait
        // gets a second scope, so renderer work scheduled by `until`'s continuations is flushed by act.
        await act(() => root.render(wrap(element, options)));
        await act(async () =>
        {
            await until;
        });

        return until;
    }

    const context: ScenarioContext = {
        composition,
        api: composition.api,
        elements: composition.elements,
        probe: composition.probe,
        journal: composition.probe.journal,
        host,
        act,
        render,
        renderUntil,
        async unmount()
        {
            const root = domRoot;

            domRoot = null;

            if (root)
            {
                await act(() => root.unmount());
            }
        },
        async mountApp(children, props = {}, options = {})
        {
            const ready = deferred<unknown>();
            let latestProps = props;
            const onInit = (app: unknown) =>
            {
                (latestProps.onInit as ((app: unknown) => void) | undefined)?.(app);
                ready.resolve(app);
            };
            const element = (nextChildren: ReactNode) => (
                <Application {...composition.appOptions} {...latestProps} onInit={onInit}>
                    {nextChildren}
                </Application>
            );

            const app = await renderUntil(element(children), ready.promise, options);

            return {
                app,
                stage: composition.probe.stage(app),
                async rerender(nextChildren, nextProps)
                {
                    if (nextProps)
                    {
                        latestProps = nextProps;
                    }

                    await render(element(nextChildren), options);
                },
            };
        },
        actUntil: (promise) => act(async () =>
        {
            await promise;
            await yieldTask();
        }),
        async outsideAct(callback)
        {
            environment.IS_REACT_ACT_ENVIRONMENT = false;

            try
            {
                return await callback();
            }
            finally
            {
                environment.IS_REACT_ACT_ENVIRONMENT = true;
            }
        },
        async waitFor(predicate, maxTasks = 200)
        {
            for (let task = 0; task < maxTasks; task++)
            {
                if (predicate())
                {
                    return;
                }

                await yieldTask();
            }

            if (!predicate())
            {
                throw new Error(`waitFor: condition not met after ${maxTasks} tasks`);
            }
        },
        tick: (app, ms = 16) => act(() => composition.probe.advance(app, ms)),
        dispatch: (app, node, type) => act(() => composition.probe.dispatch(app, node, type)),
        yieldTask,
        createSizedElement(width, height)
        {
            const element = document.createElement('div');

            element.style.width = `${width}px`;
            element.style.height = `${height}px`;
            document.body.appendChild(element);
            cleanups.push(() => element.remove());

            return element;
        },
        captureConsoleErrors()
        {
            const calls: unknown[][] = [];
            const original = console.error;

            console.error = (...args: unknown[]) =>
            {
                calls.push(args);
            };
            cleanups.push(() =>
            {
                console.error = original;
            });

            return calls;
        },
        captureUnhandledRejections()
        {
            const sink: unknown[] = [];

            cleanups.push(isBrowser() ? captureRejectionsInBrowser(sink) : captureRejectionsInNode(sink));

            return sink;
        },
        deferred,
        onCleanup(callback)
        {
            cleanups.push(callback);
        },
    };

    return {
        context,
        async cleanup()
        {
            const errors: unknown[] = [];

            try
            {
                await context.unmount();
            }
            catch (error)
            {
                errors.push(error);
            }

            for (const callback of cleanups.reverse())
            {
                try
                {
                    await callback();
                }
                catch (error)
                {
                    errors.push(error);
                }
            }

            host.remove();
            environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;

            if (errors.length)
            {
                throw new AggregateError(errors, 'Scenario cleanup failed');
            }
        },
    };
}
