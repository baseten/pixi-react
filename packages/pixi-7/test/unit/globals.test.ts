import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DefaultStyleRegistry, ExtensionLeaseTable } from '../../src/globals';
import { cells } from './cells';

/** The obligations table of `design/adapter-architecture.md#globals-and-ownership`, one property at a time. */
describe('default text style writer registry', () =>
{
    const setup = (initial: Record<string, unknown> = { fill: 'O', fontSize: 26 }) =>
    {
        const defaults = { ...initial };
        const registry = new DefaultStyleRegistry(defaults);

        return { defaults, registry, A: {}, B: {} };
    };

    it('A writes X; B writes Y; A leaves; B leaves → Y, then O (never the defunct X)', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        registry.write(B, { fill: 'Y' });
        registry.release(A);
        expect(defaults.fill).toBe('Y');
        registry.release(B);
        expect(defaults.fill).toBe('O');
    });

    it('A writes X; B writes Y; B leaves; A leaves → X, then O', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        registry.write(B, { fill: 'Y' });
        registry.release(B);
        expect(defaults.fill).toBe('X');
        registry.release(A);
        expect(defaults.fill).toBe('O');
    });

    it('A writes X; B writes Y; A updates to Z; A removes the property → Z, then Y; B leaving restores O', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        registry.write(B, { fill: 'Y' });
        registry.write(A, { fill: 'Z' });
        expect(defaults.fill).toBe('Z');
        registry.write(A, {});
        expect(defaults.fill).toBe('Y');
        registry.release(B);
        expect(defaults.fill).toBe('O');
    });

    it('A writes X; external code writes E; A leaves → E remains', () =>
    {
        const { defaults, registry, A } = setup();

        registry.write(A, { fill: 'X' });
        defaults.fill = 'E';
        registry.release(A);
        expect(defaults.fill).toBe('E');
    });

    it('A writes X; external E; B writes Y; B leaves while A remains → E; A\'s retired X does not return', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        defaults.fill = 'E';
        registry.write(B, { fill: 'Y' });
        expect(defaults.fill).toBe('Y');
        registry.release(B);
        expect(defaults.fill).toBe('E');
        // Re-sending the same value is not an explicit change: A stays retired.
        registry.write(A, { fill: 'X' });
        expect(defaults.fill).toBe('E');
        registry.release(A);
        expect(defaults.fill).toBe('E');
    });

    it('a retired writer contributes again through a later explicit change', () =>
    {
        const { defaults, registry, A } = setup();

        registry.write(A, { fill: 'X' });
        defaults.fill = 'E';
        registry.write(A, { fill: 'X2' });
        expect(defaults.fill).toBe('X2');
        registry.release(A);
        expect(defaults.fill).toBe('E');
    });

    it('A writes only fill; B writes only fontSize; either leaves → restores only that writer\'s property', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        registry.write(B, { fontSize: 40 });
        registry.release(A);
        expect(defaults).toEqual({ fill: 'O', fontSize: 40 });
        registry.write(A, { fill: 'X' });
        registry.release(B);
        expect(defaults).toEqual({ fill: 'X', fontSize: 26 });
    });

    it('A introduces a property absent from O; A leaves twice → absent again; repeated cleanup makes no write', () =>
    {
        const { defaults, registry, A } = setup();
        const writes: string[] = [];
        const tracked = new Proxy(defaults, {
            set(target, key, value)
            {
                writes.push(`set ${String(key)}`);

                return Reflect.set(target, key, value);
            },
            deleteProperty(target, key)
            {
                writes.push(`delete ${String(key)}`);

                return Reflect.deleteProperty(target, key);
            },
        });
        const proxied = new DefaultStyleRegistry(tracked);

        proxied.write(A, { letterSpacing: 3 });
        expect(tracked.letterSpacing).toBe(3);
        proxied.release(A);
        expect('letterSpacing' in defaults).toBe(false);
        proxied.release(A);
        expect(writes).toEqual(['set letterSpacing', 'delete letterSpacing']);
        expect(registry.isWriter(A)).toBe(false);
    });

    it('re-sending an unchanged style neither writes nor reorders', () =>
    {
        const { defaults, registry, A, B } = setup();

        registry.write(A, { fill: 'X' });
        registry.write(B, { fill: 'Y' });
        registry.write(A, { fill: 'X' });
        expect(defaults.fill).toBe('Y');
    });
});

