import { createRef, Suspense } from 'react';
import { expect } from 'vitest';
import { defineScenario } from '../scenario';
import { childLabels, createSuspender, getByLabel, reportedErrors } from './helpers';

export const treeScenarios = [
    defineScenario({
        id: 'elements.mount',
        feature: 'elements',
        title: 'mounts a nested tree into the stage',
        expected: 'Each element constructs one node of its kind; the scene tree mirrors the JSX tree.',
        async run({ elements: { container: Container, sprite: Sprite, graphics: Graphics }, mountApp, probe, journal })
        {
            const { stage } = await mountApp(
                <Container label="root">
                    <Sprite label="a" />
                    <Graphics label="b" />
                </Container>,
            );

            expect(childLabels(probe, stage), 'stage children').toEqual(['root']);
            const root = getByLabel(probe, stage, 'root');

            expect(childLabels(probe, root), 'root children').toEqual(['a', 'b']);
            expect(probe.parent(getByLabel(probe, stage, 'a')), 'parent of a').toBe(root);
            expect(journal.constructed('container').length, 'containers constructed').toBe(1);
            expect(journal.constructed('sprite').length, 'sprites constructed').toBe(1);
            expect(journal.constructed('graphics').length, 'graphics constructed').toBe(1);
        },
    }),
    defineScenario({
        id: 'elements.update',
        feature: 'elements',
        title: 'updates props in place without reconstructing',
        expected: 'Changed props are applied to the same node; no node is constructed or destroyed.',
        async run({ elements: { sprite: Sprite }, mountApp, probe, journal })
        {
            const mounted = await mountApp(<Sprite label="a" alpha={0.5} x={1} />);
            const node = getByLabel(probe, mounted.stage, 'a');
            const constructedBefore = journal.of('construct').length;

            await mounted.rerender(<Sprite label="a" alpha={0.25} x={7} />);

            expect(getByLabel(probe, mounted.stage, 'a'), 'node identity').toBe(node);
            expect(probe.get(node, 'alpha'), 'alpha').toBe(0.25);
            expect(probe.get(node, 'x'), 'x').toBe(7);
            expect(journal.of('construct').length, 'constructions after update').toBe(constructedBefore);
            expect(journal.destroyCount(node), 'destroy count').toBe(0);
        },
    }),
    defineScenario({
        id: 'elements.reorder',
        feature: 'elements',
        title: 'reorders keyed children without reconstructing them',
        expected: 'Scene order follows the new key order; every node keeps its identity and is not destroyed.',
        async run({ elements: { container: Container }, mountApp, probe, journal })
        {
            const list = (keys: string[]) => (
                <Container label="list">
                    {keys.map((key) => <Container key={key} label={key} />)}
                </Container>
            );
            const mounted = await mountApp(list(['a', 'b', 'c']));
            const parent = getByLabel(probe, mounted.stage, 'list');
            const before = probe.children(parent);

            await mounted.rerender(list(['c', 'a', 'b']));

            expect(childLabels(probe, parent), 'order after reorder').toEqual(['c', 'a', 'b']);
            const after = probe.children(parent);

            expect(after.length, 'child count').toBe(before.length);
            after.forEach((node) => expect(before, `identity of ${probe.label(node)}`).toContain(node));
            expect(journal.of('destroy').length, 'destroyed nodes').toBe(0);
            expect(journal.constructed('container').length, 'constructed containers').toBe(4);
        },
    }),
    defineScenario({
        id: 'elements.insert',
        feature: 'elements',
        title: 'inserts a new child between existing siblings',
        expected: 'The new node is constructed once and placed at its JSX position.',
        async run({ elements: { container: Container }, mountApp, probe, journal })
        {
            const list = (keys: string[]) => (
                <Container label="list">
                    {keys.map((key) => <Container key={key} label={key} />)}
                </Container>
            );
            const mounted = await mountApp(list(['a', 'c']));

            await mounted.rerender(list(['a', 'b', 'c']));

            expect(childLabels(probe, getByLabel(probe, mounted.stage, 'list')), 'order').toEqual(['a', 'b', 'c']);
            expect(journal.constructed('container').length, 'constructed containers').toBe(4);
        },
    }),
    defineScenario({
        id: 'elements.remove',
        feature: 'elements',
        title: 'removes a child and destroys it once',
        expected: 'The removed node is detached and destroyed exactly once; its siblings are untouched.',
        async run({ elements: { container: Container }, mountApp, probe, journal })
        {
            const list = (keys: string[]) => (
                <Container label="list">
                    {keys.map((key) => <Container key={key} label={key} />)}
                </Container>
            );
            const mounted = await mountApp(list(['a', 'b', 'c']));
            const parent = getByLabel(probe, mounted.stage, 'list');
            const removed = getByLabel(probe, parent, 'b');

            await mounted.rerender(list(['a', 'c']));

            expect(childLabels(probe, parent), 'remaining children').toEqual(['a', 'c']);
            expect(probe.parent(removed) ?? null, 'parent of removed node').toBeNull();
            expect(journal.destroyCount(removed), 'destroy count of removed node').toBe(1);
            expect(journal.of('destroy').length, 'total destroyed').toBe(1);
        },
    }),
    defineScenario({
        id: 'elements.type-change',
        feature: 'elements',
        title: 'replaces a node when its element type changes',
        expected: 'The old node is destroyed once; a node of the new kind takes its place.',
        async run({ elements: { container: Container, sprite: Sprite, graphics: Graphics }, mountApp, probe, journal })
        {
            const mounted = await mountApp(<Container label="p"><Sprite label="x" /></Container>);
            const parent = getByLabel(probe, mounted.stage, 'p');
            const old = getByLabel(probe, parent, 'x');

            await mounted.rerender(<Container label="p"><Graphics label="x" /></Container>);

            const replacement = getByLabel(probe, parent, 'x');

            expect(replacement, 'replacement node').not.toBe(old);
            expect(journal.constructed('graphics'), 'graphics constructed').toEqual([replacement]);
            expect(journal.destroyCount(old), 'destroy count of old node').toBe(1);
        },
    }),
    defineScenario({
        id: 'destruction.once',
        feature: 'destruction',
        title: 'destroys every removed top-level node exactly once',
        expected: 'Removing several siblings destroys each of them exactly once, never twice.',
        async run({ elements: { sprite: Sprite, text: Text }, mountApp, probe, journal })
        {
            const mounted = await mountApp(<><Sprite label="a" /><Text label="b" text="b" /><Sprite label="c" /></>);
            const nodes = ['a', 'b', 'c'].map((label) => getByLabel(probe, mounted.stage, label));

            await mounted.rerender(null);

            for (const node of nodes)
            {
                expect(journal.destroyCount(node), `destroy count of ${probe.label(node)}`).toBe(1);
            }
            expect(probe.children(mounted.stage), 'stage children').toEqual([]);
        },
    }),
    defineScenario({
        id: 'destruction.nested',
        feature: 'destruction',
        title: 'destroys renderer-owned descendants when an ancestor is removed',
        expected: 'Removing a container destroys it and each renderer-owned descendant exactly once.',
        async run({ elements: { container: Container, sprite: Sprite, text: Text }, mountApp, probe, journal })
        {
            const mounted = await mountApp(
                <Container label="outer">
                    <Container label="inner">
                        <Sprite label="leaf" />
                    </Container>
                    <Text label="caption" text="caption" />
                </Container>,
            );
            const nodes = ['outer', 'inner', 'leaf', 'caption'].map((label) => getByLabel(probe, mounted.stage, label));

            await mounted.rerender(null);

            const counts = Object.fromEntries(nodes.map((node) => [probe.label(node), journal.destroyCount(node)]));

            expect(counts, 'destroy count per node').toEqual({ outer: 1, inner: 1, leaf: 1, caption: 1 });
        },
    }),
    defineScenario({
        id: 'destruction.app-unmount',
        feature: 'destruction',
        title: 'unmounting the Application destroys the app and its top-level nodes once',
        expected: 'The application is destroyed exactly once; each top-level node exactly once.',
        async run({ elements: { sprite: Sprite }, mountApp, probe, journal, unmount })
        {
            const { app, stage } = await mountApp(<><Sprite label="a" /><Sprite label="b" /></>);
            const nodes = probe.children(stage) as object[];

            await unmount();

            expect(journal.appDestroyCount(app as object), 'app destroy count').toBe(1);
            expect(probe.isAppDestroyed(app), 'app destroyed').toBe(true);
            expect(nodes.map((node) => journal.destroyCount(node)), 'node destroy counts').toEqual([1, 1]);
        },
    }),
    defineScenario({
        id: 'destruction.app-unmount-nested',
        feature: 'destruction',
        title: 'unmounting the Application destroys nested renderer-owned nodes',
        expected: 'Every renderer-owned node, nested or not, is destroyed exactly once on Application unmount.',
        async run({ elements: { container: Container, sprite: Sprite }, mountApp, probe, journal, unmount })
        {
            await mountApp(<Container label="outer"><Sprite label="leaf" /></Container>);
            const nodes = journal.constructed().filter((node) => probe.label(node) !== undefined);

            await unmount();

            const counts = Object.fromEntries(nodes.map((node) => [probe.label(node), journal.destroyCount(node)]));

            expect(counts, 'destroy count per node').toEqual({ outer: 1, leaf: 1 });
        },
    }),
    defineScenario({
        id: 'refs.object',
        feature: 'refs',
        title: 'object refs point at the scene node and clear on removal',
        expected: '`ref.current` is the mounted node while mounted and `null` after removal.',
        async run({ elements: { sprite: Sprite }, mountApp, probe })
        {
            const ref = createRef<unknown>();
            const mounted = await mountApp(<Sprite ref={ref} label="a" />);

            expect(ref.current, 'ref while mounted').toBe(getByLabel(probe, mounted.stage, 'a'));

            await mounted.rerender(null);

            expect(ref.current, 'ref after removal').toBeNull();
        },
    }),
    defineScenario({
        id: 'refs.callback',
        feature: 'refs',
        title: 'callback refs receive the node once and null once',
        expected: 'A stable callback ref is called with the node on mount and with `null` on removal.',
        async run({ elements: { sprite: Sprite }, mountApp, probe })
        {
            const calls: unknown[] = [];
            const ref = (value: unknown) =>
            {
                calls.push(value);
            };
            const mounted = await mountApp(<Sprite ref={ref} label="a" />);
            const node = getByLabel(probe, mounted.stage, 'a');

            await mounted.rerender(<Sprite ref={ref} label="a" alpha={0.5} />);
            await mounted.rerender(null);

            expect(calls, 'ref calls').toEqual([node, null]);
        },
    }),
    defineScenario({
        id: 'suspense.hide-unhide',
        feature: 'suspense',
        title: 'hides committed nodes while suspended and restores them',
        expected: 'Already committed siblings are hidden while a boundary shows its fallback and visible again after.',
        async run({ elements: { container: Container }, mountApp, probe, act })
        {
            const resource = createSuspender();
            const Suspending = () =>
            {
                resource.read();

                return <Container label="loaded" />;
            };
            const tree = (marker: number) => (
                <Suspense fallback={<Container label="fallback" />}>
                    <Container label="kept" />
                    <Suspending key={marker} />
                </Suspense>
            );
            const mounted = await mountApp(tree(0));
            const kept = getByLabel(probe, mounted.stage, 'kept');

            resource.suspend();
            await mounted.rerender(tree(1));

            expect(probe.get(kept, 'visible'), 'kept visible while suspended').toBe(false);

            await act(() => resource.resolve());

            expect(probe.get(kept, 'visible'), 'kept visible after resolve').toBe(true);
            expect(probe.get(getByLabel(probe, mounted.stage, 'loaded'), 'visible'), 'loaded visible').toBe(true);
        },
    }),
    defineScenario({
        id: 'suspense.unhide-keeps-user-visibility',
        feature: 'suspense',
        title: 'unhiding restores the latest committed visible value',
        expected: 'A node rendered with `visible={false}` stays invisible after its boundary resolves.',
        async run({ elements: { container: Container }, mountApp, probe, act })
        {
            const resource = createSuspender();
            const Suspending = () =>
            {
                resource.read();

                return null;
            };
            const tree = (marker: number) => (
                <Suspense fallback={null}>
                    <Container label="hidden-by-user" visible={false} />
                    <Suspending key={marker} />
                </Suspense>
            );
            const mounted = await mountApp(tree(0));
            const node = getByLabel(probe, mounted.stage, 'hidden-by-user');

            resource.suspend();
            await mounted.rerender(tree(1));
            await act(() => resource.resolve());

            expect(probe.get(node, 'visible'), 'user visibility after unhide').toBe(false);
        },
    }),
    defineScenario({
        id: 'raw-text.rejected',
        feature: 'raw-text',
        title: 'a raw JSX string child is rejected with guidance',
        expected: 'Rendering a bare string inside the scene reports an error that points to a text component.',
        async run(ctx)
        {
            const { elements: { container: Container }, mountApp, probe } = ctx;
            const mounted = await mountApp(<Container label="ok" />);
            const errors = await reportedErrors(ctx, () => mounted.rerender(<Container label="parent">raw string</Container>));

            expect(errors.some((message) => (/text/i).test(message)), `reported errors: ${errors.join(' | ')}`).toBe(true);
            expect(childLabels(probe, mounted.stage), 'no partial tree with raw text').not.toContain('parent');
        },
    }),
];
