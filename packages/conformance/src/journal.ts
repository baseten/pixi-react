/** One observed scene operation. */
export type JournalEntry =
    | { readonly op: 'construct'; readonly kind: string; readonly node: object; readonly args: readonly unknown[] }
    | { readonly op: 'destroy'; readonly node: object; readonly options: unknown }
    | { readonly op: 'app.init'; readonly app: object; readonly options: unknown }
    | { readonly op: 'app.init.settled'; readonly app: object; readonly error?: unknown }
    | { readonly op: 'app.destroy'; readonly app: object; readonly args: readonly unknown[] };

export type JournalOp = JournalEntry['op'];

type EntryOf<O extends JournalOp> = Extract<JournalEntry, { op: O }>;

/**
 * An append-only log of scene operations. Bindings write to it from the spies they install when building a
 * composition; scenarios read it to assert construction, destruction and application lifecycle.
 */
export class PixiJournal
{
    private readonly _entries: JournalEntry[] = [];

    get entries(): readonly JournalEntry[]
    {
        return this._entries;
    }

    record(entry: JournalEntry): void
    {
        this._entries.push(entry);
    }

    of<O extends JournalOp>(op: O): EntryOf<O>[]
    {
        return this._entries.filter((entry): entry is EntryOf<O> => entry.op === op);
    }

    /** Nodes constructed so far, optionally limited to one kind. */
    constructed(kind?: string): object[]
    {
        return this.of('construct')
            .filter((entry) => kind === undefined || entry.kind === kind)
            .map((entry) => entry.node);
    }

    /** The constructor arguments recorded for `node`. */
    argsOf(node: object): readonly unknown[] | undefined
    {
        return this.of('construct').find((entry) => entry.node === node)?.args;
    }

    destroyCount(node: object): number
    {
        return this.of('destroy').filter((entry) => entry.node === node).length;
    }

    destroyOptionsOf(node: object): unknown[]
    {
        return this.of('destroy').filter((entry) => entry.node === node).map((entry) => entry.options);
    }

    appInits(): object[]
    {
        return this.of('app.init').map((entry) => entry.app);
    }

    appDestroyCount(app: object): number
    {
        return this.of('app.destroy').filter((entry) => entry.app === app).length;
    }

    /** Index of the first entry matching `predicate`, or -1. Used for ordering assertions. */
    indexOf(predicate: (entry: JournalEntry) => boolean): number
    {
        return this._entries.findIndex(predicate);
    }
}
