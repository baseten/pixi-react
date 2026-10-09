// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D6: the package ships one CommonJS implementation and a thin ESM wrapper, so `import` and `require` reach the
 * same module instance. This runs real Node module resolution against the built package (not Vite's).
 */
describe('ESM and CJS entries share one runtime instance (D6)', () =>
{
    const script = fileURLToPath(new URL('./dual/entries.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));

    it('exposes the same export names from both entries', () =>
    {
        expect(report.esmExports).toEqual(report.cjsExports);
        expect(report.esmExports).toContain('CompatibilityError');
        expect(report.esmExports).toContain('compose');
    });

    it('returns identical classes and functions from import and require', () =>
    {
        expect(report.differing).toEqual([]);
        expect(report.loadedImplementations).toBe(1);
    });

    it('composes adapters built on different entries; errors narrow with either entry\'s class', () =>
    {
        expect(report.errorCode).toBe('UNKNOWN_ELEMENT');
        expect(report.errorIsSharedClass).toBe(true);
    });

    it('loads without a DOM', () =>
    {
        expect(report.hasDom).toBe(false);
    });
});
