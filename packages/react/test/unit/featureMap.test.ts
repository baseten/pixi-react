import { describe, expect, it } from 'vitest';
import { facadeBinding } from '../conformance/facadeBinding';
import { renderFeatureMap } from '@pixi-react-provisional/conformance';

describe('conformance feature map', () =>
{
    it('matches the scenarios and the baseline facade outcomes', async () =>
    {
        // `-u` rewrites the committed map; in CI a stale map fails this test.
        await expect(renderFeatureMap(facadeBinding)).toMatchFileSnapshot('../../../conformance/FEATURE-MAP.md');
    });
});
