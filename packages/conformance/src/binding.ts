import type { ComponentType, ReactNode } from 'react';
import type { SceneJournal } from './journal';

/**
 * Capability IDs a binding can provide. Scenarios list the capabilities they need; the runner skips a
 * scenario (with the missing IDs in its title) when the binding does not provide all of them.
 *
 * - `framework.react-19` / `framework.react-18`: the React line the composition renders with.
 * - `scene.globals`: the probe can observe scene-global state (extensions, default text style).
 * - `dom.resize`: the scene application resizes to a DOM element (`resizeTo`).
 * - `parity.upstream`: the composition promises upstream `@pixi/react` behaviour (decision D4). Scenarios
 *   that need it record current upstream semantics for parity; they are not desired-behaviour claims for
 *   modular compositions, which may change them in a documented future major.
 */
export type Capability =
    | 'framework.react-19'
    | 'framework.react-18'
    | 'scene.globals'
    | 'dom.resize'
    | 'parity.upstream'
    | `${string}.${string}`;

/** The scene node kinds every binding exposes as element types. */
export type NodeKind = 'container' | 'sprite' | 'graphics' | 'text';

export type Constructor = new (...args: any[]) => object;

/**
 * An element type that renders one scene node. The facade uses intrinsic tag strings (`'pixiSprite'`) and a
 * composition may use components; both are typed as a component so scenarios can use them in JSX.
 */
export type SceneElement = ComponentType<any>;

/** Options accepted by `useTick`. */
export interface TickOptionsLike
{
    callback: (this: any, tick: any) => void;
    context?: unknown;
    isEnabled?: boolean;
    priority?: number;
}

export interface ApplicationStateLike
{
    readonly app: unknown;
    readonly isInitialised: boolean;
    readonly isInitialising?: boolean;
}

/** The root object returned by `createRoot`. `unmount` is optional because the baseline facade has none. */
export interface RootLike
{
    render(children: ReactNode, options?: Record<string, unknown>): Promise<unknown>;
    unmount?(): unknown;
}

/**
 * The React-facing API surface of one composition, shaped like the upstream facade's public exports so a
 * scenario reads the same against the facade and against a `createRenderer` composition. Types are
 * deliberately loose: scenarios are scene-neutral and observe the scene only through the `SceneProbe`.
 */
export interface ReactBindingApi
{
    Application: ComponentType<any>;
    createRoot(target: HTMLElement | HTMLCanvasElement, options?: Record<string, unknown>): RootLike;
    extend(catalog: Record<string, Constructor>): void;
    useExtend(catalog: Record<string, Constructor>): void;
    useApplication(): ApplicationStateLike;
    useTick(options: ((tick: any) => void) | TickOptionsLike): void;
    applyProps(instance: any, props: Record<string, unknown>): unknown;
}

/** Observes one application initialization attempt that the probe intercepted. */
export interface InitAttempt
{
    /** Resolves once the initialization has started. */
    readonly started: Promise<void>;
    /** Resolves (never rejects) once the scene's initialization finished, successfully or not. */
    readonly settled: Promise<void>;
}

/** Returned by `SceneProbe.holdNextInit`: the next application initialization waits for `release`. */
export interface InitGate extends InitAttempt
{
    release(): void;
}

/** Scene-global observations, available when the binding provides `scene.globals`. */
export interface SceneGlobalsProbe
{
    /** A snapshot of the scene's global default text style. */
    defaultTextStyle(): Record<string, unknown>;
    /** A fresh extension object of a probe-owned type. */
    createExtension(name: string): unknown;
    /** Whether the extension is currently registered with the scene's global extension registry. */
    isExtensionActive(extension: unknown): boolean;
}

/**
 * Observes and drives the scene of one composition. Every method is scene-neutral: scenarios never touch a
 * scene library directly. Bindings implement it with spies installed when the composition is built (the
 * historical prototype's "rebuild the composition with spies" pattern), so each test sees a fresh journal.
 */
