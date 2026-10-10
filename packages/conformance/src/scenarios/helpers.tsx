import { Component, type ReactNode } from 'react';

import type { PixiElement, PixiProbe } from '../binding';
import type { ScenarioContext } from '../context';

/** Labels of a node's direct children, in scene order. */
export function childLabels(probe: PixiProbe, node: unknown): Array<string | undefined>
{
    return probe.children(node).map((child) => probe.label(child));
}

/** Registers a fresh filter class (`probe.filterClass`, capability `pixi.filter-children`) and returns its element. */
export function filterElement(api: ScenarioContext['api'], composition: ScenarioContext['composition'], probe: PixiProbe): PixiElement
{
    if (!probe.filterClass)
    {
        throw new Error('The binding provides "pixi.filter-children" but its probe has no filterClass().');
    }

    api.extend({ ConformanceFilter: probe.filterClass() });

    return composition.elementFor('ConformanceFilter');
}

/** The `padding` of each filter in a node's `filters`, in order (scenarios tell filters apart by it). */
export function filterPaddings(probe: PixiProbe, node: unknown): unknown[]
{
    return ((probe.get(node, 'filters') as readonly unknown[] | null | undefined) ?? []).map((filter) => probe.get(filter, 'padding'));
}

/** Depth-first search for the first descendant with `label`. */
export function findByLabel(probe: PixiProbe, root: unknown, label: string): unknown
{
    for (const child of probe.children(root))
    {
        if (probe.label(child) === label)
        {
            return child;
        }

        const found = findByLabel(probe, child, label);

        if (found !== undefined)
        {
            return found;
        }
    }

    return undefined;
}

/** Like `findByLabel`, but throws a descriptive error when the node is missing. */
export function getByLabel(probe: PixiProbe, root: unknown, label: string): object
{
    const node = findByLabel(probe, root, label);

    if (node === undefined)
    {
        throw new Error(`No scene node labelled "${label}"`);
    }

    return node as object;
}

/** Error message text of any thrown value or console argument. */
export function messageOf(value: unknown): string
{
    if (value instanceof Error)
    {
        return value.message;
    }

    return String(value);
}

/** Messages of an error and, for an AggregateError, of every error it aggregates. */
export function flattenMessages(value: unknown): string[]
{
    if (value instanceof AggregateError)
    {
        return [value.message, ...value.errors.flatMap(flattenMessages)];
    }

    return [messageOf(value)];
}

/**
 * Runs `action` and returns every error the renderer reported while it ran, from both channels a root can
 * use: errors thrown out of `act` (React 19 rethrows uncaught root errors from an act scope instead of
 * calling `onUncaughtError`) and `console.error` calls (the default root callbacks outside act).
 */
export async function reportedErrors(ctx: ScenarioContext, action: () => Promise<unknown>): Promise<string[]>
{
    const calls = ctx.captureConsoleErrors();
    const thrown: string[] = [];

    try
    {
        await action();
    }
    catch (error)
    {
        thrown.push(...flattenMessages(error));
    }

    return [...thrown, ...calls.flatMap((args) => args.map(messageOf))];
}

/** Whether any captured console.error call mentions `pattern`. */
export function someErrorMatches(calls: unknown[][], pattern: RegExp): boolean
{
    return calls.some((args) => args.some((arg) => pattern.test(messageOf(arg))));
}

interface BoundaryProps
{
    onError(error: unknown): void;
    children?: ReactNode;
}

/** Catches render errors from its subtree (in the renderer it is rendered with). */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }>
{
    state = { failed: false };

    static getDerivedStateFromError()
    {
        return { failed: true };
    }

    componentDidCatch(error: unknown)
    {
        this.props.onError(error);
    }

    render()
    {
        return this.state.failed ? null : this.props.children;
    }
}

/** A promise-backed resource for Suspense scenarios that works on React 18 and 19 (thrown thenable). */
export function createSuspender()
{
    let status: 'idle' | 'pending' | 'done' = 'idle';
    let resolve!: () => void;
    const promise = new Promise<void>((res) =>
    {
        resolve = () =>
        {
            status = 'done';
            res();
        };
    });

    return {
        suspend()
        {
            status = 'pending';
        },
        resolve,
        read()
        {
            if (status === 'pending')
            {
                throw promise;
            }
        },
    };
}
