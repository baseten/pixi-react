import {
    describe,
    expect,
    it,
} from 'vitest';
import * as PixiReact from '../../src/index';

describe('exports', () =>
{
    it('exports the `<Application>` component', () =>
    {
        expect(PixiReact).toHaveProperty('Application');
        expect(PixiReact.Application).toBeTypeOf('object');
    });

    it.each([
        'createRoot',
        'applyProps',
        'extend',
        'useApplication',
        'useExtend',
        'useTick',
    ] as const)('exports the `%s()` function', (name) =>
    {
        expect(PixiReact).toHaveProperty(name);
        expect(PixiReact[name]).toBeTypeOf('function');
    });

    it('doesn\'t export extraneous keys', () =>
    {
        expect(Object.keys(PixiReact).sort()).toEqual([
            'Application',
            'applyProps',
            'createRoot',
            'extend',
            'useApplication',
            'useExtend',
            'useTick',
        ]);
    });
});
