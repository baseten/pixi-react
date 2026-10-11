/**
 * Environment shims of this backend run (cell.json `renderers.<backend>.environmentShims`, from the manifest's
 * `adapterMatrix.environmentShims`): labelled workarounds for an upstream pixi.js bug, so the run measures the adapters
 * rather than that bug. vitest.config.mts loads this file as the first setup file, only when the backend lists a shim,
 * so every shim is in place before any Pixi application initializes. The render check (backend.test.tsx) reports what
 * was applied in its COMPAT_BACKEND line, and the runner fails a run whose report differs from the configuration.
 *
 * `clamp-webgl-parameter`: WebGLRenderingContext and WebGL2RenderingContext `getParameter(enum)` return at most `max`.
 * Today: MAX_TEXTURE_IMAGE_UNITS (0x8872) at most 16 for pixi.js 8.2.6 to 8.9.x on WebGPU (pixijs/pixijs#11389, fixed in
 * 8.10.0 by #11417), which sizes its WebGPU texture batch from that WebGL value.
 */
import cell from '../cell.json';

declare const __COMPAT_RENDERER__: string | undefined;

interface ShimConfig { id: string; kind: string; parameter: string; enum: number; max: number }
export interface AppliedShim { id: string; kind: string; parameter: string; max: number; original: number | null; clamped: number | null }

const renderer = typeof __COMPAT_RENDERER__ === 'string' ? __COMPAT_RENDERER__ : 'webgl';
const shims = ((cell as { renderers?: Record<string, { environmentShims?: ShimConfig[] }> }).renderers?.[renderer]?.environmentShims) ?? [];
const applied: AppliedShim[] = [];

/** The parameter as a fresh WebGL context reports it (WebGL 2 when available, as Pixi asks), or null without WebGL. */
function readParameter(parameter: number): number | null
{
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;

    if (!gl) return null;
    const value = gl.getParameter(parameter) as unknown;

    gl.getExtension('WEBGL_lose_context')?.loseContext();

    return typeof value === 'number' ? value : null;
}

for (const shim of shims)
{
    if (shim.kind !== 'clamp-webgl-parameter') throw new Error(`environment shim ${shim.id}: unknown kind ${shim.kind}`);
    const original = readParameter(shim.enum);

    for (const context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext])
    {
        if (!context) continue;
        const { getParameter } = context.prototype;

        context.prototype.getParameter = function clampedGetParameter(this: WebGLRenderingContext, name: number)
        {
            const value = getParameter.call(this, name) as unknown;

            return name === shim.enum && typeof value === 'number' ? Math.min(value, shim.max) : value;
        } as typeof getParameter;
    }
    applied.push({ id: shim.id, kind: shim.kind, parameter: shim.parameter, max: shim.max, original, clamped: readParameter(shim.enum) });
}

(globalThis as { __COMPAT_ENVIRONMENT_SHIMS__?: AppliedShim[] }).__COMPAT_ENVIRONMENT_SHIMS__ = applied;
