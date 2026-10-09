import { describe, expect, it } from 'vitest';
import { type CompatibilityError, type RootRecord, type Runtime } from '../src/index.js';
import { composeFake, FakeFilter, FakeNode, FakeSceneAdapter, type FakeSceneTypes, readyRoot, type SceneLogEntry } from './fakes.js';

async function setup(scene = new FakeSceneAdapter())
{
    const runtime = composeFake(scene);

    runtime.registry.extend({ Node: FakeNode, Filter: FakeFilter });

    const root = await readyRoot(runtime);
    const node = (label: string) => root.scene.create('Node', { label }) as FakeNode;

    return { scene, runtime, root, node, stage: root.session.container as FakeNode };
}

const destroyed = (log: SceneLogEntry[]) => log
    .filter((entry): entry is Extract<SceneLogEntry, { op: 'destroyNode' }> => entry.op === 'destroyNode')
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

describe('scene bridge', () =>
{
    it('constructs only through the session, with the root context', async () =>
    {
        const { scene, runtime, root, node } = await setup();
        const created = node('a');
        const entry = scene.log.find((item) => item.op === 'create');

        expect(entry).toMatchObject({ op: 'create', node: created, name: 'Node' });
        expect(entry?.op === 'create' && entry.context).toEqual({ app: root.app, runtime, root });
    });

    it('keeps node metadata in a WeakMap: nothing is written onto the node', async () =>
    {
        const { runtime, root, node, stage } = await setup();
        const created = node('a');
        const keys = Reflect.ownKeys(created);

        root.scene.append(stage, created);
        root.scene.setHidden(created, true);

        expect(Reflect.ownKeys(created)).toEqual(keys);
        expect(Object.getOwnPropertySymbols(created)).toEqual([]);
        expect(runtime.nodeInfo(created)).toMatchObject({ root, parent: stage, hidden: true, destroyed: false });
        expect(runtime.nodeInfo(new FakeNode())).toBeUndefined();
    });

    it('destroys a removed subtree after the commit, children first, each node once, with no options', async () =>
    {
        const { scene, root, node, stage } = await setup();
        const parent = node('parent');
        const child = node('child');
        const grandchild = node('grandchild');

        root.scene.append(stage, parent);
        root.scene.append(parent, child);
        root.scene.append(child, grandchild);
        root.scene.remove(stage, parent);

        expect(destroyed(scene.log)).toEqual([]);

        root.scene.flush();
        root.scene.flush();

        expect(destroyed(scene.log)).toEqual(['grandchild', 'child', 'parent']);
        expect(scene.log.filter((entry) => entry.op === 'destroyNode').map((entry) => 'options' in entry && entry.options))
            .toEqual([undefined, undefined, undefined]);
        expect(codeOf(() => root.scene.append(stage, parent))).toBe('UNSUPPORTED_NODE');
    });

    it('a node moved back into the tree before the flush is not destroyed', async () =>
    {
        const { scene, root, node, stage } = await setup();
        const a = node('a');
        const b = node('b');

        root.scene.append(stage, a);
        root.scene.append(stage, b);
        root.scene.remove(stage, a);
        root.scene.insertBefore(stage, a, b);
        root.scene.flush();

        expect(destroyed(scene.log)).toEqual([]);
        expect(stage.children.map((item) => item.props.label)).toEqual(['a', 'b']);
    });

    it('reparenting moves without destroying', async () =>
    {
        const { scene, runtime, root, node, stage } = await setup();
        const first = node('first');
        const second = node('second');
        const moved = node('moved');

        root.scene.append(stage, first);
        root.scene.append(stage, second);
        root.scene.append(first, moved);
        root.scene.append(second, moved);
        root.scene.remove(stage, first);
        root.scene.flush();

        expect(destroyed(scene.log)).toEqual(['first']);
        expect(runtime.nodeInfo(moved)?.parent).toBe(second);
    });

    it('rejects attach-rule violations before any mutation', async () =>
    {
        const { scene, root, node, stage } = await setup();
        const filter = root.scene.create('Filter', {});
        const parent = node('parent');
        const before = scene.log.length;

        // The container accepts only `child` roles; a filter accepts no children.
        expect(codeOf(() => root.scene.append(stage, filter))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.scene.append(filter, parent))).toBe('UNSUPPORTED_NODE');
        expect(scene.log.length).toBe(before);

        root.scene.append(stage, parent);
        root.scene.append(parent, filter);
        expect(codeOf(() => root.scene.append(parent, stage))).toBe('UNSUPPORTED_NODE');
    });

    it('rejects cycles and mismatched reference nodes', async () =>
    {
        const { root, node, stage } = await setup();
        const parent = node('parent');
        const child = node('child');
        const stranger = node('stranger');

        root.scene.append(stage, parent);
        root.scene.append(parent, child);

        expect(codeOf(() => root.scene.append(child, parent))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.scene.insertBefore(stage, stranger, child))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => root.scene.remove(stage, child))).toBe('UNSUPPORTED_NODE');
    });

    it('validates node capabilities before the first construction', async () =>
    {
        const scene = new FakeSceneAdapter({ nodeCapabilities: { 'scene.particles': 1 } });
        const runtime = composeFake(scene);

        runtime.registry.extend({ Particle: FakeNode });

        const root = await readyRoot(runtime);
        let error: CompatibilityError | undefined;

        try
        {
            root.scene.create('Particle', {});
        }
        catch (caught)
        {
            error = caught as CompatibilityError;
        }

        expect(error?.code).toBe('UNSUPPORTED_NODE');
        expect(error?.capability).toBe('scene.particles');
        expect(scene.log.some((entry) => entry.op === 'create')).toBe(false);
    });

    it('requires a ready root to construct', async () =>
    {
        const runtime = composeFake();

        runtime.registry.extend({ Node: FakeNode });

        const root = runtime.createRoot(document.createElement('canvas'));

        expect(codeOf(() => root.scene.create('Node', {}))).toBe('core.ROOT_NOT_READY');
        expect(codeOf(() => root.scene.create('Unknown', {}))).toBe('core.ROOT_NOT_READY');
    });

    it('throws UNKNOWN_ELEMENT for unregistered types and foreign definitions', async () =>
    {
        const { root } = await setup();

        expect(codeOf(() => root.scene.create('Missing', {}))).toBe('UNKNOWN_ELEMENT');
        expect(codeOf(() => root.scene.create({ name: 'Node', ctor: FakeNode, capabilities: {}, attach: { role: 'child', accepts: [] } }, {})))
            .toBe('UNKNOWN_ELEMENT');
    });

    it('destroys every node still owned at teardown, with the root teardown options', async () =>
    {
        const { scene, root, node, stage } = await setup();
        const attached = node('attached');
        const nested = node('nested');

        node('never-attached');
        root.scene.append(stage, attached);
        root.scene.append(attached, nested);

        await root.dispose({ reason: 'teardown' });

        expect(destroyed(scene.log).sort()).toEqual(['attached', 'nested', 'never-attached']);
        expect(destroyed(scene.log).indexOf('nested')).toBeLessThan(destroyed(scene.log).indexOf('attached'));
        expect(scene.log.filter((entry) => entry.op === 'destroyNode').every((entry) =>
            entry.op === 'destroyNode' && (entry.options as { reason: string }).reason === 'teardown')).toBe(true);
        // App destruction comes after every node.
        expect(scene.log.at(-1)?.op).toBe('appDestroy');
    });

    it('removals made by framework teardown hooks use the teardown options and flush once', async () =>
    {
        const { scene, root, node, stage } = await setup();
        const top = node('top');

        root.scene.append(stage, top);
        root.onTeardown(() => root.scene.remove(stage, top));

        await root.dispose({ reason: 'unmount' });

        expect(scene.log.filter((entry) => entry.op === 'destroyNode')).toEqual([
            { op: 'destroyNode', node: top, options: { reason: 'unmount' } },
        ]);
    });

    it('ticker subscriptions are idempotent and released at teardown', async () =>
    {
        const { root } = await setup();
        const ticks: number[] = [];
        const unsubscribe = root.scene.subscribe({ callback: (tick) => ticks.push(tick) });

        root.scene.subscribe({ callback: (tick) => ticks.push(tick * 10) });
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

        root.scene.append(stage, created);
        root.scene.update(created, { label: 'a' }, { label: 'b' });
        root.scene.setHidden(created, true);
        root.scene.updateApplication({ label: 'app' });

        expect(created.props).toEqual({ label: 'b' });
        expect(created.hidden).toBe(true);
        expect(root.scene.publicInstance(created)).toBe(created);
        expect((root.app as unknown as { label: string }).label).toBe('app');
    });
});

describe('ownership across roots', () =>
{
    async function twoRoots(): Promise<[Runtime<FakeSceneTypes>, RootRecord<FakeSceneTypes>, RootRecord<FakeSceneTypes>]>
    {
        const runtime = composeFake();

        runtime.registry.extend({ Node: FakeNode });

        return [runtime, await readyRoot(runtime), await readyRoot(runtime)];
    }

    it('a node of one root cannot be used by another root of the same runtime', async () =>
    {
        const [, first, second] = await twoRoots();
        const node = first.scene.create('Node', {});

        expect(codeOf(() => second.scene.append(second.session.container, node))).toBe('UNSUPPORTED_NODE');
        expect(codeOf(() => second.scene.update(node, {}, {}))).toBe('UNSUPPORTED_NODE');
    });

    it('disposing one root leaves the other root, its app and its nodes untouched', async () =>
    {
        const [runtime, first, second] = await twoRoots();
        const kept = second.scene.create('Node', { label: 'kept' });

        second.scene.append(second.session.container, kept);
        await first.dispose();

        expect(second.status).toBe('ready');
        expect(runtime.nodeInfo(kept)?.destroyed).toBe(false);
        expect(runtime.roots()).toEqual([second]);
    });
});
