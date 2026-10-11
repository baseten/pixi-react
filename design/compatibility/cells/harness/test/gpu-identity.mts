/**
 * Pure helpers of the render check (backend.test.tsx), with no import and only erasable types, so the Node tests
 * (cells.test.mjs) import this file directly (Node 22 strips the types).
 *
 * Whether a WebGPU adapter is a fallback (software) adapter: newer Chrome reports it as `adapter.info.isFallbackAdapter`
 * and dropped `adapter.isFallbackAdapter`; older Chromium (Playwright's 133) has only the latter. The info field wins,
 * the record names the field it came from, and when neither exists the flag is unknown, never "not a fallback": the
 * renderer and adapter names then decide against `adapterMatrix.softwareRendererPatterns` (SwiftShader and the like).
 */

export type FallbackSource = 'adapter.info.isFallbackAdapter' | 'adapter.isFallbackAdapter' | 'unknown';

export interface Fallback { isFallbackAdapter: boolean | null; source: FallbackSource }

/** The fallback flag of an adapter and of its info (`adapter.info`, or what `requestAdapterInfo()` returned). */
export function fallbackOf(adapter: Record<string, unknown> | null | undefined, info: Record<string, unknown> | null | undefined): Fallback
{
    if (typeof info?.isFallbackAdapter === 'boolean') return { isFallbackAdapter: info.isFallbackAdapter, source: 'adapter.info.isFallbackAdapter' };
    if (typeof adapter?.isFallbackAdapter === 'boolean') return { isFallbackAdapter: adapter.isFallbackAdapter, source: 'adapter.isFallbackAdapter' };

    return { isFallbackAdapter: null, source: 'unknown' };
}

export interface ProfileInput
{
    webglRenderer?: string;
    gpuAdapter?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean | null; fallbackSource?: FallbackSource };
}

export interface ProfileRule { id: string; expect: 'software' | 'hardware'; softwarePatterns: string[] }

/**
 * What the GPU profile of a run expects, against what the browser reports: software rendering (a software renderer name
 * or a fallback adapter) or a real GPU. A hardware run must identify its GPU and must not land on a software renderer;
 * `decidedBy` says whether the adapter's fallback flag or the name patterns decided.
 */
export function checkProfile(info: ProfileInput, profile: ProfileRule)
{
    const adapter = info.gpuAdapter;
    const identity = [info.webglRenderer, adapter && [adapter.vendor, adapter.architecture, adapter.device, adapter.description].filter(Boolean).join(' ')].filter(Boolean).join(' | ');
    const fallback = adapter ? adapter.isFallbackAdapter ?? null : null;
    const patternMatch = profile.softwarePatterns.find((pattern) => identity.toLowerCase().includes(pattern.toLowerCase())) ?? null;
    const software = fallback === true || patternMatch !== null;
    const identified = identity.length > 0 || fallback === false;
    const matchesProfile = profile.expect === 'software' ? software : !software && identified;
    const decidedBy = fallback === true ? (adapter?.fallbackSource ?? 'adapter.isFallbackAdapter')
        : patternMatch ? `softwareRendererPatterns (${patternMatch})`
            : adapter && fallback === null ? 'softwareRendererPatterns (isFallbackAdapter unknown, no pattern matched)'
                : adapter ? (adapter.fallbackSource ?? 'adapter.isFallbackAdapter') : 'softwareRendererPatterns';

    return { profile: profile.id, expect: profile.expect, identity, software, matchesProfile, decidedBy, ...(adapter ? { fallbackAdapter: fallback === null ? 'unknown' : fallback } : {}) };
}
