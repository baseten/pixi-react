import {
    forwardRef,
    type ReactNode,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from 'react';
import { assignApplicationOptions } from '../runtime/applicationOptions';
import { type ApplicationProps } from '../typedefs/ApplicationProps';
import { type ApplicationRef } from '../typedefs/ApplicationRef';

import type { FacadeRuntime } from '../runtime/composition';

/**
 * Keys the React 19 adapter's `Application` treats as root callbacks. They are modular-package API (D4): the facade
 * never hands them to the adapter. Like any other unknown prop, upstream treated them as application options.
 */
const ADAPTER_ONLY_KEYS = ['onInitError', 'onUncaughtError', 'onCaughtError', 'onRecoverableError', 'identifierPrefix'];

function noop(): void
{
    // Settled elsewhere.
}

interface GlobalSettingsProps
{
    runtime: FacadeRuntime;
    extensions: ApplicationProps['extensions'];
    defaultTextStyle: ApplicationProps['defaultTextStyle'];
}

/**
 * Upstream's `extensions` and `defaultTextStyle` handling, kept in the facade for parity (D4). It is rendered before
 * the adapter's `Application`, so its layout effects run first and extensions are registered before initialization,
 * as upstream's were.
 *
 * - Extensions are added to Pixi's global registry and never removed on unmount. When the list changes, removed
 *   extensions are removed and new ones added (the approved repair of upstream's `splice(-1, 1)` defect).
 * - `defaultTextStyle` is merged into Pixi's global default; without it, the default captured when the facade loaded
 *   is merged back. Unmounting restores nothing.
 */
function GlobalSettings({ runtime, extensions, defaultTextStyle }: GlobalSettingsProps)
{
    const registered = useRef(new Set<unknown>());

    useLayoutEffect(() =>
    {
        if (!extensions)
        {
            return;
        }

        const { pixi } = runtime;
        const wanted = new Set<unknown>(extensions);

        for (const extension of [...registered.current])
        {
            if (!wanted.has(extension))
            {
                pixi.extensions.remove(extension as never);
                registered.current.delete(extension);
            }
        }

        for (const extension of wanted)
        {
            if (!registered.current.has(extension))
            {
                pixi.extensions.add(extension as never);
                registered.current.add(extension);
            }
        }
    }, [runtime, extensions]);

    useLayoutEffect(() =>
    {
        Object.assign(runtime.pixi.TextStyle.defaultTextStyle, defaultTextStyle ?? runtime.originalDefaultTextStyle);
    }, [runtime, defaultTextStyle]);

    return null;
}

/** Creates the facade's `<Application>` over the default composition. */
export function createApplication(runtime: FacadeRuntime)
{
    return forwardRef<ApplicationRef, ApplicationProps>(function Application(props, forwardedRef)
    {
        const {
            children,
            className,
            defaultTextStyle,
            destroyOptions,
            extensions,
            onInit,
            rendererDestroyOptions,
            resizeTo,
            ...applicationProps
        } = props;
        const AdapterApplication = runtime.renderer().Application;
        const adapterRef = useRef<ApplicationRef>(null);
        // Upstream passed these to `createRoot` once, so later values never reached teardown; pin the first ones.
        const initialDestroyOptions = useRef({ destroyOptions, rendererDestroyOptions }).current;
        const adapterOptions: Record<string, unknown> = { ...applicationProps };

        for (const key of ADAPTER_ONLY_KEYS)
        {
            delete adapterOptions[key];
        }

        useImperativeHandle(forwardedRef, () => ({
            getApplication: () => adapterRef.current?.getApplication() ?? null,
            getCanvas: () => adapterRef.current?.getCanvas() ?? null,
        }));

        // Runs after the adapter's Application requested this render (child effects run first). Upstream copied every
        // remaining option onto the application after initialization, before the children committed; scheduling
        // here queues that copy right behind the adapter's render request.
        useLayoutEffect(() =>
        {
            const canvas = adapterRef.current?.getCanvas();
            const record = canvas ? runtime.renderer().runtime.rootFor(canvas) : undefined;

            if (record)
            {
                runtime.rememberRootOptions(record.app, initialDestroyOptions);
                record.schedule((app) => assignApplicationOptions(app, applicationProps)).catch(noop);
            }
        });

        return (
            <>
                <GlobalSettings runtime={runtime} extensions={extensions} defaultTextStyle={defaultTextStyle} />
                <AdapterApplication
                    {...(adapterOptions as object)}
                    ref={adapterRef}
                    className={className}
                    destroyOptions={initialDestroyOptions.destroyOptions}
                    rendererDestroyOptions={initialDestroyOptions.rendererDestroyOptions}
                    onInit={onInit}
                    resizeTo={resizeTo}
                >
                    {children as ReactNode}
                </AdapterApplication>
            </>
        );
    });
}
