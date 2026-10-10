import { BASELINE_PLATFORM } from './environment';
import { test } from '@playwright/test';

/**
 * Baselines exist for Linux only. Elsewhere, outside CI, the visual project is skipped with this reason (run it in the
 * Playwright Linux container instead; see README.md). In CI a different platform is a failure, never a skip.
 */
export function requireBaselinePlatform(): void
{
    if (process.platform === BASELINE_PLATFORM) return;
    if (process.env.CI)
    {
        throw new Error(`The visual baselines are for ${BASELINE_PLATFORM}; this CI runner is ${process.platform}.`);
    }
    test.skip(true, `No ${process.platform} baselines: the visual baselines are rendered on ${BASELINE_PLATFORM} (README.md, "Visual baselines").`);
}
