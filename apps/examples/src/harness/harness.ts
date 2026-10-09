/**
 * The example harness: the stable test hook issue 19's browser tests rely on. It is not part of any example as a
 * user would write it: example lines that use it are marked `// @harness`, and the docs remove them (strip.js).
 *
 * - `window.__EXAMPLE_STATE__` is the live state of the current route (`ExampleState`).
 * - `window.__EXAMPLE_CONTROL__` drives it (`ExampleControl`): in test mode the ticker is stopped and `step()`
 *   advances it by a fixed 1/60 s per frame, so every frame is reproducible.
 * - The route element (`[data-testid="example"]`) mirrors the readiness fields as `data-*` attributes.
 *
 * Test mode is the `?test` query parameter. Bump `HARNESS_VERSION` when the shape of the state or control changes.
 */
import { type Application, type Container, UPDATE_PRIORITY } from 'pixi.js';

export const HARNESS_VERSION = 1;

/** One fixed ticker step in test mode, in milliseconds (deltaTime 1 at Pixi's 60 fps target). */
export const FRAME_MS = 1000 / 60;

export type ExampleMode = 'interactive' | 'test';

/**
 * - `loading`: the application is initialising or the scene has not reported ready yet;
 * - `ready`: the application is initialised and the scene reported ready;
 * - `error`: initialization failed (see `errors`);
 * - `unmounted`: the example unmounted its application.
 */
export type ExampleStatus = 'loading' | 'ready' | 'error' | 'unmounted';

export interface ExampleState
{
    harnessVersion: number;
    /** The route id, from catalog.json. */
    route: string;
    mode: ExampleMode;
    status: ExampleStatus;
    /** True once a frame has been rendered after the scene reported ready. Reset when the application changes. */
    firstFrame: boolean;
    /** Ticker steps taken with `step()` since the current application initialised. Always 0 in interactive mode. */
    frame: number;
    /** Applications initialised on this page load (a remount counts again). */
    initCount: number;
    /** Example-specific scene state, merged from the example's reports. */
    scene: Record<string, unknown>;
    /** Initialization failures, uncaught errors and unhandled rejections, as messages. */
    errors: string[];
}

/** A display object, described by the fields the examples set. Examples give the nodes they own a `label`. */
export interface StageNode
{
    label: string;
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    alpha: number;
    visible: boolean;
    children: StageNode[];
}

export interface ExampleControl
{
    /** A copy of the current state. */
    state(): ExampleState;
    /** Test mode only: advances the stopped ticker by `frames` fixed steps; each step runs the tick callbacks and renders. */
    step(frames?: number): ExampleState;
    /** Renders the current scene once without advancing the ticker (after a React update, for example). */
    render(): ExampleState;
    /** The stage tree of the current application, or null when none is attached. */
    stage(): StageNode | null;
}

declare global
{
    interface Window
    {
        __EXAMPLE_STATE__?: ExampleState;
        __EXAMPLE_CONTROL__?: ExampleControl;
    }
}

/** Application options of test mode: a stopped ticker and a fixed WebGL backend, resolution and antialiasing. */
export const TEST_APPLICATION_OPTIONS = {
    autoStart: false,
    antialias: false,
    autoDensity: false,
    resolution: 1,
    preference: 'webgl',
    preserveDrawingBuffer: true,
} as const;

