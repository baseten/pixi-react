import { Application as PixiApplication, type DestroyOptions, extensions as PixiExtensions, ExtensionType, type RendererDestroyOptions } from 'pixi.js';
import {
    createContext,
    createRef,
    useContext,
    useEffect,
} from 'react';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Application, type ApplicationRef, useApplication } from '../../../src';
import { facadeCoreRuntime } from '../../utils/facadeRuntime';
import { isAppMounted } from '../../utils/isAppMounted';
import {
    act,
    render,
} from '@testing-library/react';

/** Roots of the default runtime (upstream read its module-global `roots` map). */
const rootCount = () => facadeCoreRuntime().roots().length;

describe('Application', () =>
{
    it('mounts correctly', async () =>
    {
        const renderer = await act(async () => render(<Application />));

        expect(renderer.container).toMatchSnapshot();
    });

    it('forwards its ref', async () =>
    {
        const onInitSpy = vi.fn();
        const ref = createRef<ApplicationRef>();

        await act(async () => render((
            <Application
                ref={ref}
                onInit={onInitSpy} />
        )));

        await expect.poll(() => onInitSpy.mock.calls.length).toEqual(1);

        expect(ref.current?.getApplication()).toBeInstanceOf(PixiApplication);
        expect(ref.current?.getCanvas()).toBeInstanceOf(HTMLCanvasElement);
    });

    it('forwards context', async () =>
    {
        const onInitSpy = vi.fn();
        const ParentContext = createContext<boolean>(null!);
        let receivedValue!: boolean;

        function Test()
        {
            receivedValue = useContext(ParentContext);

            return null;
        }

        await act(async () => render((
            <ParentContext.Provider value={true}>
                <Application onInit={onInitSpy}>
                    <Test />
                </Application>
            </ParentContext.Provider>
        )));

        await expect.poll(() => onInitSpy.mock.calls.length).toEqual(1);

        expect(receivedValue).toBe(true);
    });

    describe('onInit', () =>
    {
        it('runs the callback once', async () =>
        {
            const onInitSpy = vi.fn();

            const TestComponent = () => (
                <Application onInit={onInitSpy} />
            );

            await act(async () => render((
                <TestComponent />
            )));

            await expect.poll(() => onInitSpy.mock.calls.length).toEqual(1);
        });
    });

    describe('unmount', () =>
    {
        it('unmounts after init', async () =>
        {
            let testApp = null as any as PixiApplication;
            let testAppIsInitialised = false;

            const TestChildComponent = () =>
            {
                const {
                    app,
                    isInitialised,
                } = useApplication();

                useEffect(() =>
                {
                    testApp = app;
                    testAppIsInitialised = isInitialised;

                    return () =>
                    {
                        testApp = app;
                        testAppIsInitialised = isInitialised;
                    };
                }, [
                    app,
                    isInitialised,
                ]);

                return null;
            };

            const TestComponent = () => (
                <Application>
                    <TestChildComponent />
                </Application>
            );

            expect(rootCount()).toEqual(0);

            const { unmount } = await act(() => render(<TestComponent />));

            expect(rootCount()).toEqual(1);

            await expect.poll(() => testAppIsInitialised).toEqual(true);

            unmount();

            await expect.poll(rootCount).toEqual(0);

            await expect.poll(() => isAppMounted(testApp)).toBeFalsy();
        });

        it('unmounts with destroyOptions', async () =>
        {
            let testApp = null as any as PixiApplication;
            let testAppIsInitialised = false;

            const destroyOptions: DestroyOptions = { children: true };

            const TestChildComponent = () =>
            {
                const {
                    app,
                    isInitialised,
                } = useApplication();

                useEffect(() =>
                {
                    testApp = app;
                    testAppIsInitialised = isInitialised;

                    return () =>
                    {
                        testApp = app;
                        testAppIsInitialised = isInitialised;
                    };
                }, [
                    app,
                    isInitialised,
                ]);

                return null;
            };

            const TestComponent = () => (
                <Application destroyOptions={destroyOptions}>
                    <TestChildComponent />
                </Application>
            );

            expect(rootCount()).toEqual(0);

            const { unmount } = await act(() => render(<TestComponent />));

            expect(rootCount()).toEqual(1);

            await expect.poll(() => testAppIsInitialised).toEqual(true);

            const destroySpy = vi.spyOn(testApp, 'destroy');

            unmount();

            await expect.poll(rootCount).toEqual(0);

            await expect.poll(() => isAppMounted(testApp)).toBeFalsy();

            expect(destroySpy).toHaveBeenCalledTimes(1);
            expect(destroySpy).toHaveBeenCalledWith(undefined, destroyOptions);
        });

        it('unmounts with rendererDestroyOptions', async () =>
        {
            let testApp = null as any as PixiApplication;
            let testAppIsInitialised = false;

            const rendererDestroyOptions: RendererDestroyOptions = { removeView: true };

            const TestChildComponent = () =>
            {
                const {
                    app,
                    isInitialised,
                } = useApplication();

                useEffect(() =>
                {
                    testApp = app;
                    testAppIsInitialised = isInitialised;

                    return () =>
                    {
                        testApp = app;
                        testAppIsInitialised = isInitialised;
                    };
                }, [
                    app,
                    isInitialised,
                ]);

                return null;
            };

            const TestComponent = () => (
                <Application rendererDestroyOptions={rendererDestroyOptions}>
                    <TestChildComponent />
                </Application>
            );

            expect(rootCount()).toEqual(0);

            const { unmount } = await act(() => render(<TestComponent />));

            expect(rootCount()).toEqual(1);

            await expect.poll(() => testAppIsInitialised).toEqual(true);

            const destroySpy = vi.spyOn(testApp, 'destroy');

            unmount();

            await expect.poll(rootCount).toEqual(0);

            await expect.poll(() => isAppMounted(testApp)).toBeFalsy();

            expect(destroySpy).toHaveBeenCalledTimes(1);
            expect(destroySpy).toHaveBeenCalledWith(rendererDestroyOptions, undefined);
        });

        it('unmounts during init', async () =>
        {
            let testApp = null as any as PixiApplication;
            let testAppIsInitialised = false;

            const TestChildComponent = () =>
            {
                const {
                    app,
                    isInitialised,
                } = useApplication();

                useEffect(() =>
                {
                    testApp = app;
                    testAppIsInitialised = isInitialised;

                    return () =>
                    {
                        testApp = app;
                        testAppIsInitialised = isInitialised;
                    };
                }, [
                    app,
                    isInitialised,
                ]);

                return null;
            };

            const TestComponent = () => (
                <Application>
                    <TestChildComponent />
                </Application>
            );

            expect(rootCount()).toEqual(0);

            const { unmount } = await act(() => render(<TestComponent />));

            expect(rootCount()).toEqual(1);

            expect(testAppIsInitialised).toBeFalsy();

            // Upstream's StrictMode replay committed the children before init settled (the
            // `Application.lifecycle.strict-mode-children-after-init` defect), so the child could report the app
            // here. Children now commit only after init, so read the pending root's app instead.
            expect(testApp).toBeNull();
            testApp = facadeCoreRuntime().roots()[0].app;

            unmount();

            await expect.poll(() => isAppMounted(testApp)).toBeFalsy();

            await expect.poll(rootCount).toEqual(0);
        });
    });

    it('loads extensions provided in the extensions prop', async () =>
    {
        const customLoader = {
            extension: {
                type: ExtensionType.LoadParser,
                name: 'custom-loader',
                priority: 100,
            },
        };

        const addSpy = vi.spyOn(PixiExtensions, 'add');

        await act(async () => render((
            <Application extensions={[customLoader]} />
        )));

        expect(addSpy).toHaveBeenCalledWith(customLoader);
        addSpy.mockRestore();
    });
});
