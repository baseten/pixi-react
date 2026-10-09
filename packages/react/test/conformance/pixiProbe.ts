import {
    Application,
    CanvasSource,
    Container,
    extensions,
    FederatedPointerEvent,
    Graphics,
    GraphicsContext,
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

/** Subclasses `Base` so that construction and destruction are journaled. */
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

export interface Pixi8Probe extends PixiProbe
{
    /** The spied built-in constructors, keyed by catalog name. */
    readonly catalog: Readonly<Record<'Container' | 'Sprite' | 'Graphics' | 'Text', Constructor>>;
    /** Removes the prototype spies, extension handler and global style changes. */
    restore(): void;
}

/**
 * A `PixiProbe` for Pixi 8. It rebuilds the observable surface for each composition: spied subclasses of
 * the built-in display objects, and journaling wrappers around `Application.prototype.init`/`destroy`.
 * `rootCount` is supplied by the binding, because roots belong to the React side.
 */
export function createPixi8Probe(rootCount: () => number): Pixi8Probe
{
    const journal = new PixiJournal();
    const pendingInits: PendingInit[] = [];
    const destroyedResources = new WeakSet<object>();
    const virtualTime = new WeakMap<object, number>();
    const activeExtensions = new Set<unknown>();
    const createdExtensions = new Set<unknown>();
    const probeType = `conformance-probe-${++probeTypeCounter}`;
    const defaultStyleSnapshot = { ...TextStyle.defaultTextStyle };

    const originalInit = Application.prototype.init;
    const originalDestroy = Application.prototype.destroy;

    Application.prototype.init = async function init(this: Application, options?: Parameters<Application['init']>[0])
    {
        journal.record({ op: 'app.init', app: this, options });
        const pending = pendingInits.shift();

        pending?.started();

        try
        {
            if (pending?.gate)
            {
                await pending.gate;
            }

            if (pending?.error)
            {
                throw pending.error;
            }

            await originalInit.call(this, options);
            journal.record({ op: 'app.init.settled', app: this });
        }
        catch (error)
        {
            journal.record({ op: 'app.init.settled', app: this, error });
            throw error;
        }
        finally
        {
            pending?.settled();
        }
    };

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

    return {
        journal,
        catalog,
        stage: (app) => (app as Application).stage,
        // A copy: Pixi mutates `children` in place, which would make before/after comparisons vacuous.
        children: (node) => [...((node as Container | null)?.children ?? [])],
        parent: (node) => (node as Container).parent,
        get(node, path)
        {
            return path.split('.').reduce<any>((value, key) => value?.[key], node);
        },
        isDestroyed: (node) => (node as Container).destroyed,
        label: (node) => (node as Container).label ?? undefined,
        dispatch(app, node, type)
        {
            const event = new FederatedPointerEvent((app as Application).renderer.events.rootBoundary);

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

            return markDestroyed(new Texture({ source: new CanvasSource({ resource: canvas }) }));
        },
        createGraphicsContext: () => markDestroyed(new GraphicsContext().rect(0, 0, 4, 4).fill(0xff00ff)),
        isResourceDestroyed: (resource) => destroyedResources.has(resource as object),
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

                    super(...(args as []));
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
            defaultTextStyle: () => ({ ...TextStyle.defaultTextStyle }),
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
            Application.prototype.init = originalInit;
            Application.prototype.destroy = originalDestroy;

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

            const defaults = TextStyle.defaultTextStyle as unknown as Record<string, unknown>;

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
