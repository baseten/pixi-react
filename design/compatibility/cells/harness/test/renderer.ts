/**
 * The render backend of this conformance run (WebGL or WebGPU), and a guard that every Pixi application the run
 * initializes really uses it. Pixi 8 falls back to another renderer silently when the preferred one is unavailable, so a
 * WebGPU run without this guard could pass on WebGL. Loaded as a Vitest setup file, before any probe wraps
 * `Application.prototype.init`, so the probes call through it.
 */
import * as pixi from 'pixi.js';
import cell from '../cell.json';

declare const __COMPAT_RENDERER__: string | undefined;

/** The backend this run requested (`COMPAT_RENDERER`, defined by vitest.config.mts). */
export const requestedRenderer: string = typeof __COMPAT_RENDERER__ === 'string' ? __COMPAT_RENDERER__ : 'webgl';

const backends = (cell as { renderers?: Record<string, { appOptions?: Record<string, unknown> }> }).renderers ?? {};

/** The application options that select the requested backend (Pixi 8's `preference`; none for Pixi 7). */
export const rendererAppOptions: Readonly<Record<string, unknown>> = Object.freeze({ ...(backends[requestedRenderer]?.appOptions ?? {}) });

const major = Number(String(pixi.VERSION).split('.')[0]);

/** The backend a Pixi renderer actually is: Pixi 8 names it; Pixi 7 only has a numeric type (1 WebGL, 2 canvas). */
export function rendererName(renderer: unknown): string
{
    const { name, type } = (renderer ?? {}) as { name?: unknown; type?: unknown };

    if (typeof name === 'string' && name) return name;
    if (type === 1) return 'webgl';
    if (type === 2) return major >= 8 ? 'webgpu' : 'canvas';
    if (type === 4) return 'canvas';

    return `unknown (type ${String(type)})`;
}

const Application = pixi.Application as unknown as { prototype: { init?: (this: { renderer: unknown }, options?: unknown) => Promise<void> } };
const originalInit = Application.prototype.init;

if (typeof originalInit === 'function')
{
    Application.prototype.init = async function init(this: { renderer: unknown }, options?: unknown)
    {
        await originalInit.call(this, options);
        const actual = rendererName(this.renderer);

        if (actual !== requestedRenderer)
        {
            throw new Error(`render backend: this run requested ${requestedRenderer}, but pixi.js ${pixi.VERSION} created a ${actual} renderer`);
        }
    };
}
