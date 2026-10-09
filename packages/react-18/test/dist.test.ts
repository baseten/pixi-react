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

    it('resolves its exact react-reconciler and its-fine dependencies at runtime instead of bundling them', () =>
    {
        expect(report.resolved).toEqual({ 'react-reconciler': '0.29.2', 'its-fine': '1.2.5' });
        expect(report.reconcilerFiles.some((file: string) => (/[\\/]react-reconciler[\\/]/).test(file))).toBe(true);
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

    it('declares exactly core, react-reconciler and its-fine, pinned, and only react as a peer', () =>
    {
        expect(manifest.dependencies).toEqual({
            '@pixi-react-provisional/core': 'workspace:^', // published as ^<core version>: one core per ABI major (design/release.md)
            'its-fine': '1.2.5',
            'react-reconciler': '0.29.2',
        });
        expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
    });

    it('bundles only its own code: no reconciler, scheduler or its-fine source, no react-shared import', () =>
    {
        const code = readFileSync(dist('index.js'), 'utf8');

        expect(code).not.toMatch(/reconcilerVersion|unstable_scheduleCallback|\$\$\$hostConfig/);
        expect(code).toMatch(/require\("react-reconciler"\)/);
        expect(code).toMatch(/require\("its-fine"\)/);
        expect(code).not.toMatch(/require\(["'](scheduler|react-dom)/);
        expect(code).not.toContain('@pixi-react-provisional/react-shared');
        // No React 19 reconciler API leaked into the bundle.
        expect(code).not.toMatch(/updateContainerSync|onDefaultTransitionIndicator/);
    });

    it('publishes declarations that name no reconciler and no unpublished package', () =>
    {
        const declarations = readdirSync(dist(''), { recursive: true }).map(String).filter((file) => (/\.d\.m?ts$/).test(file));

        expect(declarations).toContain('index.d.ts');
        expect(declarations).not.toContain('hostConfig.d.ts');

        for (const file of declarations)
        {
            expect(readFileSync(dist(file), 'utf8'), file).not.toMatch(/(?:from |import\()['"](?:react-reconciler|its-fine|scheduler|@pixi-react-provisional\/react-shared)/);
        }
    });
});
