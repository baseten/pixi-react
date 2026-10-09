import { describe, expect, it } from 'vitest';
import { type CompatibilityError, type RootRecord, type Runtime } from '../src/index.js';
import { composeFake, FakeFilter, FakeNode, FakePixiAdapter, type FakePixiTypes, type PixiLogEntry, readyRoot } from './fakes.js';

async function setup(pixi = new FakePixiAdapter())
{
    const runtime = composeFake(pixi);

    runtime.registry.extend({ Node: FakeNode, Filter: FakeFilter });

    const root = await readyRoot(runtime);
    const node = (label: string) => root.pixi.create('Node', { label }) as FakeNode;

    return { pixi, runtime, root, node, stage: root.session.container as FakeNode };
}

const destroyed = (log: PixiLogEntry[]) => log
    .filter((entry): entry is Extract<PixiLogEntry, { op: 'destroyNode' }> => entry.op === 'destroyNode')
    .map((entry) => (entry.node as FakeNode).props.label);

function codeOf(action: () => unknown): string | undefined
{
    try
    {
        action();
    }
    catch (error)
    {
        return (error as CompatibilityError).code;
    }

    return undefined;
}

describe('Pixi bridge', () =>
{
    it('constructs only through the session, with the root context', async () =>
    {
        const { pixi, runtime, root, node } = await setup();
        const created = node('a');
        const entry = pixi.log.find((item) => item.op === 'create');

        expect(entry).toMatchObject({ op: 'create', node: created, name: 'Node' });
        expect(entry?.op === 'create' && entry.context).toEqual({ app: root.app, runtime, root });
    });

    it('keeps node metadata in a WeakMap: nothing is written onto the node', async () =>
    {
        const { runtime, root, node, stage } = await setup();
        const created = node('a');
        const keys = Reflect.ownKeys(created);

        root.pixi.append(stage, created);
        root.pixi.setHidden(created, true);

        expect(Reflect.ownKeys(created)).toEqual(keys);
        expect(Object.getOwnPropertySymbols(created)).toEqual([]);
        expect(runtime.nodeInfo(created)).toMatchObject({ root, parent: stage, hidden: true, destroyed: false });
        expect(runtime.nodeInfo(new FakeNode())).toBeUndefined();
    });

    it('destroys a removed subtree after the commit, children first, each node once, with no options', async () =>
    {
        const { pixi, root, node, stage } = await setup();
        const parent = node('parent');
        const child = node('child');
        const grandchild = node('grandchild');

        root.pixi.append(stage, parent);
        root.pixi.append(parent, child);
        root.pixi.append(child, grandchild);
        root.pixi.remove(stage, parent);

        expect(destroyed(pixi.log)).toEqual([]);

        root.pixi.flush();
        root.pixi.flush();

        expect(destroyed(pixi.log)).toEqual(['grandchild', 'child', 'parent']);
        expect(pixi.log.filter((entry) => entry.op === 'destroyNode').map((entry) => 'options' in entry && entry.options))
            .toEqual([undefined, undefined, undefined]);
        expect(codeOf(() => root.pixi.append(stage, parent))).toBe('UNSUPPORTED_NODE');
    });

    it('a node moved back into the tree before the flush is not destroyed', async () =>
    {
        const { pixi, root, node, stage } = await setup();
        const a = node('a');
        const b = node('b');

        root.pixi.append(stage, a);
        root.pixi.append(stage, b);
        root.pixi.remove(stage, a);
        root.pixi.insertBefore(stage, a, b);
        root.pixi.flush();

        expect(destroyed(pixi.log)).toEqual([]);
        expect(stage.children.map((item) => item.props.label)).toEqual(['a', 'b']);
    });

    it('reparenting moves without destroying', async () =>
    {
        const { pixi, runtime, root, node, stage } = await setup();
        const first = node('first');
        const second = node('second');
        const moved = node('moved');

        root.pixi.append(stage, first);
        root.pixi.append(stage, second);
        root.pixi.append(first, moved);
        root.pixi.append(second, moved);
        root.pixi.remove(stage, first);
        root.pixi.flush();

        expect(destroyed(pixi.log)).toEqual(['first']);
        expect(runtime.nodeInfo(moved)?.parent).toBe(second);
    });

    it('rejects attach-rule violations before any mutation', async () =>
    {
        const { pixi, root, node, stage } = await setup();
        const filter = root.pixi.create('Filter', {});
        const parent = node('parent');
        const before = pixi.log.length;

        // The container accepts only `child` roles; a filter accepts no children.
        expect(codeOf(() => root.pixi.append(stage, filter))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.pixi.append(filter, parent))).toBe('UNSUPPORTED_NODE');
        expect(pixi.log.length).toBe(before);

        root.pixi.append(stage, parent);
        root.pixi.append(parent, filter);
        expect(codeOf(() => root.pixi.append(parent, stage))).toBe('UNSUPPORTED_NODE');
    });

    it('rejects cycles and mismatched reference nodes', async () =>
    {
        const { root, node, stage } = await setup();
        const parent = node('parent');
        const child = node('child');
        const stranger = node('stranger');

        root.pixi.append(stage, parent);
        root.pixi.append(parent, child);

        expect(codeOf(() => root.pixi.append(child, parent))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.pixi.insertBefore(stage, stranger, child))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.pixi.remove(stage, child))).toBe('UNSUPPORTED_NODE');
    });

    it('validates node capabilities before the first construction', async () =>
    {
        const pixi = new FakePixiAdapter({ nodeCapabilities: { 'pixi.particles': 1 } });
        const runtime = composeFake(pixi);

        runtime.registry.extend({ Particle: FakeNode });

        const root = await readyRoot(runtime);
        let error: CompatibilityError | undefined;

        try
        {
            root.pixi.create('Particle', {});
        }
        catch (caught)
        {
            error = caught as CompatibilityError;
        }

        expect(error?.code).toBe('UNSUPPORTED_NODE');
        expect(error?.capability).toBe('pixi.particles');
        expect(pixi.log.some((entry) => entry.op === 'create')).toBe(false);
    });

    it('requires a ready root to construct', async () =>
    {
        const runtime = composeFake();

        runtime.registry.extend({ Node: FakeNode });

        const root = runtime.createRoot(document.createElement('canvas'));

        expect(codeOf(() => root.pixi.create('Node', {}))).toBe('core.ROOT_NOT_READY');
        expect(codeOf(() => root.pixi.create('Unknown', {}))).toBe('core.ROOT_NOT_READY');
    });

    it('throws UNKNOWN_ELEMENT for unregistered types and foreign definitions', async () =>
    {
        const { root } = await setup();

        expect(codeOf(() => root.pixi.create('Missing', {}))).toBe('UNKNOWN_ELEMENT');
        expect(codeOf(() => root.pixi.create({ name: 'Node', ctor: FakeNode, capabilities: {}, attach: { role: 'child', accepts: [] } }, {})))
            .toBe('UNKNOWN_ELEMENT');
    });

    it('destroys every node still owned at teardown, with the root teardown options', async () =>
    {
        const { pixi, root, node, stage } = await setup();
        const attached = node('attached');
        const nested = node('nested');

        node('never-attached');
        root.pixi.append(stage, attached);
        root.pixi.append(attached, nested);

        await root.dispose({ reason: 'teardown' });

        expect(destroyed(pixi.log).sort()).toEqual(['attached', 'nested', 'never-attached']);
        expect(destroyed(pixi.log).indexOf('nested')).toBeLessThan(destroyed(pixi.log).indexOf('attached'));
        expect(pixi.log.filter((entry) => entry.op === 'destroyNode').every((entry) =>
            entry.op === 'destroyNode' && (entry.options as { reason: string }).reason === 'teardown')).toBe(true);
        // App destruction comes after every node.
        expect(pixi.log.at(-1)?.op).toBe('appDestroy');
    });

    it('removals made by React adapter teardown hooks use the teardown options and flush once', async () =>
    {
        const { pixi, root, node, stage } = await setup();
        const top = node('top');

        root.pixi.append(stage, top);
        root.onTeardown(() => root.pixi.remove(stage, top));

        await root.dispose({ reason: 'unmount' });

        expect(pixi.log.filter((entry) => entry.op === 'destroyNode')).toEqual([
            { op: 'destroyNode', node: top, options: { reason: 'unmount' } },
        ]);
    });

    it('ticker subscriptions are idempotent and released at teardown', async () =>
    {
        const { root } = await setup();
        const ticks: number[] = [];
        const unsubscribe = root.pixi.subscribe({ callback: (tick) => ticks.push(tick) });

        root.pixi.subscribe({ callback: (tick) => ticks.push(tick * 10) });
        expect(root.app.listeners.size).toBe(2);

        unsubscribe();
        unsubscribe();
        expect(root.app.listeners.size).toBe(1);

        await root.dispose();
        expect(root.app.listeners.size).toBe(0);
    });

    it('forwards updates, visibility, public instances and application props', async () =>
    {
        const { root, node, stage } = await setup();
        const created = node('a');

        root.pixi.append(stage, created);
        root.pixi.update(created, { label: 'a' }, { label: 'b' });
        root.pixi.setHidden(created, true);
        root.pixi.updateApplication({ label: 'app' });

        expect(created.props).toEqual({ label: 'b' });
        expect(created.hidden).toBe(true);
        expect(root.pixi.publicInstance(created)).toBe(created);
        expect((root.app as unknown as { label: string }).label).toBe('app');
    });
});

describe('ownership across roots', () =>
{
    async function twoRoots(): Promise<[Runtime<FakePixiTypes>, RootRecord<FakePixiTypes>, RootRecord<FakePixiTypes>]>
    {
        const runtime = composeFake();

        runtime.registry.extend({ Node: FakeNode });

        return [runtime, await readyRoot(runtime), await readyRoot(runtime)];
    }

    it('a node of one root cannot be used by another root of the same runtime', async () =>
    {
        const [, first, second] = await twoRoots();
        const node = first.pixi.create('Node', {});

        expect(codeOf(() => second.pixi.append(second.session.container, node))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => second.pixi.update(node, {}, {}))).toBe('UNSUPPORTED_NODE');
    });

    it('disposing one root leaves the other root, its app and its nodes untouched', async () =>
    {
        const [runtime, first, second] = await twoRoots();
        const kept = second.pixi.create('Node', { label: 'kept' });

        second.pixi.append(second.session.container, kept);
        await first.dispose();

        expect(second.status).toBe('ready');
        expect(runtime.nodeInfo(kept)?.destroyed).toBe(false);
        expect(runtime.roots()).toEqual([second]);
    });
});
