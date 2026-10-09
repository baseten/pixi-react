// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = (path: string) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * D6: one CommonJS implementation and a thin ESM wrapper, so `import` and `require` reach the same module instance.
 * Real Node module resolution against the built package (not Vite's).
 */
describe('ESM and CJS entries share one instance (D6)', () =>
{
    const script = fileURLToPath(new URL('./dual/entries.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));

    it('same names and identical values from import and require', () =>
    {
        expect(report.esmExports).toEqual(report.cjsExports);
        expect(report.esmExports).toEqual(expect.arrayContaining(['React18Adapter', 'REACT18', 'UNSUPPORTED_CAPABILITIES']));
        expect(report.differing).toEqual([]);
        expect(report.sameAdapterClass).toBe(true);
        expect(report.implementationFiles).toHaveLength(1);
    });

    it('resolves no reconciler, scheduler or its-fine module at runtime: they are bundled', () =>
    {
        expect(report.reconcilerFiles).toEqual([]);
    });

    it('loads without a DOM', () =>
    {
        expect(report.hasDom).toBe(false);
    });
});

describe('package shape', () =>
{
    it('exports one entry: no React 19 subpath, no aggregate', () =>
    {
        expect(Object.keys(manifest.exports).sort()).toEqual(['.', './package.json']);
    });

    it('declares only core at runtime and only react as a peer', () =>
    {
        expect(Object.keys(manifest.dependencies)).toEqual(['@pixi-react-provisional/core']);
        expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
    });

    it('bundles exactly react-reconciler 0.29.2 (built for React 18.3.1), its scheduler and its-fine 1.x', () =>
    {
        const code = readFileSync(dist('index.js'), 'utf8');
        const reconcilers = new Set([...code.matchAll(/(?:reconcilerVersion|version): ['"](18\.[^'"]+)['"]/g)].map((match) => match[1]));

        expect([...reconcilers]).toEqual(['18.3.1']);
        expect(code).toMatch(/unstable_scheduleCallback/);
        expect(code).toMatch(/FiberProvider/);
        expect(code).not.toMatch(/require\(["'](react-reconciler|scheduler|its-fine|react-dom)/);
        // No React 19 reconciler API leaked into the bundle.
        expect(code).not.toMatch(/updateContainerSync|onDefaultTransitionIndicator/);
    });

    it('publishes declarations that name no bundled module', () =>
    {
        const declarations = readdirSync(dist(''), { recursive: true }).map(String).filter((file) => (/\.d\.m?ts$/).test(file));

        expect(declarations).toContain('index.d.ts');
        expect(declarations).not.toContain('hostConfig.d.ts');

        for (const file of declarations)
        {
            expect(readFileSync(dist(file), 'utf8'), file).not.toMatch(/(?:from |import\()['"](?:react-reconciler|its-fine|scheduler)/);
        }
    });
});
