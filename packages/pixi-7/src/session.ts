/**
 * One Pixi 7 `Application`'s lifecycle and Pixi bridge: the `PixiSession` core drives for one root.
 *
 * Pixi 7 builds an application synchronously: `new Application(options)` creates the stage, then the renderer
 * (`autoDetectRenderer(options)`, which takes the canvas as `view`), then runs every registered application plugin's
 * `init` (the ticker and resize plugins, and any extension). Pixi 8 splits this into `new Application()` and an
 * asynchronous `init(options)`. Core's session contract follows Pixi 8: the application object exists when the root is
 * created, and `init` settles later. This session therefore creates the application object, with its stage, when the
 * root is created, and runs Pixi 7's construction steps on it in `init`, exactly as Pixi 7's constructor does (the
 * Application of pixi.js 7.2.0 to 7.4.3 is identical; `test/browser/pixi/application.test.tsx` compares the result
 * with `new Application(options)`). That keeps one application identity for the whole root, and it gives the session a
 * reference to a partially constructed application when a plugin throws, so the renderer and the plugins that did
 * initialize are destroyed instead of leaking a WebGL context.
 */
import { throwCollected } from './globals.js';
import { ROLES } from './nodes.js';

import type { Application, IApplicationPlugin } from 'pixi.js';
import type { DefaultStyleRegistry, ExtensionLeaseHolder, ExtensionLeaseTable } from './globals.js';
import type { PixiNodes } from './nodes.js';
import type { PixiBinding } from './pixi.js';
import type { Pixi7AppProps, Pixi7DestroyOptions, Pixi7InitOptions, Pixi7ResizeTarget, Pixi7Types } from './types.js';
import type { NodeDefinition, PixiSession, TickOptions } from '@pixi-react-provisional/core';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** What a session shares with every other session of the same Pixi module. */
export interface SessionGlobals
{
    readonly pixi: PixiBinding;
    readonly nodes: PixiNodes;
    readonly extensions: ExtensionLeaseTable;
    readonly defaultStyle: DefaultStyleRegistry;
    readonly reportError: (error: unknown) => void;
}

type SessionStatus = 'new' | 'initialising' | 'ready' | 'failed' | 'destroyed';

/** The plain option values of a `defaultTextStyle` given either as options or as a `TextStyle`. */
function styleValues(pixi: PixiBinding, style: unknown): Record<string, unknown> | undefined
{
    if (style === undefined || style === null)
    {
        return undefined;
    }

    if (style instanceof pixi.TextStyle)
    {
        const instance = style as unknown as Record<string, unknown>;

        return Object.fromEntries(Object.keys(pixi.TextStyle.defaultStyle).map((key) => [key, instance[key]]));
    }

    return { ...(style as Record<string, unknown>) };
}

