// The render backend of this run: create a Pixi application with the cell's options, check that it is the requested
// backend, draw a red rectangle and check that a screenshot of the canvas shows it, and print what the browser reports
// (the runner records the COMPAT_BACKEND line).
import * as pixi from 'pixi.js';
import { commands, page } from '@vitest/browser/context';
import { expect, test } from 'vitest';
import cell from '../cell.json';
import { rendererAppOptions, rendererName, requestedRenderer } from './renderer';

type AnyRecord = Record<string, any>;

const RED = [255, 0, 0, 255];

async function describeBackend(renderer: AnyRecord): Promise<AnyRecord>
{
    const info: AnyRecord = {};
    const gl = renderer.gl as WebGLRenderingContext | undefined;

    if (gl)
    {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');

        info.webglVersion = gl.getParameter(gl.VERSION);
        info.webglRenderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        info.webglVendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
    }
    const adapter = renderer.gpu?.adapter;

    if (adapter)
    {
        const details = adapter.info ?? (typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo() : {});

        info.gpuAdapter = { vendor: details.vendor, architecture: details.architecture, device: details.device, description: details.description, isFallbackAdapter: adapter.isFallbackAdapter ?? details.isFallbackAdapter ?? null };
    }

    return info;
}

/**
 * What the GPU profile of this run (cell.json `gpuProfile`) expects, against what the browser reports: software
 * rendering (SwiftShader and the like, or a WebGPU fallback adapter) or a real GPU. A hardware run must identify its GPU
 * and must not land on a software renderer.
 */
function checkProfile(info: AnyRecord): AnyRecord | null
{
    const profile = (cell as AnyRecord).gpuProfile as { id: string; expect: 'software' | 'hardware'; softwarePatterns: string[] } | undefined;

    if (!profile) return null;
    const adapter = info.gpuAdapter as AnyRecord | undefined;
    const identity = [info.webglRenderer, adapter && [adapter.vendor, adapter.architecture, adapter.device, adapter.description].filter(Boolean).join(' ')].filter(Boolean).join(' | ');
    const software = adapter?.isFallbackAdapter === true || profile.softwarePatterns.some((pattern) => identity.toLowerCase().includes(pattern.toLowerCase()));
    const identified = identity.length > 0 || adapter?.isFallbackAdapter === false;
    const matchesProfile = profile.expect === 'software' ? software : !software && identified;

    return { profile: profile.id, expect: profile.expect, identity, software, matchesProfile };
}

test(`render backend: ${requestedRenderer}`, async () =>
{
    const Application = pixi.Application as unknown as new (options?: AnyRecord) => AnyRecord;
    const options = { ...(cell as AnyRecord).appOptions, ...rendererAppOptions };
    const hasInit = typeof (pixi.Application as unknown as AnyRecord).prototype.init === 'function';
    const app = hasInit ? new Application() : new Application(options);

    if (hasInit) await app.init(options);
    try
    {
        const actual = rendererName(app.renderer);
        const graphics = new pixi.Graphics() as AnyRecord;

        if (typeof graphics.rect === 'function') graphics.rect(0, 0, options.width, options.height).fill(0xff0000);
        else graphics.beginFill(0xff0000).drawRect(0, 0, options.width, options.height).endFill();
        app.stage.addChild(graphics);
        // Two read-backs of the first pixel: Pixi's own extract path, and the presented canvas copied into a 2D canvas in
        // the same task as the render (before the WebGPU canvas texture expires).
        const readCanvas = () =>
        {
            app.render();
            const copy = document.createElement('canvas');

            copy.width = options.width;
            copy.height = options.height;
            const context = copy.getContext('2d')!;

            context.drawImage((app.canvas ?? app.view) as HTMLCanvasElement, 0, 0);

            return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const canvasPixel = readCanvas();
        const extracted = await app.renderer.extract.pixels(app.stage);
        const pixels = (extracted?.pixels ?? extracted) as ArrayLike<number>;
        const extractPixel = Array.from({ length: 4 }, (_, index) => pixels[index]);
        // And what the page shows: a screenshot of the canvas element, decoded in the page.
        const view = (app.canvas ?? app.view) as HTMLCanvasElement;

        document.body.appendChild(view);
        app.render();
        const shot = await page.screenshot({ element: view, path: `__screenshots__/backend-${requestedRenderer}.png` });
        const base64 = await commands.readFile(typeof shot === 'string' ? shot : shot.path, 'base64');
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: 'image/png' }));
        const decoded = document.createElement('canvas');

        decoded.width = bitmap.width;
        decoded.height = bitmap.height;
        decoded.getContext('2d')!.drawImage(bitmap, 0, 0);
        const screenPixel = Array.from(decoded.getContext('2d')!.getImageData(0, 0, 1, 1).data);

        view.remove();
        const readback = { screenshot: screenPixel, canvas: canvasPixel, extract: extractPixel, screenshotMatches: screenPixel.join() === RED.join(), canvasMatches: canvasPixel.join() === RED.join(), extractMatches: extractPixel.join() === RED.join() };
        const described = await describeBackend(app.renderer);
        const gpu = checkProfile(described);
        const record = { requested: requestedRenderer, actual, pixi: pixi.VERSION, userAgent: navigator.userAgent, readback, ...described, ...(gpu ? { gpu } : {}) };

        // eslint-disable-next-line no-console -- the runner reads this line from the conformance log.
        console.log(`COMPAT_BACKEND ${JSON.stringify(record)}`);
        // The backend and what the page shows are hard requirements: a backend that renders nothing is not checked by a
        // passing conformance run (the scenarios observe the scene graph, not pixels). The canvas copy and Pixi's extract
        // are recorded only.
        expect(actual).toBe(requestedRenderer);
        // Fails loudly when a hardware run lands on SwiftShader or a fallback adapter (or a software run on a GPU), so a
        // record never calls one the other.
        if (gpu) expect(gpu.matchesProfile, `GPU profile ${gpu.profile} expects ${gpu.expect} rendering, but the browser reports: ${gpu.identity || 'no renderer or adapter identity'}${gpu.software ? ' (software)' : ''}`).toBe(true);
        expect(screenPixel, 'the screenshot of the canvas shows the red rectangle').toEqual(RED);
    }
    finally
    {
        app.destroy(true);
    }
});
