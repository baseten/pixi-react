// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('renderer ESM and CJS entries share one runtime instance (D6)', () =>
{
    const script = fileURLToPath(new URL('./dual/entries.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));

    it('import and require return the same createRenderer and runtime implementation', () =>
    {
        expect(report.sameFactory).toBe(true);
        expect(report.sameRuntimeClass).toBe(true);
        expect(report.distinctRuntimes).toBe(true);
        expect(report.rendererImplementations).toBe(1);
        expect(report.coreImplementations).toBe(1);
    });

    it('errors thrown through the renderer narrow with core\'s class from either entry', () =>
    {
        expect(report.errorCode).toBe('CAPABILITY_MISSING');
        expect(report.errorIsCoreClass).toBe(true);
    });
});
