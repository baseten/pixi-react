import { type Application as PixiApplication, Container, Sprite } from 'pixi.js';
import { useEffect } from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as facade from '../../src';
import { facadeCoreRuntime } from '../utils/facadeRuntime';
import { CompatibilityError } from '@pixi-react-provisional/core';
import { Pixi8Adapter } from '@pixi-react-provisional/pixi-8';
import { React19Adapter } from '@pixi-react-provisional/react-19/19.3';
import { createRenderer } from '@pixi-react-provisional/renderer';
import {
    act,
    render,
} from '@testing-library/react';

/**
 * The default facade (one module-local runtime) and a separate `createRenderer` runtime of the same React 19.3 and
 * Pixi 8 pair, on one page at the same time.
 */
function createCustom()
{
    return createRenderer({ framework: new React19Adapter(), scene: new Pixi8Adapter() });
}

const options = { autoStart: false, sharedTicker: false, width: 16, height: 16, preference: 'webgl' } as const;

function codeOf(error: unknown)
{
    return error instanceof CompatibilityError ? error.code : String(error);
}

describe('multi-runtime isolation: the default facade and a createRenderer runtime', () =>
{
    const customs: ReturnType<typeof createCustom>[] = [];
    const custom = () =>
    {
        const renderer = createCustom();

        customs.push(renderer);

        return renderer;
    };

    afterEach(async () =>
    {
        await Promise.all(customs.splice(0).map((renderer) => renderer.runtime.dispose()));
    });

    it('renders both side by side with separate applications, catalogs and roots', async () =>
    {
        const other = custom();
        const FacadeName = 'IsolationFacadeOnly';
        const CustomName = 'IsolationCustomOnly';
        const FacadeOnly = class extends Container {};
        const CustomOnly = class extends Container {};

        facade.extend({ Container, [FacadeName]: FacadeOnly });
        other.extend({ Container, [CustomName]: CustomOnly });

        expect(facadeCoreRuntime().registry.has(CustomName), 'custom catalog leaks into the facade').toBe(false);
        expect(other.runtime.registry.has(FacadeName), 'facade catalog leaks into the custom runtime').toBe(false);

        let facadeApp: PixiApplication | undefined;
        let customApp: PixiApplication | undefined;
        const facadeRoots = facadeCoreRuntime().roots().length;
        const FacadeElement = `pixi${FacadeName}` as unknown as 'pixiContainer';
        const CustomElement = `pixi${CustomName}` as unknown as 'pixiContainer';

        const tree = (both: boolean) => (
            <>
                <facade.Application {...options} onInit={(app) => (facadeApp = app)}>
                    <FacadeElement label="facade" />
                </facade.Application>
                {both && (
                    <other.Application {...options} onInit={(app) => (customApp = app)}>
                        <CustomElement label="custom" />
                    </other.Application>
                )}
            </>
        );

        const { rerender, unmount } = await act(async () => render(tree(true)));

        await expect.poll(() => facadeApp?.stage?.children.length).toBe(1);
        await expect.poll(() => customApp?.stage?.children.length).toBe(1);

        expect(facadeApp).not.toBe(customApp);
        expect(facadeApp!.stage.children[0]).toBeInstanceOf(FacadeOnly);
        expect(customApp!.stage.children[0]).toBeInstanceOf(CustomOnly);
        expect(facadeCoreRuntime().roots().length, 'facade roots').toBe(facadeRoots + 1);
        expect(other.runtime.roots().length, 'custom roots').toBe(1);
        expect(other.runtime.nodeInfo(facadeApp!.stage.children[0]), 'custom runtime owns a facade node').toBeUndefined();
        expect(facadeCoreRuntime().nodeInfo(customApp!.stage.children[0]), 'facade owns a custom node').toBeUndefined();

        // Unmounting the custom runtime's Application leaves the facade's untouched.
        await act(async () => rerender(tree(false)));
        await expect.poll(() => other.runtime.roots().length).toBe(0);

        expect(customApp!.stage, 'custom app destroyed').toBeNull();
        expect(facadeApp!.stage.children[0], 'facade node alive').toBeInstanceOf(FacadeOnly);
        expect(facadeApp!.stage.children[0].destroyed).toBe(false);

        unmount();
        await expect.poll(() => facadeCoreRuntime().roots().length).toBe(facadeRoots);
    });

    it('an element registered only with the facade is unknown to the other runtime', async () =>
    {
        const other = custom();
        const errors: unknown[] = [];

        facade.extend({ Sprite });

        await act(async () => render((
            <other.Application {...options} onUncaughtError={(error) => errors.push(error)}>
                <pixiSprite />
            </other.Application>
        )));

        await expect.poll(() => errors.length).toBeGreaterThan(0);
        expect(codeOf(errors[0])).toBe('UNKNOWN_ELEMENT');
    });

    it('facade hooks reject the other runtime\'s application', async () =>
    {
        const other = custom();
        const errors: unknown[] = [];
        const Child = () =>
        {
            facade.useApplication();

            return null;
        };

        await act(async () => render((
            <other.Application {...options} onUncaughtError={(error) => errors.push(error)}>
                <Child />
            </other.Application>
        )));

        await expect.poll(() => errors.length).toBeGreaterThan(0);
        expect(codeOf(errors[0])).toBe('react-19.FOREIGN_RUNTIME');
    });

    it('the other runtime\'s hooks reject the facade\'s application', async () =>
    {
        const other = custom();
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const Child = () =>
        {
            other.useTick(() => undefined);

            return null;
        };

        try
        {
            await act(async () => render((
                <facade.Application {...options}>
                    <Child />
                </facade.Application>
            )));

            await expect.poll(() => reported.mock.calls.some(([error]) => codeOf(error) === 'react-19.FOREIGN_RUNTIME'))
                .toBe(true);
        }
        finally
        {
            reported.mockRestore();
        }
    });

    it('a canvas one runtime owns cannot be taken by the other', async () =>
    {
        const other = custom();
        const canvas = document.createElement('canvas');

        other.createRoot(canvas);

        expect(() => facade.createRoot(canvas)).toThrowError(CompatibilityError);
        expect(codeOf((() =>
        {
            try
            {
                facade.createRoot(canvas);
            }
            catch (error)
            {
                return error;
            }

            return undefined;
        })())).toBe('core.TARGET_LEASED');
    });

    it('a component using the facade hooks in its own Application keeps working next to the other runtime', async () =>
    {
        const other = custom();
        let ticks = 0;
        let app: PixiApplication | undefined;
        const Ticking = () =>
        {
            facade.useTick(() =>
            {
                ticks += 1;
            });

            const state = facade.useApplication();

            useEffect(() =>
            {
                app = state.app;
            });

            return null;
        };

        await act(async () => render((
            <>
                <other.Application {...options} />
                <facade.Application {...options}>
                    <Ticking />
                </facade.Application>
            </>
        )));

        await expect.poll(() => app?.renderer).toBeTruthy();
        act(() => app!.ticker.update(performance.now() + 16));
        await expect.poll(() => ticks).toBeGreaterThan(0);
    });
});
