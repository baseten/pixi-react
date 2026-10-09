import { createRef } from 'react';
import { expect } from 'vitest';
import { defineScenario } from '../scenario';
import { childLabels, getByLabel, reportedErrors } from './helpers';

export const propScenarios = [
    defineScenario({
        id: 'extend.custom-constructor',
        feature: 'extend',
        title: 'renders a custom constructor registered with extend',
        expected: 'After `extend({ Name: Ctor })`, the element for `Name` constructs `Ctor` and mounts it.',
        async run({ api, composition, probe, journal, mountApp })
        {
            const Custom = probe.customClass();

            api.extend({ ConformanceWidget: Custom });
            const Widget = composition.elementFor('ConformanceWidget');
            const { stage } = await mountApp(<Widget label="w" />);
            const node = getByLabel(probe, stage, 'w');

            expect(node, 'instance of the registered constructor').toBeInstanceOf(Custom);
            expect(journal.constructed('custom'), 'custom constructions').toEqual([node]);
        },
    }),
    defineScenario({
        id: 'extend.unknown-element',
        feature: 'extend',
        title: 'rendering an unregistered element reports an error naming it',
        expected: 'An element whose name was never registered constructs nothing and reports an error naming it.',
        async run(ctx)
        {
            const { composition, mountApp, journal } = ctx;
            const Unknown = composition.elementFor('ConformanceNeverExtended');
            const mounted = await mountApp(null);
            const constructedBefore = journal.of('construct').length;
            const errors = await reportedErrors(ctx, () => mounted.rerender(<Unknown label="nope" />));

            expect(errors.some((message) => message.includes('ConformanceNeverExtended')), 'error names the element')
                .toBe(true);
            expect(journal.of('construct').length, 'constructions').toBe(constructedBefore);
        },
    }),
    defineScenario({
        id: 'extend.multi-root-catalog',
        feature: 'extend',
        title: 'a registration is available to every root of the composition',
        expected: 'A name registered once with `extend` renders in two separate Applications.',
        async run({ api, composition, probe, renderUntil, deferred })
        {
            const Custom = probe.customClass();

            api.extend({ ConformanceShared: Custom });
            const Shared = composition.elementFor('ConformanceShared');
            const { Application } = api;
            const first = deferred<unknown>();
            const second = deferred<unknown>();

            await renderUntil(
                <>
                    <Application {...composition.appOptions} onInit={first.resolve}><Shared label="one" /></Application>
                    <Application {...composition.appOptions} onInit={second.resolve}><Shared label="two" /></Application>
                </>,
                Promise.all([first.promise, second.promise]),
            );

            expect(childLabels(probe, probe.stage(await first.promise)), 'first app').toEqual(['one']);
            expect(childLabels(probe, probe.stage(await second.promise)), 'second app').toEqual(['two']);
        },
    }),
    defineScenario({
        id: 'extend.replace-name',
        feature: 'extend',
        kind: 'parity',
        title: 'extending an existing name with another constructor silently replaces it',
        expected: 'Upstream replaces the registration; new elements use the new constructor (D4 keeps this in the facade).',
        async run({ api, composition, probe, mountApp })
        {
            const First = probe.customClass();
            const Second = probe.customClass();

            api.extend({ ConformanceReplaced: First });
            api.extend({ ConformanceReplaced: Second });
            const Replaced = composition.elementFor('ConformanceReplaced');
            const { stage } = await mountApp(<Replaced label="r" />);

            expect(getByLabel(probe, stage, 'r'), 'constructed with the latest registration').toBeInstanceOf(Second);
        },
    }),
    defineScenario({
        id: 'useExtend.registers',
        feature: 'useExtend',
        title: 'useExtend registers constructors before its component renders them',
        expected: 'A component calling `useExtend` can render the registered element in the same render.',
        async run({ api, composition, probe, mountApp })
        {
            const Custom = probe.customClass();
            const catalog = { ConformanceHooked: Custom };
            const Hooked = composition.elementFor('ConformanceHooked');
            const Child = () =>
            {
                api.useExtend(catalog);

                return <Hooked label="hooked" />;
            };
            const { stage } = await mountApp(<Child />);

            expect(getByLabel(probe, stage, 'hooked'), 'hooked node').toBeInstanceOf(Custom);
        },
    }),
    defineScenario({
        id: 'constructor-options.props',
        feature: 'constructor-options',
        title: 'passes props to the constructor as one options object',
        expected: 'The constructor receives the element props (minus children, key and ref) as its first argument.',
        async run({ api, composition, probe, journal, mountApp })
        {
            const Custom = probe.customClass();

            api.extend({ ConformanceOptions: Custom });
            const Element = composition.elementFor('ConformanceOptions');
            const ref = createRef<unknown>();
            const { stage } = await mountApp(<Element key="k" ref={ref} label="o" alpha={0.5} x={3} />);
            const [options] = journal.argsOf(getByLabel(probe, stage, 'o')) ?? [];

            expect(options, 'constructor options').toMatchObject({ label: 'o', alpha: 0.5, x: 3 });
            expect(Object.keys(options as object), 'React-reserved keys').not.toEqual(
                expect.arrayContaining(['children']),
            );
            expect(options as object, 'no key').not.toHaveProperty('key');
            expect(options as object, 'no ref').not.toHaveProperty('ref');
        },
    }),
    defineScenario({
        id: 'constructor-options.event-and-draw-keys',
        feature: 'constructor-options',
        kind: 'parity',
        title: 'event props reach the constructor under both names; draw does not',
        expected: 'Upstream passes `onPointerTap` and its Pixi name `onpointertap` to the constructor and omits `draw`.',
        async run({ api, composition, probe, journal, mountApp })
        {
            const Custom = probe.customClass();

            api.extend({ ConformanceEventOptions: Custom });
            const Element = composition.elementFor('ConformanceEventOptions');
            const onPointerTap = () => undefined;
            const draw = () => undefined;
            const { stage } = await mountApp(<Element label="e" onPointerTap={onPointerTap} draw={draw} />);
            const [options] = journal.argsOf(getByLabel(probe, stage, 'e')) ?? [];

            expect(options, 'event keys').toMatchObject({ onPointerTap, onpointertap: onPointerTap });
            expect(options as object, 'draw').not.toHaveProperty('draw');
        },
    }),
    defineScenario({
        id: 'props.removal.restores-default',
        feature: 'props.removal',
        title: 'removing a prop restores the kind default',
        expected: 'Removing `alpha` and `x` restores them to the defaults of a freshly constructed node.',
        async run({ elements: { sprite: Sprite }, mountApp, probe })
        {
            const mounted = await mountApp(<Sprite label="s" alpha={0.5} x={10} />);
            const node = getByLabel(probe, mounted.stage, 's');

            await mounted.rerender(<Sprite label="s" />);

            expect(probe.get(node, 'alpha'), 'alpha').toBe(1);
            expect(probe.get(node, 'x'), 'x').toBe(0);
        },
    }),
    defineScenario({
        id: 'props.removal.custom-initial-value',
        feature: 'props.removal',
        title: 'removing a prop restores a custom class initial value',
        expected: 'For a class whose constructor sets `alpha` to 0.25, removing `alpha` restores 0.25.',
        async run({ api, composition, probe, mountApp })
        {
            const Base = probe.customClass();
            const Custom = class extends Base
            {
                constructor(...args: any[])
                {
                    super(...args);
                    (this as unknown as { alpha: number }).alpha = 0.25;
                }
            };

            api.extend({ ConformanceInitial: Custom });
            const Element = composition.elementFor('ConformanceInitial');
            const mounted = await mountApp(<Element label="c" alpha={0.75} />);
            const node = getByLabel(probe, mounted.stage, 'c');

            expect(probe.get(node, 'alpha'), 'alpha while set').toBe(0.75);

            await mounted.rerender(<Element label="c" />);

            expect(probe.get(node, 'alpha'), 'alpha after removal').toBe(0.25);
        },
    }),
    defineScenario({
        id: 'props.removal.required-constructor-argument',
        feature: 'props.removal',
        title: 'removing a prop never constructs a custom class without its arguments',
        expected: 'Prop removal on a class that requires a constructor argument restores the value without an error.',
        async run(ctx)
        {
            const { api, composition, probe, mountApp } = ctx;
            const Strict = probe.customClass({ requiredArgument: true });

            api.extend({ ConformanceStrict: Strict });
            const Element = composition.elementFor('ConformanceStrict');
            const mounted = await mountApp(<Element label="strict" alpha={0.5} />);
            const node = getByLabel(probe, mounted.stage, 'strict');
            const errors = await reportedErrors(ctx, () => mounted.rerender(<Element label="strict" />));

            expect(errors.join(' | '), 'errors during prop removal').toBe('');
            expect(probe.isDestroyed(node), 'node destroyed by a failed commit').toBe(false);
            expect(probe.get(node, 'alpha'), 'alpha after removal').toBe(1);
        },
    }),
    defineScenario({
        id: 'props.dashed.mount',
        feature: 'props.dashed',
        title: 'dashed props set nested fields on mount',
        expected: '`position-x` and `scale-y` on the first render set `position.x` and `scale.y`.',
        async run({ elements: { container: Container }, mountApp, probe })
        {
            const { stage } = await mountApp(<Container label="d" position-x={10} scale-y={2} />);
            const node = getByLabel(probe, stage, 'd');

            expect(probe.get(node, 'position.x'), 'position.x').toBe(10);
            expect(probe.get(node, 'scale.y'), 'scale.y').toBe(2);
            expect(probe.get(node, 'scale.x'), 'scale.x').toBe(1);
        },
    }),
    defineScenario({
        id: 'props.dashed.update',
        feature: 'props.dashed',
        title: 'dashed props set nested fields on update',
        expected: 'Adding or changing `position-x` / `scale-y` in a rerender sets only those nested fields.',
        async run({ elements: { container: Container }, mountApp, probe })
        {
            const mounted = await mountApp(<Container label="d" />);
            const node = getByLabel(probe, mounted.stage, 'd');

            await mounted.rerender(<Container label="d" position-x={10} scale-y={2} />);

            expect(probe.get(node, 'position.x'), 'position.x').toBe(10);
            expect(probe.get(node, 'scale.y'), 'scale.y').toBe(2);
            expect(probe.get(node, 'scale.x'), 'scale.x').toBe(1);

            await mounted.rerender(<Container label="d" position-x={20} scale-y={2} />);

            expect(probe.get(node, 'position.x'), 'position.x after second update').toBe(20);
        },
    }),
    defineScenario({
        id: 'props.dashed.removal',
        feature: 'props.dashed',
        title: 'removing a dashed prop resets the nested field',
        expected: 'Removing `position-x` resets `position.x` to 0 and leaves `position.y` alone.',
        async run({ elements: { container: Container }, mountApp, probe })
        {
            // The values are applied by an update so this scenario only depends on removal semantics.
            const mounted = await mountApp(<Container label="d" />);
            const node = getByLabel(probe, mounted.stage, 'd');

            await mounted.rerender(<Container label="d" position-x={10} position-y={4} />);
            await mounted.rerender(<Container label="d" position-y={4} />);

            expect(probe.get(node, 'position.x'), 'position.x').toBe(0);
            expect(probe.get(node, 'position.y'), 'position.y').toBe(4);
        },
    }),
    defineScenario({
        id: 'props.point',
        feature: 'props.dashed',
        title: 'point props accept point-like objects',
        expected: '`position={{ x, y }}` and `scale={{ x, y }}` copy both coordinates.',
        async run({ elements: { container: Container }, mountApp, probe })
        {
            const mounted = await mountApp(<Container label="p" position={{ x: 3, y: 4 }} scale={{ x: 2, y: 5 }} />);
            const node = getByLabel(probe, mounted.stage, 'p');

            expect([probe.get(node, 'position.x'), probe.get(node, 'position.y')], 'position').toEqual([3, 4]);
            expect([probe.get(node, 'scale.x'), probe.get(node, 'scale.y')], 'scale').toEqual([2, 5]);

            await mounted.rerender(<Container label="p" position={{ x: 6, y: 7 }} scale={{ x: 2, y: 5 }} />);

            expect([probe.get(node, 'position.x'), probe.get(node, 'position.y')], 'position after update').toEqual([6, 7]);
        },
    }),
    defineScenario({
        id: 'props.dashed.after-point',
        feature: 'props.dashed',
        title: 'a dashed prop wins over its parent point prop when both change',
        expected: 'With `position` and `position-x`, changing `position` re-applies `position-x` afterwards.',
        async run({ elements: { container: Container }, mountApp, probe })
        {
            const mounted = await mountApp(<Container label="p" position={{ x: 1, y: 2 }} position-x={10} />);
            const node = getByLabel(probe, mounted.stage, 'p');

            expect([probe.get(node, 'position.x'), probe.get(node, 'position.y')], 'initial').toEqual([10, 2]);

            await mounted.rerender(<Container label="p" position={{ x: 5, y: 6 }} position-x={10} />);

            expect([probe.get(node, 'position.x'), probe.get(node, 'position.y')], 'after update').toEqual([10, 6]);
        },
    }),
    defineScenario({
        id: 'events.add',
        feature: 'events',
        title: 'an event prop receives scene events',
        expected: '`onPointerTap` is called once per dispatched `pointertap` event.',
        async run({ elements: { sprite: Sprite }, mountApp, probe, dispatch })
        {
            const calls: unknown[] = [];
            const { app, stage } = await mountApp(
                <Sprite label="e" eventMode="static" onPointerTap={(event: unknown) => calls.push(event)} />,
            );

            await dispatch(app, getByLabel(probe, stage, 'e'), 'pointertap');

            expect(calls.length, 'handler calls').toBe(1);
        },
    }),
    defineScenario({
        id: 'events.replace',
        feature: 'events',
        title: 'replacing an event handler detaches the previous one',
        expected: 'After a rerender with a new handler only the new handler is called.',
        async run({ elements: { sprite: Sprite }, mountApp, probe, dispatch })
        {
            const calls: string[] = [];
            const mounted = await mountApp(<Sprite label="e" eventMode="static" onPointerTap={() => calls.push('first')} />);
            const node = getByLabel(probe, mounted.stage, 'e');

            await mounted.rerender(<Sprite label="e" eventMode="static" onPointerTap={() => calls.push('second')} />);
            await dispatch(mounted.app, node, 'pointertap');

            expect(calls, 'handler calls').toEqual(['second']);
        },
    }),
    defineScenario({
        id: 'events.remove',
        feature: 'events',
        title: 'removing an event prop detaches the handler',
        expected: 'After a rerender without the handler, dispatching the event calls nothing.',
        async run({ elements: { sprite: Sprite }, mountApp, probe, dispatch })
        {
            const calls: string[] = [];
            const mounted = await mountApp(<Sprite label="e" eventMode="static" onPointerTap={() => calls.push('tap')} />);
            const node = getByLabel(probe, mounted.stage, 'e');

            await dispatch(mounted.app, node, 'pointertap');
            await mounted.rerender(<Sprite label="e" eventMode="static" />);
            await dispatch(mounted.app, node, 'pointertap');

            expect(calls, 'handler calls').toEqual(['tap']);
        },
    }),
    defineScenario({
        id: 'draw.mount',
        feature: 'draw',
        title: 'draw runs once on mount with the graphics node',
        expected: 'The `draw` callback is called exactly once, with the mounted graphics node.',
        async run({ elements: { graphics: Graphics }, mountApp, probe })
        {
            const calls: unknown[] = [];
            const { stage } = await mountApp(<Graphics label="g" draw={(graphics: unknown) => calls.push(graphics)} />);

            expect(calls, 'draw calls').toEqual([getByLabel(probe, stage, 'g')]);
        },
    }),
    defineScenario({
        id: 'draw.update',
        feature: 'draw',
        title: 'draw reruns only when the callback identity changes',
        expected: 'A rerender with the same callback does not redraw; a new callback draws the same node once.',
        async run({ elements: { graphics: Graphics }, mountApp, probe, journal })
        {
            const calls: string[] = [];
            const first = () => calls.push('first');
            const second = () => calls.push('second');
            const mounted = await mountApp(<Graphics label="g" draw={first} />);
            const node = getByLabel(probe, mounted.stage, 'g');

            await mounted.rerender(<Graphics label="g" draw={first} alpha={0.5} />);
            await mounted.rerender(<Graphics label="g" draw={second} alpha={0.5} />);

            expect(calls, 'draw calls').toEqual(['first', 'second']);
            expect(getByLabel(probe, mounted.stage, 'g'), 'same node').toBe(node);
            expect(journal.constructed('graphics').length, 'graphics constructed').toBe(1);
        },
    }),
    defineScenario({
        id: 'text.update',
        feature: 'text',
        title: 'text content updates in place',
        expected: 'Changing `text` updates the same text node.',
        async run({ elements: { text: Text }, mountApp, probe, journal })
        {
            const mounted = await mountApp(<Text label="t" text="first" />);
            const node = getByLabel(probe, mounted.stage, 't');

            expect(probe.get(node, 'text'), 'initial text').toBe('first');

            await mounted.rerender(<Text label="t" text="second" />);

            expect(probe.get(node, 'text'), 'updated text').toBe('second');
            expect(journal.constructed('text'), 'text nodes constructed').toEqual([node]);
        },
    }),
    defineScenario({
        id: 'text.style',
        feature: 'text',
        title: 'text style updates in place',
        expected: 'Changing `style` updates the font size of the same text node.',
        async run({ elements: { text: Text }, mountApp, probe })
        {
            const mounted = await mountApp(<Text label="t" text="styled" style={{ fontSize: 20 }} />);
            const node = getByLabel(probe, mounted.stage, 't');

            expect(probe.get(node, 'style.fontSize'), 'initial font size').toBe(20);

            await mounted.rerender(<Text label="t" text="styled" style={{ fontSize: 30 }} />);

            expect(probe.get(node, 'style.fontSize'), 'updated font size').toBe(30);
        },
    }),
    defineScenario({
        id: 'applyProps.direct',
        feature: 'applyProps',
        title: 'applyProps sets plain and dashed props on a node',
        expected: '`applyProps(node, { alpha, "position-y" })` sets both fields on the node.',
        async run({ api, elements: { container: Container }, mountApp, probe })
        {
            const { stage } = await mountApp(<Container label="a" />);
            const node = getByLabel(probe, stage, 'a');

            api.applyProps(node, { alpha: 0.5, 'position-y': 9 });

            expect(probe.get(node, 'alpha'), 'alpha').toBe(0.5);
            expect(probe.get(node, 'position.y'), 'position.y').toBe(9);
        },
    }),
];
