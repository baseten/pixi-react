/**
 * Fake Pixi objects: plain data shaped loosely after a 2D scene graph so conformance scenarios can run
 * without a renderer, a GPU or a browser. They deliberately do no work in their constructors: the
 * `FakePixiSession` applies every prop, so it can capture a node's initial values before the first write.
 */

export interface FakeNodeDestroyOptions
{
    children?: boolean;
    texture?: boolean;
    textureSource?: boolean;
    context?: boolean;
}

/** A mutable 2D point. */
export class FakePoint
{
    constructor(public x = 0, public y = 0)
    {}

    set(x: number, y = x): void
    {
        this.x = x;
        this.y = y;
    }

    copyFrom(point: { x: number; y: number }): void
    {
        this.set(point.x, point.y);
    }
}

/** A resource the scene can borrow (texture, graphics context). Destruction is observable. */
export class FakeResource
{
    destroyed = false;
    destroyCount = 0;

    constructor(readonly kind: 'texture' | 'graphics-context')
    {}

    destroy(): void
    {
        this.destroyCount += 1;
        this.destroyed = true;
    }
}

export class FakeContainer
{
    label: string | undefined = undefined;
    alpha = 1;
    visible = true;
    eventMode: 'none' | 'passive' | 'auto' | 'static' | 'dynamic' = 'passive';
    readonly position = new FakePoint();
    readonly scale = new FakePoint(1, 1);
    readonly children: FakeContainer[] = [];
    parent: FakeContainer | null = null;
    destroyed = false;

    // Declared so subclasses and the session can pass options; it keeps them out of the node.
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(..._args: unknown[])
    {
        // Fake nodes ignore constructor options: the session applies every prop after construction.
    }

    get x(): number
    {
        return this.position.x;
    }

    set x(value: number)
    {
        this.position.x = value;
    }

    get y(): number
    {
        return this.position.y;
    }

    set y(value: number)
    {
        this.position.y = value;
    }

    addChild(child: FakeContainer, index = this.children.length): void
    {
        child.parent?.removeChild(child);
        this.children.splice(index, 0, child);
        child.parent = this;
    }

    removeChild(child: FakeContainer): void
    {
        const index = this.children.indexOf(child);

        if (index !== -1)
        {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    /** Mirrors a scene graph's destroy: detaches; destroys children only when asked. */
    destroy(options: FakeNodeDestroyOptions = {}): void
    {
        this.parent?.removeChild(this);

        for (const child of [...this.children])
        {
            this.removeChild(child);

            if (options.children)
            {
                child.destroy(options);
            }
        }

        this.destroyed = true;
    }
}

export class FakeSprite extends FakeContainer
{
    texture: FakeResource | null = null;
    readonly anchor = new FakePoint();

    destroy(options: FakeNodeDestroyOptions = {}): void
    {
        if (options.texture)
        {
            this.texture?.destroy();
        }

        super.destroy(options);
    }
}

export class FakeGraphics extends FakeContainer
{
    private readonly ownedContext = new FakeResource('graphics-context');
    context: FakeResource = this.ownedContext;
    drawCount = 0;

    destroy(options: FakeNodeDestroyOptions = {}): void
    {
        // Like Pixi: an owned context dies with its node; a borrowed one only on explicit request.
        if (this.context === this.ownedContext || options.context)
        {
            this.context.destroy();
        }

        super.destroy(options);
    }
}

export interface FakeTextStyle
{
    fontSize: number;
    fill: string;
    [key: string]: unknown;
}

export const FAKE_DEFAULT_TEXT_STYLE: Readonly<FakeTextStyle> = Object.freeze({ fontSize: 26, fill: 'black' });

export class FakeText extends FakeContainer
{
    text = '';
    style: FakeTextStyle = { ...FAKE_DEFAULT_TEXT_STYLE };
}

/** A manual ticker: nothing runs until `update` is called. Higher priority listeners run first. */
export class FakeTicker
{
    private listeners: Array<{ callback: (this: unknown, ticker: FakeTicker) => void; context: unknown; priority: number }> = [];
    lastTime = 0;
    deltaMS = 0;

    get count(): number
    {
        return this.listeners.length;
    }

    add(callback: (this: unknown, ticker: FakeTicker) => void, context?: unknown, priority = 0): void
    {
        const index = this.listeners.findIndex((listener) => listener.priority < priority);
        const entry = { callback, context, priority };

        if (index === -1)
        {
            this.listeners.push(entry);
        }
        else
        {
            this.listeners.splice(index, 0, entry);
        }
    }

    remove(callback: (this: unknown, ticker: FakeTicker) => void, context?: unknown): void
    {
        const index = this.listeners.findIndex((listener) => listener.callback === callback && listener.context === context);

        if (index !== -1)
        {
            this.listeners.splice(index, 1);
        }
    }

    update(time: number): void
    {
        this.deltaMS = time - this.lastTime;
        this.lastTime = time;

        for (const listener of [...this.listeners])
        {
            listener.callback.call(listener.context, this);
        }
    }
}

export interface FakeApplicationOptions
{
    width?: number;
    height?: number;
    [key: string]: unknown;
}

/** The fake application: a stage, a manual ticker, a screen, an asynchronous `init`. */
export class FakeApplication
{
    readonly stage = new FakeContainer();
    readonly ticker = new FakeTicker();
    readonly screen = { width: 0, height: 0 };
    renderer: object | null = null;
    initialised = false;
    destroyed = false;
    private resizeTarget: HTMLElement | null = null;

    async init(options: FakeApplicationOptions = {}): Promise<void>
    {
        // One microtask, like a real asynchronous renderer setup, without timers.
        await Promise.resolve();
        this.renderer = {};
        this.screen.width = options.width ?? 800;
        this.screen.height = options.height ?? 600;
        this.initialised = true;
    }

    get resizeTo(): HTMLElement | null
    {
        return this.resizeTarget;
    }

    set resizeTo(target: HTMLElement | null)
    {
        this.resizeTarget = target;
        this.resize();
    }

    /** Sizes the screen to the resize target. jsdom has no layout, so the inline style size is used. */
    resize(): void
    {
        const target = this.resizeTarget;

        if (!target)
        {
            return;
        }

        this.screen.width = target.clientWidth || parseFloat(target.style.width) || 0;
        this.screen.height = target.clientHeight || parseFloat(target.style.height) || 0;
    }

    destroy(_rendererOptions?: unknown, options?: FakeNodeDestroyOptions): void
    {
        this.stage.destroy(options);
        this.renderer = null;
        this.resizeTarget = null;
        this.destroyed = true;
    }
}
