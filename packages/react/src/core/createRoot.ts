import { assignApplicationOptions } from '../runtime/applicationOptions';
import { type CreateRootOptions } from '../typedefs/CreateRootOptions';
import { type Root } from '../typedefs/Root';

import type { ReactNode } from 'react';
import type { FacadeRuntime } from '../runtime/composition';
import type { RootRecord } from '@pixi-react-provisional/core';
import type { Pixi8Types } from '@pixi-react-provisional/pixi-8';

function noop(): void
{
    // Settled elsewhere.
}

/**
 * Creates the facade's `createRoot` over the default composition. The adapter root does the work (initialization,
 * ordered commits, teardown); this keeps upstream's `Root` shape and option semantics on top of it.
 */
export function createCreateRoot(runtime: FacadeRuntime)
{
    const roots = new WeakMap<RootRecord<Pixi8Types>, Root>();

    /** Creates a new root for a Pixi React app. */
    return function createRoot(
        /** @description The DOM node which will serve as the root for this tree. */
        target: HTMLElement | HTMLCanvasElement,

        /** @description Options to configure the tree. */
        options: CreateRootOptions = {},
    ): Root
    {
        const { runtime: core } = runtime.renderer();
        const existing = core.rootFor(target);
        const known = existing && roots.get(existing);

        // Upstream returned the existing root for a target it already knew, ignoring the new options, and its
        // warning was off unless debug logging was enabled. Element targets now map to the same root as their
        // canvas (the approved repair of `createRoot.same-element`).
        if (known)
        {
            return known;
        }

        // A target an `<Application>` already rendered into keeps its callbacks and destroy options: upstream
        // ignored the options of a repeated createRoot.
        const adapterRoot = runtime.renderer().createRoot(target, existing ? {} : {
            onInit: options.onInit,
            destroyOptions: options.destroyOptions,
            rendererDestroyOptions: options.rendererDestroyOptions,
        });
        const record = core.rootFor(target)!;
        let lastResizeTo: unknown;

        runtime.rememberRootOptions(record.app, options);

        const root = {
            get applicationState()
            {
                return runtime.applicationState(record.applicationState);
            },
            // The reconciler container belongs to the React epoch and is not exposed; the key stays for shape.
            fiber: null as unknown as Root['fiber'],
            internalState: {
                canvas: record.canvas,
                rootContainer: record.app.stage as unknown as Root['internalState']['rootContainer'],
            },
            render(children: ReactNode, applicationOptions: Record<string, unknown> = {})
            {
                // Upstream passed the options to `Application.init` and then copied every one onto the application.
                // It never registered `extensions` or wrote `defaultTextStyle` for createRoot roots: those two keys
                // are copied like any other option and never reach the scene's global settings.
                const { extensions: _extensions, defaultTextStyle: _defaultTextStyle, ...pixiOptions } = applicationOptions;

                // Upstream left `resizeTo` alone when a later render omitted it; the adapter clears it, so pass the
                // last target this root was given.
                if ('resizeTo' in pixiOptions)
                {
                    lastResizeTo = pixiOptions.resizeTo;
                }
                else if (lastResizeTo !== undefined)
                {
                    pixiOptions.resizeTo = lastResizeTo;
                }

                // Queued before the adapter's render request, so the copy runs after onInit and before this
                // request commits, as in upstream.
                record.schedule((app) => assignApplicationOptions(app, applicationOptions)).catch(noop);

                return adapterRoot.render(children, pixiOptions as never);
            },
        } as Root;

        // The approved leak repair (`createRoot.unmount`): a createRoot root can be torn down. It is not part of the
        // upstream `Root` type or its enumerable shape (D4).
        Object.defineProperty(root, 'unmount', { value: () => adapterRoot.unmount(), enumerable: false });
        roots.set(record, root);

        return root;
    };
}
