import { afterEach, describe, expect, it, vi } from 'vitest';
import { FacadeReactAdapter } from '../../../src/runtime/composition';
import { CERTIFIED_REACT, createReactVersionCheck, uncertifiedReactWarning } from '../../../src/runtime/reactVersion';
import { React19Adapter } from '@pixi-react-provisional/react-19.3';

/**
 * Errors are checked by `name` and `code`: the test loads core through Vite and the adapters through their built CJS
 * implementation, so class identity is not the point here.
 */
/** An adapter that reads `version` as the installed React. */
function withReact<T extends new() => object>(Adapter: T, version: string): InstanceType<T> & { checkEnvironment(): void }
{
    const adapter = new Adapter() as InstanceType<T> & { reactVersion(): string; checkEnvironment(): void };

    adapter.reactVersion = () => version;

    return adapter;
}

function failureOf(run: () => void): unknown
{
    try
    {
        run();
    }
    catch (error)
    {
        return error;
    }

    return undefined;
}

describe('the facade\'s React version policy (issue 49)', () =>
{
    afterEach(() =>
    {
        vi.restoreAllMocks();
    });

    it('is certified for React 19.3, matching its "^19.3.0" peer', async () =>
    {
        const manifest = await import('../../../package.json');

        expect(CERTIFIED_REACT).toEqual({ minor: '19.3', tested: ['19.3.0'] });
        expect(manifest.peerDependencies.react).toBe('^19.3.0');
    });

    it('accepts any React 19.3 patch silently', () =>
    {
        const warn = vi.fn();
        const check = createReactVersionCheck(warn);

        expect(check('19.3.0')).toBe('certified');
        expect(check('19.3.7')).toBe('certified');
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns once, naming the certified version and how to pin, for an uncertified React 19 minor', () =>
    {
        const warn = vi.fn();
        const check = createReactVersionCheck(warn);

        expect(check('19.4.0')).toBe('uncertified-minor');
        expect(check('19.4.0')).toBe('uncertified-minor');
        expect(check('19.5.1')).toBe('uncertified-minor');
        expect(check('19.2.0')).toBe('uncertified-minor');
        expect(warn).toHaveBeenCalledTimes(1);

        const [message] = warn.mock.calls[0] as [string];

        expect(message).toBe(uncertifiedReactWarning('19.4.0'));
        expect(message).toContain('@pixi/react is certified for React 19.3 (tested: 19.3.0)');
        expect(message).toContain('React 19.4.0 is installed');
        expect(message).toContain('pin react and react-dom to 19.3 (for example "react": "~19.3.0")');
        expect(message).toContain('compose your own renderer with createRenderer and the React adapter package for React 19.4');
    });

    it('classifies a React outside the 19 major as unsupported, without warning', () =>
    {
        const warn = vi.fn();
        const check = createReactVersionCheck(warn);

        expect(check('18.3.1')).toBe('unsupported');
        expect(check('20.0.0')).toBe('unsupported');
        expect(warn).not.toHaveBeenCalled();
    });

    it('the facade\'s adapter logs ONE console warning per package copy, and still rejects another React major', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        expect(() => withReact(FacadeReactAdapter, '19.4.0').checkEnvironment()).not.toThrow();
        expect(() => withReact(FacadeReactAdapter, '19.4.0').checkEnvironment()).not.toThrow();
        expect(() => withReact(FacadeReactAdapter, '19.3.2').checkEnvironment()).not.toThrow();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(uncertifiedReactWarning('19.4.0'));

        const failure = failureOf(() => withReact(FacadeReactAdapter, '18.3.1').checkEnvironment());

        expect((failure as Error).name).toBe('CompatibilityError');
        expect((failure as { code?: string }).code).toBe('UNSUPPORTED_TUPLE');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('leaves the modular react-19.3 adapter\'s exact-minor rejection unchanged', () =>
    {
        const failure = failureOf(() => withReact(React19Adapter, '19.4.0').checkEnvironment());

        expect((failure as Error).name).toBe('CompatibilityError');
        expect((failure as { code?: string; actual?: unknown }).code).toBe('UNSUPPORTED_TUPLE');
        expect((failure as Error).message).toContain('@pixi-react-provisional/react-19.4');
    });
});
