// The Pixi 7 counterpart of the Pixi 8 adapter's probe (packages/pixi-8/test/browser/pixiProbe.ts): the same observable
// surface, over whichever pixi.js 7 this browser cell aliases as 'pixi.js'. The compatibility cells use it too
// (`probeSource` in design/compatibility/seed.json).
import {
    AlphaFilter,
    Application,
    Container,
    extensions,
    FederatedPointerEvent,
    Graphics,
    Sprite,
    Text,
    TextStyle,
    Texture,
} from 'pixi.js';
import {
    type Constructor,
    type InitAttempt,
    type InitGate,
    PixiJournal,
    type PixiProbe,
} from '@pixi-react-provisional/conformance';

type Kind = 'container' | 'sprite' | 'graphics' | 'text' | 'custom';

/** Subclasses `Base` so that construction and destruction are journaled. Pixi 7 passes positional arguments through. */
function spied<T extends new(...args: any[]) => Container>(Base: T, kind: Kind, journal: PixiJournal): T
{
    return class extends Base
    {
        constructor(...args: any[])
        {
            super(...args);
            journal.record({ op: 'construct', kind, node: this, args });
        }

        destroy(options?: unknown)
        {
            journal.record({ op: 'destroy', node: this, options });

            return super.destroy(options as Parameters<Container['destroy']>[0]);
        }
    };
}

interface PendingInit
{
    gate?: Promise<void>;
    error?: Error;
    started: () => void;
    settled: () => void;
}

function settledHandle()
{
    let started!: () => void;
    let settled!: () => void;
    const attempt: InitAttempt = {
        started: new Promise<void>((resolve) =>
        {
            started = resolve;
        }),
        settled: new Promise<void>((resolve) =>
        {
            settled = resolve;
        }),
    };

    return { attempt, started, settled };
}

let probeTypeCounter = 0;

/** The part of a Pixi session the probe instruments. */
interface InitialisingSession
{
    readonly app: unknown;
    init(options: unknown, signal: AbortSignal): Promise<void>;
}

/** The part of a Pixi adapter the probe instruments. */
interface SessionFactory
{
    createSession(...args: any[]): unknown;
}

export interface Pixi7Probe extends PixiProbe
{
    /** The spied built-in constructors, keyed by catalog name. */
    readonly catalog: Readonly<Record<'Container' | 'Sprite' | 'Graphics' | 'Text', Constructor>>;
    /**
     * Instruments an adapter so its sessions' initializations are journaled and can be held or failed. Pixi 7 has no
     * `Application.prototype.init` to wrap (the Pixi 8 probe's hook): construction is synchronous and runs inside the
     * session's `init`, so the probe wraps that, and fails construction from a Pixi application plugin.
     */
    instrumentAdapter<A extends SessionFactory>(adapter: A): A;
    /** Removes the prototype spy, the probe's application plugin and extension handler, and global style changes. */
    restore(): void;
}

/**
 * A `PixiProbe` for Pixi 7. It rebuilds the observable surface for each composition: spied subclasses of the built-in
 * display objects, an application plugin that journals each application construction (and throws for `failNextInit`),
 * the instrumented session `init` (holds and settlement), and a journaling wrapper around `Application.prototype.destroy`.
 * `rootCount` is supplied by the binding, because roots belong to the React side.
 */
