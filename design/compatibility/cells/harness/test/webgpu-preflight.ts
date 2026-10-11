/**
 * WebGPU runs only, the first setup file (vitest.config.mts): asks the browser for a WebGPU adapter before any Pixi
 * application initializes. Without one (no `navigator.gpu`, or `requestAdapter()` resolving to null or not at all), the
 * run fails here with a message that says so, instead of the suite hanging until the runner's timeout; Playwright's own
 * Chromium on Windows has no hardware WebGPU adapter, while the installed Chrome or Edge do (run-cells.mjs --browser).
 * Prints the browser (`COMPAT_BROWSER`) either way, so the runner records it even when the render check never runs.
 */
import { describeBrowser } from './browser-info';

type AnyRecord = Record<string, any>;

const ADAPTER_TIMEOUT_MS = 10_000;
const browser = await describeBrowser();

// eslint-disable-next-line no-console -- the runner reads this line from the conformance log.
console.log(`COMPAT_BROWSER ${JSON.stringify(browser)}`);
const gpu = (navigator as AnyRecord).gpu;
let adapter: unknown = null;
let reason = 'navigator.gpu is undefined';

if (gpu)
{
    reason = 'navigator.gpu.requestAdapter() resolved to null';
    adapter = await Promise.race([
        gpu.requestAdapter().catch((error: unknown) =>
        {
            reason = `navigator.gpu.requestAdapter() rejected: ${String(error)}`;

            return null;
        }),
        new Promise((resolve) => setTimeout(() =>
        {
            reason = `navigator.gpu.requestAdapter() did not settle within ${ADAPTER_TIMEOUT_MS / 1000} s`;
            resolve(null);
        }, ADAPTER_TIMEOUT_MS)),
    ]);
}
if (!adapter)
{
    const message = `COMPAT_NO_WEBGPU_ADAPTER no WebGPU adapter in this browser (${browser.name} ${browser.version ?? 'unknown version'}${browser.channel ? `, channel ${browser.channel}` : ', the Chromium pinned by Playwright'}): ${reason}; on Windows try --browser chrome (or msedge)`;

    // eslint-disable-next-line no-console -- the runner reads this line from the conformance log.
    console.error(message);
    throw new Error(message);
}
