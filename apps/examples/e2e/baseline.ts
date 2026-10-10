import { BASELINE_ARCH, BASELINE_PLATFORM } from './environment';
import { test } from '@playwright/test';

/**
 * Baselines exist for Linux x64 only; the snapshot path is keyed by platform alone, so another architecture must not
 * compare against (or overwrite) them. Elsewhere, outside CI, the visual project is skipped with this reason (run it in the
 * Playwright Linux container instead; see README.md). In CI a different platform is a failure, never a skip.
 */
export function requireBaselinePlatform(): void
{
    const host = `${process.platform}-${process.arch}`;
    const baseline = `${BASELINE_PLATFORM}-${BASELINE_ARCH}`;

    if (host === baseline) return;
    if (process.env.CI)
    {
        throw new Error(`The visual baselines are for ${baseline}; this CI runner is ${host}.`);
    }
    test.skip(true, `No ${host} baselines: the visual baselines are rendered on ${baseline} (README.md, "Visual baselines").`);
}
