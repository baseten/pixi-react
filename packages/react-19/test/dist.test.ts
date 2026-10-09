// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EPOCHS = ['19.0', '19.1', '19.2', '19.3'] as const;
/** The React version each bundled reconciler was built for (its `reconcilerVersion`). */
const RECONCILER_REACT = new Map([['19.0', '19.0.0'], ['19.1', '19.1.0'], ['19.2', '19.2.0'], ['19.3', '19.3.0']]);
const dist = (path: string) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * D6: each subpath ships one CommonJS implementation and a thin ESM wrapper, so `import` and `require` reach the
 * same module instance. Real Node module resolution against the built package (not Vite's).
 */
describe('ESM and CJS entries of each subpath share one instance (D6)', () =>
{
    const script = fileURLToPath(new URL('./dual/entries.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));

    for (const epoch of EPOCHS)
    {
        it(`${epoch}: same names and identical values from import and require`, () =>
        {
            expect(report[epoch].esmExports).toEqual(report[epoch].cjsExports);
            expect(report[epoch].esmExports).toEqual(
                expect.arrayContaining(['React19Adapter', 'React19AdapterBase', `React${epoch.replace('.', '')}Adapter`]),
            );
            expect(report[epoch].differing).toEqual([]);
            expect(report[epoch].sameAdapterClass).toBe(true);
            expect(report[epoch].implementationFiles).toHaveLength(1);
            // The reconciler is bundled: no react-reconciler module is resolved at runtime.
            expect(report[epoch].reconcilerFiles).toEqual([]);
        });
    }

    it('loads without a DOM', () =>
    {
        expect(report.hasDom).toBe(false);
    });
});

describe('subpath isolation (D2)', () =>
{
    it('exports only the four epoch subpaths: no bare entry and no aggregate', () =>
    {
        expect(Object.keys(manifest.exports).sort()).toEqual(['./19.0', './19.1', './19.2', './19.3', './package.json']);
        expect(manifest.main).toBeUndefined();
    });

    it('declares no runtime reconciler, scheduler, its-fine or Pixi dependency', () =>
    {
        expect(Object.keys(manifest.dependencies)).toEqual(['@pixi-react-provisional/core']);
        expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
    });

    for (const epoch of EPOCHS)
    {
        it(`${epoch} bundles exactly its own reconciler (built for React ${RECONCILER_REACT.get(epoch)}) and scheduler`, () =>
        {
            const code = readFileSync(dist(`${epoch}/index.js`), 'utf8');
            const reconcilers = new Set([...code.matchAll(/reconcilerVersion: "([^"]+)"/g)].map((match) => match[1]));

            expect([...reconcilers]).toEqual([RECONCILER_REACT.get(epoch)]);
            expect(code).toMatch(/unstable_scheduleCallback/);
            expect(code).not.toMatch(/require\("(react-reconciler|scheduler|its-fine)/);
        });
    }
});