export function createPixi7Probe(rootCount: () => number): Pixi7Probe
{
    const journal = new PixiJournal();
    const pendingInits: PendingInit[] = [];
    const destroyedResources = new WeakSet<object>();
    const virtualTime = new WeakMap<object, number>();
    const activeExtensions = new Set<unknown>();
    const createdExtensions = new Set<unknown>();
    const probeType = `conformance-probe-${++probeTypeCounter}`;
    const defaultStyleSnapshot = { ...TextStyle.defaultStyle };
    const originalDestroy = Application.prototype.destroy;
    /** The initialization the probe's plugin is observing, set only while an instrumented session constructs. */
    let constructing: { pending?: PendingInit } | undefined;

    // Runs last among the application plugins (after the ticker and resize plugins), inside Pixi 7's construction.
    const plugin = {
        extension: { type: 'application', name: `${probeType}-plugin`, priority: -1000 },
        init(this: Application, options: unknown)
        {
            if (!constructing)
            {
                return;
            }

            journal.record({ op: 'app.init', app: this, options });
            constructing.pending?.started();
            if (constructing.pending?.error)
            {
                throw constructing.pending.error;
            }
        },
        destroy()
        {
            // Nothing to release.
        },
    };

    extensions.add(plugin as never);

    Application.prototype.destroy = function destroy(this: Application, ...args: Parameters<Application['destroy']>)
    {
        journal.record({ op: 'app.destroy', app: this, args });

        return originalDestroy.apply(this, args);
    };

    extensions.handle(
        probeType as never,
        (extension) => activeExtensions.add((extension as { ref: unknown }).ref),
        (extension) => activeExtensions.delete((extension as { ref: unknown }).ref),
    );

    const catalog = {
        Container: spied(Container, 'container', journal),
        Sprite: spied(Sprite, 'sprite', journal),
        Graphics: spied(Graphics, 'graphics', journal),
        Text: spied(Text, 'text', journal),
    };

    const markDestroyed = <T extends { destroy(...args: any[]): unknown }>(resource: T): T =>
    {
        const destroy = resource.destroy.bind(resource);

        resource.destroy = (...args: any[]) =>
        {
            destroyedResources.add(resource);

            return destroy(...args);
        };

        return resource;
    };

    function instrument<S extends InitialisingSession>(session: S): S
    {
        const init = session.init.bind(session);

        session.init = async (options: unknown, signal: AbortSignal) =>
        {
            const pending = pendingInits.shift();
            let failure: { error: unknown } | undefined;

            constructing = { pending };
            try
            {
                // Pixi 7's construction is synchronous: it runs before the first await of the session's `init`.
                const result = init(options, signal);

                constructing = undefined;
                await result;
            }
            catch (error)
            {
                failure = { error };
            }
            finally
            {
                constructing = undefined;
            }

            // A held initialization settles only when released, after the application was constructed.
            if (pending?.gate)
            {
                await pending.gate;
            }

            journal.record({ op: 'app.init.settled', app: session.app as object, ...(failure ? { error: failure.error } : {}) });
            pending?.settled();

            if (failure)
            {
                throw failure.error;
            }
        };

        return session;
    }

    return {
        journal,
        catalog,
        instrumentAdapter<A extends SessionFactory>(adapter: A): A
        {
            const createSession = adapter.createSession.bind(adapter);

            adapter.createSession = (...args: any[]) => instrument(createSession(...args) as InitialisingSession);

            return adapter;
        },
        stage: (app) => (app as Application).stage,
        // A copy: Pixi mutates `children` in place, which would make before/after comparisons vacuous.
        children: (node) => [...((node as Container | null)?.children ?? [])],
        parent: (node) => (node as Container).parent,
        get(node, path)
        {
            return path.split('.').reduce<any>((value, key) => value?.[key], node);
        },
        isDestroyed: (node) => (node as Container).destroyed,
        // Pixi 7 has no `label` (it has `name`); the scenarios' `label` prop is assigned as a plain property.
        label: (node) => (node as { label?: string }).label ?? undefined,
        dispatch(app, node, type)
        {
            const boundary = (app as Application).renderer.events.rootBoundary;
            const event = new FederatedPointerEvent(boundary);

            // Pixi 7's boundary propagates only below its root target, which its EventSystem sets to the last rendered
            // object when a DOM pointer event arrives; the deterministic apps never render, so set it as Pixi would.
            boundary.rootTarget = (app as Application).stage;
            event.type = type;
            (node as Container).dispatchEvent(event);
        },
        advance(app, ms)
        {
            const ticker = (app as Application).ticker;
            const now = virtualTime.get(ticker) ?? 1000;

            if (!virtualTime.has(ticker))
            {
                ticker.lastTime = now;
            }

            virtualTime.set(ticker, now + ms);
            ticker.update(now + ms);
        },
        tickerListenerCount: (app) => (app as Application).ticker.count,
        screen(app)
        {
            const { width, height } = (app as Application).screen;

            return { width, height };
        },
        isAppDestroyed: (app) => (app as Application).renderer === null && (app as Application).stage === null,
        rootCount,
        createTexture()
        {
            const canvas = document.createElement('canvas');

            canvas.width = 4;
            canvas.height = 4;
            const context2d = canvas.getContext('2d')!;

            context2d.fillStyle = '#ff00ff';
            context2d.fillRect(0, 0, 4, 4);

            return markDestroyed(Texture.from(canvas));
        },
        createGraphicsContext()
        {
            // Bindings over this probe do not provide `pixi.graphics-context`, so no scenario reaches this.
            throw new Error('Pixi 7 has no GraphicsContext (a Pixi 8 class); scenarios that need one require the '
                + '"pixi.graphics-context" capability. Pixi 7 shares GraphicsGeometry instead (packages/pixi-7 tests).');
        },
        isResourceDestroyed: (resource) => destroyedResources.has(resource as object),
        // A fresh class per call, constructible without arguments (`pixi.filter-children`).
        filterClass: () => class ConformanceFilter extends AlphaFilter {},
        customClass(options = {})
        {
            const { requiredArgument = false } = options;

            return class ConformanceCustom extends Container
            {
                constructor(...args: any[])
                {
                    if (requiredArgument && args.length === 0)
                    {
                        throw new Error('ConformanceCustom requires a constructor argument');
                    }

                    super();
                    journal.record({ op: 'construct', kind: 'custom', node: this, args });
                }

                destroy(destroyOptions?: Parameters<Container['destroy']>[0])
                {
                    journal.record({ op: 'destroy', node: this, options: destroyOptions });
                    super.destroy(destroyOptions);
                }
            };
        },
        failNextInit(error)
        {
            const { attempt, started, settled } = settledHandle();

            pendingInits.push({ error, started, settled });

            return attempt;
        },
        holdNextInit(): InitGate
        {
            const { attempt, started, settled } = settledHandle();
            let release!: () => void;
            const gate = new Promise<void>((resolve) =>
            {
                release = resolve;
            });

            pendingInits.push({ gate, started, settled });

            return { ...attempt, release };
        },
        globals: {
            defaultTextStyle: () => ({ ...TextStyle.defaultStyle }),
            createExtension(name)
            {
                const extension = { extension: { type: probeType, name: `conformance-${name}` } };

                createdExtensions.add(extension);

                return extension;
            },
            isExtensionActive: (extension) => activeExtensions.has(extension),
        },
        restore()
        {
            Application.prototype.destroy = originalDestroy;
            extensions.remove(plugin as never);

            for (const extension of createdExtensions)
            {
                extensions.remove(extension as never);
            }

            const registry = extensions as unknown as {
                _addHandlers: Record<string, unknown>;
                _removeHandlers: Record<string, unknown>;
            };

            delete registry._addHandlers[probeType];
            delete registry._removeHandlers[probeType];

            const defaults = TextStyle.defaultStyle as unknown as Record<string, unknown>;

            for (const key of Object.keys(defaults))
            {
                if (!(key in defaultStyleSnapshot))
                {
                    delete defaults[key];
                }
            }
            Object.assign(defaults, defaultStyleSnapshot);
        },
    };
}
