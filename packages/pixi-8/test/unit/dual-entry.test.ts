import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D6 for a dual-build peer: one CJS implementation (loaded once), whose exports each entry binds to the pixi.js
 * instance its own module system loads. Runs real Node module resolution against the built package.
 */
describe('ESM and CJS entries share one implementation, bound per Pixi instance (D6)', () =>
{
    const script = fileURLToPath(new URL('../dual/entries.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));

    it('exposes the same export names from both entries', () =>
    {
        expect(report.esmExports).toEqual(report.cjsExports);
        expect(report.esmExports).toEqual(expect.arrayContaining(['Pixi8Adapter', 'bindPixi', 'PIXI8_PEER_RANGE']));
    });

    it('loads the implementation and core once', () =>
    {
        expect(report.loadedImplementations).toBe(1);
        expect(report.loadedCore).toBe(1);
        expect(report.sharedBindPixi).toBe(true);
        expect(report.sharedConstants).toBe(true);
    });

    it('binds each entry to the pixi.js instance its consumers load', () =>
    {
        expect(report.pixiInstancesDiffer).toBe(true);
        expect(report.esmBoundToEsmPixi).toBe(true);
        expect(report.cjsBoundToCjsPixi).toBe(true);
        expect(report.sameInstanceSameClass).toBe(true);
        expect(report.manifestId).toBe('pixi-8');
    });

    it('imports and binds only the pixi.js exports it uses, by name (tree shaking)', () =>
    {
        const names = [...report.bindingExports].sort();

        expect(report.esmPixiImports).toEqual([`{ ${report.bindingExports.map((name: string) => `${name} as peer_${name}`).join(', ')} }`]);
        expect(report.esmBoundExports).toEqual(names);
        expect(report.cjsBoundExports).toEqual(names);
    });

    it('loads no React package', () =>
    {
        expect(report.reactLoaded).toBe(false);
    });
});
