/**
 * One Pixi `Application`'s lifecycle and scene bridge: the `SceneSession` core drives for one root.
 */
import { throwCollected } from './globals.js';
import { ROLES } from './scene.js';

import type { Application, Ticker } from 'pixi.js';
import type { DefaultStyleRegistry, ExtensionLeaseHolder, ExtensionLeaseTable } from './globals.js';
import type { PixiModule } from './pixi.js';
import type { PixiScene } from './scene.js';
import type { Pixi8AppProps, Pixi8DestroyOptions, Pixi8InitOptions, Pixi8ResizeTarget, Pixi8Types } from './types.js';
import type { NodeDefinition, SceneSession, TickOptions } from '@pixi-react-provisional/core';

/** What a session shares with every other session of the same Pixi module. */
export interface SessionGlobals
{
    readonly pixi: PixiModule;
    readonly scene: PixiScene;
    readonly extensions: ExtensionLeaseTable;
    readonly defaultStyle: DefaultStyleRegistry;
    readonly reportError: (error: unknown) => void;
}

type SessionStatus = 'new' | 'initialising' | 'ready' | 'failed' | 'destroyed';

/** The plain option values of a `defaultTextStyle` given either as options or as a `TextStyle`. */
function styleValues(pixi: PixiModule, style: unknown): Record<string, unknown> | undefined
{
    if (style === undefined || style === null)
    {
        return undefined;
    }

    if (style instanceof pixi.TextStyle)
    {
        const instance = style as unknown as Record<string, unknown>;

        return Object.fromEntries(Object.keys(pixi.TextStyle.defaultTextStyle).map((key) => [key, instance[key]]));
    }

    return { ...(style as Record<string, unknown>) };
}

export class Pixi8Session implements SceneSession<Pixi8Types>
{
    readonly app: Application;
    /** The root is the application stage, a Container: it takes children and filters, never particles. */
    readonly containerAttach = { role: ROLES.child, accepts: [ROLES.child, ROLES.filter] } as const;
    private status: SessionStatus = 'new';
    private readonly leases: ExtensionLeaseHolder;
    private resizeTarget: Pixi8ResizeTarget = null;

    constructor(private readonly globals: SessionGlobals, private readonly canvas: HTMLCanvasElement)
    {
        this.app = new globals.pixi.Application();
        this.leases = globals.extensions.holder();
    }

    get container(): object
    {
        return this.app.stage;
    }

    /**
     * Acquires the global settings first (extension leases, default text style), then initializes the application
     * on the root's canvas. Initialization itself cannot be cancelled: an abort before it starts rejects
     * immediately, and an abort while it runs is handled by core, which waits and then destroys the application.
     * A rejection releases everything acquired here and destroys a partially created renderer.
     */
    async init(options: Pixi8InitOptions, signal: AbortSignal): Promise<void>
    {
        if (this.status !== 'new')
        {
            throw new Error(`Pixi8Session.init was called on a session that is ${this.status}.`);
        }

        this.status = 'initialising';

        const { extensions, defaultTextStyle, resizeTo, ...applicationOptions } = options ?? {};

        try
        {
            signal.throwIfAborted();
            this.leases.update(extensions);
            this.globals.defaultStyle.write(this, styleValues(this.globals.pixi, defaultTextStyle));
            await this.app.init({
                ...applicationOptions,
                ...(resizeTo ? { resizeTo } : {}),
                canvas: this.canvas,
            });
            this.resizeTarget = resizeTo ?? null;
        }
        catch (error)
        {
            this.status = 'failed';
            this.releaseAfterFailure();
            throw error;
        }

        this.status = 'ready';
    }

    private releaseAfterFailure(): void
    {
        const steps = [
            () => this.leases.releaseAll(),
            () => this.globals.defaultStyle.release(this),
            () =>
            {
                // A renderer exists only when Application.init failed after creating it (for example in a plugin).
                if ((this.app as { renderer?: unknown }).renderer)
                {
                    this.app.renderer.destroy();
                }
            },
        ];

        for (const step of steps)
        {
            try
            {
                step();
            }
            catch (error)
            {
                // The initialization error is the one the root reports; a failed cleanup is reported separately.
                this.globals.reportError(error);
            }
        }
    }

    /** Applies the complete set of mutable application props. Absent global settings are released. */
    updateApplication(props: Pixi8AppProps): void
    {
        if (this.status !== 'ready')
        {
            return;
        }

        const { extensions, defaultTextStyle, resizeTo } = props ?? {};

        this.leases.update(extensions);
        this.globals.defaultStyle.write(this, styleValues(this.globals.pixi, defaultTextStyle));

        const target = resizeTo ?? null;

        if (target !== this.resizeTarget)
        {
            this.resizeTarget = target;
            // Pixi's ResizePlugin declares `resizeTo` without null, but clears the listener for a falsy target.
            (this.app as { resizeTo: Pixi8ResizeTarget }).resizeTo = target;
        }
    }

    create(definition: NodeDefinition, props: unknown): object
    {
        return this.globals.scene.create(definition, props);
    }

    update(node: object, previous: unknown, next: unknown): void
    {
        this.globals.scene.applyChanges(node, previous, next);
    }

    destroyNode(node: object, options: Pixi8Types['nodeDestroy'] | undefined): void
    {
        this.globals.scene.destroyNode(node, options);
    }

    append(parent: object, child: object): void
    {
        this.globals.scene.append(parent, child);
    }

    insertBefore(parent: object, child: object, before: object): void
    {
        this.globals.scene.insertBefore(parent, child, before);
    }

    remove(parent: object, child: object): void
    {
        this.globals.scene.remove(parent, child);
    }

    setHidden(node: object, hidden: boolean): void
    {
        this.globals.scene.setHidden(node, hidden);
    }

    publicInstance(node: object): object
    {
        return node;
    }

    /**
     * Adds one listener per subscription, wrapping the callback so removing it never removes another
     * subscription's identical callback/context pair. The cleanup is idempotent.
     */
    subscribe<C>(options: TickOptions<Ticker, C>): () => void
    {
        const { callback, context, isEnabled = true, priority } = options;

        if (!isEnabled)
        {
            return () => undefined;
        }

        const ticker = this.app.ticker;
        const listener = (tick: Ticker) => callback.call(context as C, tick);
        let active = true;

        ticker.add(listener, undefined, priority);

        return () =>
        {
            if (active)
            {
                active = false;
                // The ticker is gone once the application was destroyed.
                (ticker as Ticker | null)?.remove(listener);
            }
        };
    }

    nodeDestroyOptions(options: Pixi8DestroyOptions | undefined): Pixi8Types['nodeDestroy'] | undefined
    {
        return options?.destroyOptions;
    }

    /**
     * Destroys the application with both destroy channels forwarded unchanged, then releases the global leases.
     * Every step runs even if an earlier one throws; the failures are thrown together. Idempotent.
     */
    destroy(options: Pixi8DestroyOptions | undefined): void
    {
        if (this.status === 'destroyed')
        {
            return;
        }

        const initialised = this.status === 'ready';

        this.status = 'destroyed';

        const errors: unknown[] = [];
        const steps = [
            () =>
            {
                if (initialised)
                {
                    this.app.destroy(options?.rendererDestroyOptions, options?.destroyOptions);
                }
            },
            () => this.leases.releaseAll(),
            () => this.globals.defaultStyle.release(this),
        ];

        for (const step of steps)
        {
            try
            {
                step();
            }
            catch (error)
            {
                errors.push(error);
            }
        }

        throwCollected(errors, 'Destroying the Pixi application did not complete cleanly');
    }
}