/** What an example sees: no-ops outside the example app (in the docs, for instance). */
export interface HarnessApi
{
    /** Spread into `<Application>`: the test-mode options, or nothing in interactive mode. */
    readonly options: Partial<typeof TEST_APPLICATION_OPTIONS>;
    /** Pass as (or call from) `onInit`. */
    attach(app: Application): void;
    /** Call when the example unmounts its application. */
    detach(): void;
    /** Call from `onInitError`. */
    fail(error: unknown): void;
    /** Merges `scene` into the reported state; `ready`, when given, says whether the scene is complete (default true). */
    report(scene: Record<string, unknown>, ready?: boolean): void;
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

function describe(node: Container): StageNode
{
    return {
        label: node.label,
        x: round(node.x),
        y: round(node.y),
        rotation: round(node.rotation),
        scaleX: round(node.scale.x),
        scaleY: round(node.scale.y),
        alpha: round(node.alpha),
        visible: node.visible,
        children: node.children.map(describe),
    };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Harness implements HarnessApi
{
    readonly state: ExampleState;
    readonly options: Partial<typeof TEST_APPLICATION_OPTIONS>;
    private app: Application | null = null;
    /** False while the example says its scene is incomplete (a texture still loading, for example). */
    private sceneReady = true;
    private time = 0;
    private element: HTMLElement | null = null;
    private readonly listeners = new Set<() => void>();

    constructor(route: string, mode: ExampleMode)
    {
        this.state = {
            harnessVersion: HARNESS_VERSION,
            route,
            mode,
            status: 'loading',
            firstFrame: false,
            frame: 0,
            initCount: 0,
            scene: {},
            errors: [],
        };
        this.options = mode === 'test' ? TEST_APPLICATION_OPTIONS : {};
    }

    /** Publishes the state and control on `window`. Returns the cleanup. */
    install(): () => void
    {
        const control: ExampleControl = {
            state: () => structuredClone(this.state),
            step: (frames = 1) => this.step(frames),
            render: () =>
            {
                this.app?.render();

                return structuredClone(this.state);
            },
            stage: () => (this.app?.stage ? describe(this.app.stage) : null),
        };
        const onError = (event: ErrorEvent) => this.recordError(event.error ?? event.message);
        const onRejection = (event: PromiseRejectionEvent) => this.recordError(event.reason);

        window.__EXAMPLE_STATE__ = this.state;
        window.__EXAMPLE_CONTROL__ = control;
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);

        return () =>
        {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
            if (window.__EXAMPLE_CONTROL__ === control) delete window.__EXAMPLE_CONTROL__;
            if (window.__EXAMPLE_STATE__ === this.state) delete window.__EXAMPLE_STATE__;
        };
    }

    /** The element whose `data-*` attributes mirror the state. */
    setElement(element: HTMLElement | null): void
    {
        this.element = element;
        this.publish();
    }

    subscribe(listener: () => void): () => void
    {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    attach = (app: Application): void =>
    {
        this.app = app;
        this.sceneReady = true;
        this.time = 0;
        this.state.initCount += 1;
        this.state.status = 'loading';
        this.state.firstFrame = false;
        this.state.frame = 0;
        // A stopped ticker computes its first delta from lastTime: start the fixed clock at 0.
        if (this.state.mode === 'test') app.ticker.lastTime = 0;
        this.publish();
    };

    detach = (): void =>
    {
        this.app = null;
        this.state.status = 'unmounted';
        this.state.firstFrame = false;
        this.publish();
    };

    fail = (error: unknown): void =>
    {
        this.app = null;
        this.state.status = 'error';
        this.state.firstFrame = false;
        this.recordError(error);
    };

    report = (scene: Record<string, unknown>, ready?: boolean): void =>
    {
        Object.assign(this.state.scene, scene);
        if (ready !== undefined) this.sceneReady = ready;
        this.maybeReady();
        this.publish();
    };

    private maybeReady(): void
    {
        const app = this.app;

        // Ready once the application is attached, the scene has committed its nodes to the stage and no report says
        // the scene is incomplete. onInit runs before the children commit, so a report from inside <Application>
        // (whose effect follows that commit) is what normally makes the route ready.
        if (!app || !this.sceneReady || this.state.status !== 'loading' || app.stage.children.length === 0) return;
        this.state.status = 'ready';
        if (this.state.mode === 'test')
        {
            // The ticker is stopped: render the first frame now, from the committed scene.
            app.render();
            this.state.firstFrame = true;
        }
        else
        {
            // After the ticker's render (LOW priority) of the next frame.
            app.ticker.addOnce(() =>
            {
                if (this.app !== app) return;
                this.state.firstFrame = true;
                this.publish();
            }, undefined, UPDATE_PRIORITY.UTILITY);
        }
    }

    private step(frames: number): ExampleState
    {
        if (this.state.mode !== 'test') throw new Error('step() needs test mode: open the route with ?test');
        if (!this.app) throw new Error(`step(): no application is attached (status: ${this.state.status})`);
        for (let index = 0; index < frames; index++)
        {
            this.time += FRAME_MS;
            this.app.ticker.update(this.time);
            this.state.frame += 1;
        }
        this.publish();

        return structuredClone(this.state);
    }

    private recordError(error: unknown): void
    {
        this.state.errors.push(message(error));
        this.publish();
    }

    private publish(): void
    {
        const element = this.element;

        if (element)
        {
            element.dataset.status = this.state.status;
            element.dataset.firstFrame = String(this.state.firstFrame);
            element.dataset.frame = String(this.state.frame);
            element.dataset.initCount = String(this.state.initCount);
        }
        this.listeners.forEach((listener) => listener());
    }
}