export interface SceneProbe
{
    /** Ordered record of scene operations observed since the composition was created. */
    readonly journal: SceneJournal;

    /** The root display node of an initialized application. */
    stage(app: unknown): unknown;
    /** A snapshot of the node's children in scene order (never a live array). */
    children(node: unknown): readonly unknown[];
    parent(node: unknown): unknown;
    /** Reads a property by dotted path, e.g. `position.x`. */
    get(node: unknown, path: string): unknown;
    isDestroyed(node: unknown): boolean;
    /** A display label for diagnostics and order assertions. */
    label(node: unknown): string | undefined;

    /** Dispatches a scene event (scene event name, e.g. `pointertap`) at `node` through the app's event system. */
    dispatch(app: unknown, node: unknown, type: string): void;
    /** Advances the application's ticker manually by `ms` milliseconds. */
    advance(app: unknown, ms: number): void;
    /** Number of listeners on the application's ticker, including the scene's own render listener. */
    tickerListenerCount(app: unknown): number;
    /** The application's current screen size. */
    screen(app: unknown): { width: number; height: number };
    isAppDestroyed(app: unknown): boolean;
    /** Number of roots the composition currently holds (mounted or awaiting teardown). */
    rootCount(): number;

    /** A deterministic, locally generated texture resource that the test owns. */
    createTexture(): unknown;
    /** A graphics context resource that the test owns. */
    createGraphicsContext(): unknown;
    isResourceDestroyed(resource: unknown): boolean;

    /**
     * A fresh container subclass. Its constructor arguments are journaled as `construct` entries with
     * `kind: 'custom'`. With `requiredArgument`, constructing it without an argument throws.
     */
    customClass(options?: { requiredArgument?: boolean }): Constructor;

    /** Makes the next application initialization reject with `error`. */
    failNextInit(error: Error): InitAttempt;
    /** Holds the next application initialization until the gate is released. */
    holdNextInit(): InitGate;

    readonly globals?: SceneGlobalsProbe;
}

/** One freshly built, fully observable composition. Built per scenario and disposed afterwards. */
export interface Composition
{
    readonly api: ReactBindingApi;
    /** Element types for the built-in kinds, after the binding registered its spied constructors. */
    readonly elements: Readonly<Record<NodeKind, SceneElement>>;
    /** The element type for a catalog name registered through `api.extend` or `api.useExtend`. */
    elementFor(name: string): SceneElement;
    readonly probe: SceneProbe;
    /** Application props that make the scene deterministic (manual ticker, fixed size). */
    readonly appOptions: Readonly<Record<string, unknown>>;
    /** Restores global state the composition touched. Called after every scenario, even on failure. */
    dispose(): Promise<void> | void;
}

/** A confirmed defect that makes one scenario fail against one binding. */
export interface ExpectedFailure
{
    /** Why the scenario fails, in words; reproduced in the test title and the feature map. */
    readonly reason: string;
    /** Must match the message of the error the scenario throws. */
    readonly match: RegExp;
    /** Where the bounded fix belongs (an issue URL). */
    readonly owner?: string;
}

/**
 * The factory a renderer implementation provides to run the conformance suite. The baseline facade is the
 * first binding; later `createRenderer({ framework, scene })` compositions each provide their own.
 */
export interface ConformanceBinding
{
    readonly id: string;
    readonly capabilities: readonly Capability[];
    /**
     * Scenarios that fail against this binding because of a confirmed defect, keyed by scenario ID. The
     * runner runs them as expected failures: the test fails if the scenario passes (so a fix forces the
     * entry to be removed) or if it fails with an error that does not match `match` (so an unrelated
     * breakage is not mistaken for the known defect). Never use this to hide an acceptance scenario.
     */
    readonly expectedFailures?: Readonly<Record<string, ExpectedFailure>>;
    create(): Promise<Composition> | Composition;
}
