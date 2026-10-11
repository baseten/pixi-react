/**
 * The browser a backend run used: the brand and full version Chromium reports (`navigator.userAgentData`, whose
 * `fullVersionList` names Google Chrome or Microsoft Edge for an installed browser), the user agent, and the version of
 * the browser Playwright launched (the `compatBrowser` command of vitest.config.mts, which also watches for a page crash).
 * The runner records it per backend run; a verification record names it, and says when it was an installed browser
 * rather than the Chromium pinned by Playwright.
 */
import { commands } from '@vitest/browser/context';
import cell from '../cell.json';

type AnyRecord = Record<string, any>;

export interface BrowserInfo
{
    id: string;
    channel: string | null;
    name: string;
    version: string | null;
    launchedVersion: string | null;
    userAgent: string;
    brands: { brand: string; version: string }[];
}

let cached: Promise<BrowserInfo> | null = null;

async function collect(): Promise<BrowserInfo>
{
    const configured = ((cell as AnyRecord).browser ?? { id: 'chromium', channel: null }) as { id: string; channel: string | null };
    const data = (navigator as AnyRecord).userAgentData;
    let brands: { brand: string; version: string }[] = [];

    try
    {
        brands = ((await data?.getHighEntropyValues?.(['fullVersionList']))?.fullVersionList ?? data?.brands ?? []) as typeof brands;
    }
    catch
    {
        brands = (data?.brands ?? []) as typeof brands;
    }
    let launchedVersion: string | null = null;

    try
    {
        launchedVersion = ((await (commands as AnyRecord).compatBrowser()) as AnyRecord)?.version ?? null;
    }
    catch
    {
        launchedVersion = null;
    }
    const real = brands.filter((entry) => !/not.?a.?brand/i.test(entry.brand));
    const named = real.find((entry) => entry.brand !== 'Chromium') ?? real.find((entry) => entry.brand === 'Chromium');
    const fromAgent = navigator.userAgent.match(/(?:HeadlessChrome|Chrome)\/([\d.]+)/)?.[1] ?? null;

    return {
        id: configured.id,
        channel: configured.channel ?? null,
        name: named?.brand ?? 'Chromium',
        version: launchedVersion ?? named?.version ?? fromAgent,
        launchedVersion,
        userAgent: navigator.userAgent,
        brands: real,
    };
}

/** The browser of this run (collected once per page). */
export const describeBrowser = (): Promise<BrowserInfo> => (cached ??= collect());
