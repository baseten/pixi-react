/**
 * One Pixi `Application`'s lifecycle and Pixi bridge: the `PixiSession` core drives for one root.
 */
import { throwCollected } from './globals.js';
import { ROLES } from './nodes.js';

import type { Application, Ticker } from 'pixi.js';
import type { DefaultStyleRegistry, ExtensionLeaseHolder, ExtensionLeaseTable } from './globals.js';
import type { PixiNodes } from './nodes.js';
import type { PixiBinding } from './pixi.js';
import type { Pixi8AppProps, Pixi8DestroyOptions, Pixi8InitOptions, Pixi8ResizeTarget, Pixi8Types } from './types.js';
import type { NodeDefinition, PixiSession, TickOptions } from '@pixi-react-provisional/core';

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

/** A WebGPU `GPUDevice`, as far as the adapter uses it. */
interface GpuDeviceLike
{
    destroy(): void;
}

/** What the adapter reads of a Pixi renderer: a WebGPU renderer has `gpu` (its adapter and device), WebGL has none. */
interface RendererLike
{
    readonly gpu?: { readonly device?: unknown } | null;
}

/** The devices an application supplied through the `gpu` option (pixi.js 8.12+), top-level or under `webgpu`. */
function suppliedGpuDevices(options: object): unknown[]
{
    const { gpu, webgpu } = options as { gpu?: { device?: unknown } | null; webgpu?: { gpu?: { device?: unknown } | null } | null };

    return [gpu?.device, webgpu?.gpu?.device].filter((device) => device !== undefined && device !== null);
}

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

        return Object.fromEntries(Object.keys(pixi.TextStyle.defaultTextStyle).map((key) => [key, instance[key]]));
    }

    return { ...(style as Record<string, unknown>) };
}

export class Pixi8Session implements PixiSession<Pixi8Types>
{
    readonly app: Application;
    /** The root is the application stage, a Container: it takes children and filters, never particles. */
    readonly containerAttach = { role: ROLES.child, accepts: [ROLES.child, ROLES.filter] } as const;
    private status: SessionStatus = 'new';
    private readonly leases: ExtensionLeaseHolder;
    private resizeTarget: Pixi8ResizeTarget = null;
    /** WebGPU devices the application supplied (`gpu`): they belong to the application and are never destroyed here. */
    private suppliedDevices: unknown[] = [];

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
            this.suppliedDevices = suppliedGpuDevices(applicationOptions);
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

    /**
     * The WebGPU device of the application's renderer when pixi.js will not destroy it, captured before the renderer is
     * destroyed (destroying it clears `renderer.gpu`). pixi.js before 8.21 (`PIXI8_BOUNDARIES.destroysOwnGpuDevice`,
     * pixijs/pixijs#12173) never calls `GPUDevice.destroy()`, so every WebGPU application would leak its device; a
     * driver runs out of them after enough mounts (Direct3D 12: `requestDevice` fails with E_OUTOFMEMORY). A device
     * the application supplied through `gpu` is the application's and is never returned, as pixi.js does from 8.21.
     * pixi.js before 8.12 ignores `gpu` and creates its own device, which the identity check returns. `undefined`
     * for a WebGL renderer, no renderer, or pixi.js 8.21+.
     */
    private leakedGpuDevice(): GpuDeviceLike | undefined
    {
        if (this.globals.nodes.features.destroysOwnGpuDevice)
        {
            return undefined;
        }

        const renderer = (this.app as { renderer?: RendererLike | null }).renderer;
        const device = renderer?.gpu?.device as Partial<GpuDeviceLike> | null | undefined;

        if (!device || typeof device.destroy !== 'function' || this.suppliedDevices.includes(device))
        {
            return undefined;
        }

        return device as GpuDeviceLike;
    }

    private releaseAfterFailure(): void
    {
        let device: GpuDeviceLike | undefined;
        const steps = [
            () => this.leases.releaseAll(),
            () => this.globals.defaultStyle.release(this),
            () =>
            {
                // A renderer exists only when Application.init failed after creating it (for example in a plugin).
                if ((this.app as { renderer?: unknown }).renderer)
                {
                    device = this.leakedGpuDevice();
                    this.app.renderer.destroy();
                }
            },
            // After the renderer, which still uses the device while it destroys its GPU resources.
            () => device?.destroy(),
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
        return this.globals.nodes.create(definition, props);
    }

    update(node: object, previous: unknown, next: unknown): void
    {
        this.globals.nodes.applyChanges(node, previous, next);
    }

    destroyNode(node: object, options: Pixi8Types['nodeDestroy'] | undefined): void
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
     * Destroys the application with both destroy channels forwarded unchanged, then the WebGPU device pixi.js leaves
     * behind (before 8.21, see `leakedGpuDevice`), then releases the global leases. Every step runs even if an earlier
     * one throws; the failures are thrown together. Idempotent.
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
        let device: GpuDeviceLike | undefined;
        const steps = [
            () =>
            {
                if (initialised)
                {
                    device = this.leakedGpuDevice();
                    this.app.destroy(options?.rendererDestroyOptions, options?.destroyOptions);
                }
            },
            // After Pixi's own destroy, which still uses the device while it releases its GPU resources; also when
            // that destroy threw, since the renderer is unusable either way.
            () => device?.destroy(),
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