/** Pixi 7's `Application.destroy(removeView)` takes a boolean; Pixi 8's renderer options object is accepted too. */
export function removeViewOf(options: Pixi7DestroyOptions['rendererDestroyOptions']): boolean | undefined
{
    if (options === undefined || options === null || typeof options === 'boolean')
    {
        return options ?? undefined;
    }

    const extra = Object.keys(options).filter((key) => key !== 'removeView');

    // Development-only: production builds drop the warning and its text (issue 58).
    if (process.env.NODE_ENV !== 'production' && extra.length)
    {
        console.warn(`[pixi-7] rendererDestroyOptions ${extra.map((key) => `\`${key}\``).join(', ')} ${extra.length === 1 ? 'is a' : 'are'} `
            + 'Pixi 8 option(s); Pixi 7\'s Application.destroy takes only removeView, so they were ignored.');
    }

    return options.removeView;
}

/** Pixi 7's application plugins, in the order its constructor initializes them. */
function pluginsOf(pixi: PixiBinding): readonly IApplicationPlugin[]
{
    return (pixi.Application as unknown as { _plugins: IApplicationPlugin[] })._plugins;
}

export class Pixi7Session implements PixiSession<Pixi7Types>
{
    readonly app: Application;
    /** The root is the application stage, a Container: it takes children, Sprites and filters. */
    readonly containerAttach = { role: ROLES.child, accepts: [ROLES.child, ROLES.sprite, ROLES.filter] } as const;
    private status: SessionStatus = 'new';
    private readonly leases: ExtensionLeaseHolder;
    private resizeTarget: Pixi7ResizeTarget = null;
    /** The plugins whose `init` ran on this application, in order. */
    private initialised: IApplicationPlugin[] = [];

    constructor(private readonly globals: SessionGlobals, private readonly canvas: HTMLCanvasElement)
    {
        // The object Pixi 7's constructor would build, before its first statement: the stage is created there too.
        const app = Object.create(globals.pixi.Application.prototype) as Application;

        app.stage = new globals.pixi.Container();
        this.app = app;
        this.leases = globals.extensions.holder();
    }

    get container(): object
    {
        return this.app.stage;
    }

    /**
     * Acquires the global settings first (extension leases, default text style), then runs Pixi 7's application
     * construction on the root's canvas. It is synchronous: an abort before it starts rejects immediately, and nothing
     * can abort it midway. A failure releases everything acquired here and destroys what was constructed.
     */
    async init(options: Pixi7InitOptions, signal: AbortSignal): Promise<void>
    {
        if (this.status !== 'new')
        {
            throw new Error(`Pixi7Session.init was called on a session that is ${this.status}.`);
        }

        this.status = 'initialising';

        const { extensions, defaultTextStyle, resizeTo, ...applicationOptions } = options ?? {};

        try
        {
            signal.throwIfAborted();
            this.leases.update(extensions);
            this.globals.defaultStyle.write(this, styleValues(this.globals.pixi, defaultTextStyle));
            this.construct({
                ...applicationOptions,
                ...(resizeTo ? { resizeTo } : {}),
                view: this.canvas,
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

    /** Pixi 7's `Application` constructor, after `this.stage = new Container()`, run on the session's application. */
    private construct(options: Record<string, unknown>): void
    {
        const { pixi } = this.globals;
        const app = this.app as Application & { renderer: Application['renderer'] };
        const settings = Object.assign({ forceCanvas: false }, options);

        app.renderer = pixi.autoDetectRenderer(settings as Parameters<PixiBinding['autoDetectRenderer']>[0]) as Application['renderer'];
        for (const plugin of pluginsOf(pixi))
        {
            this.initialised.push(plugin);
            plugin.init.call(app, settings);
        }
    }

    private releaseAfterFailure(): void
    {
        const app = this.app as unknown as { renderer?: { destroy(): void } | null };
        const steps = [
            () => this.leases.releaseAll(),
            () => this.globals.defaultStyle.release(this),
            // Plugins that started initializing are destroyed in reverse order, as Application.destroy would; the
            // renderer exists only when construction failed after creating it.
            ...[...this.initialised].reverse().map((plugin) => () => plugin.destroy.call(app)),
            () =>
            {
                if (app.renderer)
                {
                    app.renderer.destroy();
                    app.renderer = null;
                }
            },
        ];

        this.initialised = [];
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
    updateApplication(props: Pixi7AppProps): void
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
            // Pixi 7's ResizePlugin clears its listener for a falsy target, as Pixi 8's does.
            (this.app as { resizeTo: Pixi7ResizeTarget }).resizeTo = target;
        }
    }

    create(definition: NodeDefinition, props: unknown): object
    {
        return this.globals.nodes.create(definition, props);
    }

    update(node: object, previous: unknown, next: unknown): void
    {
        this.globals.nodes.applyChanges(node, previous, next);
    }

    destroyNode(node: object, options: Pixi7Types['nodeDestroy'] | undefined): void
    {
        this.globals.nodes.destroyNode(node, options);
    }

    append(parent: object, child: object): void
    {
        this.globals.nodes.append(parent, child);
    }

    insertBefore(parent: object, child: object, before: object): void
    {
        this.globals.nodes.insertBefore(parent, child, before);
    }

    remove(parent: object, child: object): void
    {
        this.globals.nodes.remove(parent, child);
    }

    setHidden(node: object, hidden: boolean): void
    {
        this.globals.nodes.setHidden(node, hidden);
    }

    publicInstance(node: object): object
    {
        return node;
    }

    /**
     * Adds one listener per subscription, wrapping the callback so removing it never removes another subscription's
     * identical callback/context pair. Pixi 7's ticker passes the frame delta (`ticker.deltaTime`, a number scaled to
     * 60 fps), not the `Ticker` that Pixi 8 passes; the callback receives that number. The cleanup is idempotent.
     */
    subscribe<C>(options: TickOptions<number, C>): () => void
    {
        const { callback, context, isEnabled = true, priority } = options;

        if (!isEnabled)
        {
            return () => undefined;
        }

        const ticker = this.app.ticker;
        const listener = (delta: number) => callback.call(context as C, delta);
        let active = true;

        ticker.add(listener, undefined, priority);

        return () =>
        {
            if (active)
            {
                active = false;
                // The ticker is gone once the application was destroyed.
                (ticker as typeof ticker | null)?.remove(listener);
            }
        };
    }

    nodeDestroyOptions(options: Pixi7DestroyOptions | undefined): Pixi7Types['nodeDestroy'] | undefined
    {
        return options?.destroyOptions;
    }

    /**
     * Destroys the application with Pixi 7's two arguments: `removeView` (from `rendererDestroyOptions`) and the stage
     * options (`destroyOptions`, unchanged), then releases the global leases. Every step runs even if an earlier one
     * throws; the failures are thrown together. Idempotent.
     */
    destroy(options: Pixi7DestroyOptions | undefined): void
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
                    this.app.destroy(removeViewOf(options?.rendererDestroyOptions), options?.destroyOptions);
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