describe('extension leases', () =>
{
    const setup = (failOn?: unknown) =>
    {
        const active = new Set<{ name: string }>();
        const log: string[] = [];
        const table = new ExtensionLeaseTable({
            add(extension)
            {
                if (extension === failOn)
                {
                    throw new Error('add failed');
                }

                log.push(`add ${String((extension as { name: string }).name)}`);
                active.add(extension as { name: string });
            },
            remove(extension)
            {
                log.push(`remove ${String((extension as { name: string }).name)}`);
                active.delete(extension as { name: string });
            },
        });

        return { active, log, table };
    };
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };

    it('reference-counts one extension across applications and removes it with the last lease', () =>
    {
        const { active, log, table } = setup();
        const first = table.holder();
        const second = table.holder();

        first.update([a]);
        second.update([a]);
        expect(log).toEqual(['add a']);
        first.releaseAll();
        expect(active.has(a)).toBe(true);
        second.releaseAll();
        expect(active.has(a)).toBe(false);
        second.releaseAll();
        expect(log).toEqual(['add a', 'remove a']);
    });

    it('swapping [a] for [b] adds b and removes a (the upstream splice(-1, 1) defect)', () =>
    {
        const { active, table } = setup();
        const holder = table.holder();

        holder.update([a]);
        holder.update([b]);
        expect([...active]).toEqual([b]);
        expect(holder.extensions).toEqual([b]);
    });

    it('a failed acquisition rolls back only this call\'s new leases and keeps the previous set', () =>
    {
        const { active, table } = setup(c);
        const holder = table.holder();
        const other = table.holder();

        holder.update([a]);
        other.update([b]);
        expect(() => holder.update([a, b, c])).toThrow('add failed');
        expect(holder.extensions).toEqual([a]);
        expect(table.count(b)).toBe(1);
        expect([...active].sort((x, y) => x.name.localeCompare(y.name))).toEqual([a, b]);
    });
});

describe('the shared algorithms', () =>
{
    it('are the Pixi 8 adapter\'s src/globals.ts, unchanged apart from the header comment', () =>
    {
        const body = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');

        expect(body('../../src/globals.ts')).toBe(body('../../../pixi-8/src/globals.ts'));
    });

    it.each(cells)('drive Pixi $version\'s extensions registry and TextStyle.defaultStyle', ({ pixi }) =>
    {
        const table = new ExtensionLeaseTable(pixi.extensions as unknown as ConstructorParameters<typeof ExtensionLeaseTable>[0]);
        const added: unknown[] = [];
        const type = `pixi-7-globals-test-${pixi.VERSION}`;

        pixi.extensions.handle(type as never, (extension) => added.push((extension as { ref: unknown }).ref), (extension) =>
            added.splice(added.indexOf((extension as { ref: unknown }).ref), 1));

        const extension = { extension: { type, name: 'probe' } };
        const holder = table.holder();

        holder.update([extension]);
        expect(added).toEqual([extension]);
        holder.releaseAll();
        expect(added).toEqual([]);

        const registry = new DefaultStyleRegistry(pixi.TextStyle.defaultStyle as unknown as Record<string, unknown>);
        const before = pixi.TextStyle.defaultStyle.fontSize;
        const writer = {};

        registry.write(writer, { fontSize: 61 });
        expect(new pixi.TextStyle().fontSize).toBe(61);
        registry.release(writer);
        expect(pixi.TextStyle.defaultStyle.fontSize).toBe(before);
    });
});
