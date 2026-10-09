// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue 10: the neutral factory stays usable without the default pair. Loading `createRenderer` alone, through either
 * entry, must load only the renderer and core: no React adapter, no Pixi adapter, no React, no pixi.js.
 */
describe('a factory-only import loads no default adapter runtime', () =>
{
    const script = fileURLToPath(new URL('./factory-only/load.mjs', import.meta.url));
    const run = (mode: 'esm' | 'cjs', ...extra: string[]) =>
        JSON.parse(execFileSync(process.execPath, [script, mode, ...extra], { encoding: 'utf8' }));

    it.each(['esm', 'cjs'] as const)('%s: only @pixi-react-provisional/renderer and core load', (mode) =>
    {
        const report = run(mode);

        expect(report.createRenderer).toBe('function');
        // Workspace packages are reported by directory: `renderer` and `core`.
        expect(report.packages).toEqual(['core', 'renderer']);
    });

    it.each(['esm', 'cjs'] as const)('%s: the inspection detects any other package that loads (negative control)', (mode) =>
    {
        expect(run(mode, 'typescript').packages).toContain('typescript');
    });
});
