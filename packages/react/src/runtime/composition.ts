/**
 * The default composition behind `@pixi/react` (decisions D1 and D4): the newest tested React 19 epoch
 * (`@pixi-react-provisional/react-19.3`) with `Pixi8Adapter`, through the neutral `createRenderer`, with upstream's
 * silent `extend` replacement (`registryConflict: 'replace'`).
 *
 * One composition exists per loaded pixi.js module (see `bind.ts`). It is created on first use, not at import: an
 * unsupported installation (a React outside the 19 major, a pixi.js outside the peer range) throws its
 * `CompatibilityError` from the first facade call instead of from `import`. An untested React 19 minor composes and
 * logs one warning (see `reactVersion.ts`).
 */
import { createFacadePixiAdapter, type FacadePixiAdapter } from './pixiAdapter';
import { checkFacadeReact } from './reactVersion';
import { React19Adapter } from '@pixi-react-provisional/react-19.3';
import { createRenderer, type Renderer } from '@pixi-react-provisional/renderer';

import type { ApplicationState as FacadeApplicationState } from '../typedefs/ApplicationState';
import type { ApplicationState } from '@pixi-react-provisional/core';
import type { Pixi8AdapterConstructor, Pixi8Types, PixiBinding } from '@pixi-react-provisional/pixi-8';
import type { React19Family } from '@pixi-react-provisional/react-19.3';

/**
 * The facade's React adapter: the React 19.3 adapter with the facade's version policy. The facade's React peer is
 * `^19.3.0`, so instead of the adapter's exact-minor rejection it accepts any React 19 minor and warns once for one
 * other than 19.3 (`checkFacadeReact`); another React major is still rejected. Everything else is the React 19.3
 * adapter's.
 */
export class FacadeReactAdapter extends React19Adapter
{
    checkEnvironment(): void
    {
        if (checkFacadeReact(this.reactVersion()) === 'unsupported')
        {
            // Another React major: the adapter's own UNSUPPORTED_TUPLE rejection.
            super.checkEnvironment();
        }
    }
}

/** The composed default renderer: React 19.3 bindings for the Pixi 8 scene, plus its runtime. */
export type FacadeRenderer = Renderer<React19Family, Pixi8Types>;

/** Destroy options a facade root was created with; upstream exposed them on `applicationState`. */
export interface FacadeRootOptions
{
    destroyOptions?: unknown;
    rendererDestroyOptions?: unknown;
}

export interface FacadeRuntime
{
    /** The facade's Pixi adapter. Constructing it allocates nothing and checks nothing. */
    readonly adapter: FacadePixiAdapter;
    /** The pixi.js exports the Pixi adapter is bound to (its `PIXI8_BINDING_EXPORTS`). */
    readonly pixi: PixiBinding;
    /** `TextStyle.defaultTextStyle` as it was when the facade loaded (upstream's restore target). */
    readonly originalDefaultTextStyle: Readonly<Record<string, unknown>>;
    /** The composed renderer; composes on the first call. */
    renderer(): FacadeRenderer;
    /** Records the destroy options a root's application was first created with (later calls are ignored). */
    rememberRootOptions(app: object, options: FacadeRootOptions): void;
    /**
     * Upstream's `applicationState` shape for an adapter state snapshot: `app`, `isInitialised`, `isInitialising`
     * plus the root's `destroyOptions` and `rendererDestroyOptions`. Stable for a given snapshot.
     */
    applicationState(state: ApplicationState<Pixi8Types['app']>): FacadeApplicationState;
}

export function createFacadeRuntime(Pixi8Adapter: Pixi8AdapterConstructor): FacadeRuntime
{
    const adapter = createFacadePixiAdapter(Pixi8Adapter);
    const { pixi } = adapter;
    let renderer: FacadeRenderer | undefined;
    const rootOptions = new WeakMap<object, FacadeRootOptions>();
    const states = new WeakMap<object, FacadeApplicationState>();

    return {
        adapter,
        pixi,
        originalDefaultTextStyle: Object.freeze({ ...(pixi.TextStyle.defaultTextStyle as unknown as Record<string, unknown>) }),
        renderer()
        {
            // A failed composition throws again on the next call; nothing is cached until it succeeds.
            renderer ??= createRenderer({ react: new FacadeReactAdapter(), pixi: adapter }, { registryConflict: 'replace' });

            return renderer;
        },
        rememberRootOptions(app, options)
        {
            if (!rootOptions.has(app))
            {
                rootOptions.set(app, { destroyOptions: options.destroyOptions, rendererDestroyOptions: options.rendererDestroyOptions });
            }
        },
        applicationState(state)
        {
            let facadeState = states.get(state);

            if (!facadeState)
            {
                const options = rootOptions.get(state.app) ?? {};

                facadeState = {
                    app: state.app,
                    isInitialised: state.isInitialised,
                    isInitialising: state.isInitialising,
                    destroyOptions: options.destroyOptions,
                    rendererDestroyOptions: options.rendererDestroyOptions,
                } as FacadeApplicationState;
                states.set(state, facadeState);
            }

            return facadeState;
        },
    };
}
