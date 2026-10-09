import { Container } from 'pixi.js';
import {
    describe,
    expect,
    it,
} from 'vitest';
import { applyProps } from '../../../src';

/** Upstream's `applyProps` types its instance as a renderer node; a plain Container needs a cast. */
const node = (container: Container) => container as unknown as Parameters<typeof applyProps>[0];

describe('applyProps', () =>
{
    describe('when given instance props', () =>
    {
        it('updates the target instance', () =>
        {
            expect(applyProps).toBeTypeOf('function');
            const instance = new Container();

            expect(instance.x).toEqual(0);

            const result = applyProps(node(instance), { x: 100 });

            expect(result).toEqual(instance);
            expect(instance.x).toEqual(100);
        });
    });

    describe('when given a diff set', () =>
    {
        it('updates the target instance', () =>
        {
            expect(applyProps).toBeTypeOf('function');
            const instance = new Container();

            expect(instance.x).toEqual(0);

            const result = applyProps(node(instance), {
                changes: [
                    [
                        'x',
                        100,
                        false,
                        [],
                    ],
                ],
            });

            expect(result).toEqual(instance);
            expect(instance.x).toEqual(100);
        });

        it('restores a removed prop to the value of a blank instance', () =>
        {
            const instance = new Container({ alpha: 0.5 });

            applyProps(node(instance), { changes: [['alpha', '__defaultremove', false, []]] });

            expect(instance.alpha).toEqual(1);
        });
    });
});
